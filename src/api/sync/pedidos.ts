// Ingesta de pedidos online (E3c) — docs/06-SDD-etapa3-sincronizacion.md §8.
// Solo lectura hacia el canal. Escribe PedidoCanal/PedidoCanalLinea, movimientos
// `venta_online` en el libro de E2 y discrepancias. Todo un pedido en una transacción.
import type { Prisma, TipoDiscrepancia } from '@prisma/client';
import type { PedidoWoo, ReembolsoWoo } from '@onplay/woo-client';
import { devueltasPorLinea, montoDesdeWoo, pedidoAnulado, pedidoPagado } from '@onplay/dominio';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import { registrarMovimiento } from '../stock/libro.js';
import {
  ErrorCorrida,
  abrirCorrida,
  cerrarCorrida,
  clienteDelCanal,
  contadoresVacios,
  usuarioSistemaId,
  type ContadoresCorrida,
} from './corridas.js';
import { registrarDiscrepancia, type EntradaDiscrepancia } from './discrepancias.js';
import type { CanalWoo } from './importador.js';

type Tx = Prisma.TransactionClient;

export interface LineaPlan {
  externoItemId: number;
  sku: string | null;
  descripcion: string;
  cantidad: number;
  devuelta: number;
  productoSku: string | null;
  controlaStock: boolean;
  descuenta: number; // unidades que salen del libro (0 si no controla o no mapea)
}

export interface ItemPlanPedidos {
  numero: string;
  externoId: number;
  estado: string;
  accion: 'ingerir' | 'omitir' | 'revisar' | 'fallar';
  motivo?: string;
  lineas?: LineaPlan[];
  candidatas?: { tipo: TipoDiscrepancia; detalle: string }[];
}

export interface ResumenIngesta {
  corridaId: string;
  simulacion: boolean;
  tipo: 'pedidos';
  canalId: string;
  desde: string | null;
  hasta: string;
  resumen: ContadoresCorrida;
  plan: ItemPlanPedidos[];
}

interface Contexto {
  canalId: CanalWoo;
  dryRun: boolean;
  usuarioId: string;
  ubicacionOnlineId: string;
}

/** Fecha GMT de Woo ("2026-08-29T06:51:37", sin zona) → Date UTC. */
function fechaGmt(texto: string | null | undefined): Date | null {
  if (!texto) return null;
  const d = new Date(texto.endsWith('Z') ? texto : `${texto}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Corrida de pedidos (§8.1): consulta A (pagados) + consulta B (anulados), ambas desde la
 * marca de agua del canal. dryRun por defecto (S1): no persiste nada salvo la SyncCorrida.
 */
export async function ingerirPedidos(
  canalId: CanalWoo,
  opciones: { dryRun: boolean; usuarioId: string | null },
): Promise<ResumenIngesta> {
  const canal = await prisma.canal.findUnique({ where: { id: canalId } });
  if (!canal) throw new ErrorCorrida({ error: 'CANAL_DESCONOCIDO' }, 404);
  if (!opciones.dryRun && !canal.ingestaPedidos) {
    throw new ErrorCorrida(
      { error: 'INGESTA_APAGADA', detalle: 'El interruptor ingestaPedidos del canal está apagado (G8). Enciéndelo en PATCH /canales/:id.' },
      409,
    );
  }
  const ubicacion = await prisma.ubicacion.findUnique({ where: { codigo: entorno.syncUbicacionOnline } });
  if (!ubicacion || !ubicacion.activa) {
    throw new ErrorCorrida(
      { error: 'UBICACION_ONLINE_NO_CONFIGURADA', detalle: `SYNC_UBICACION_ONLINE=${entorno.syncUbicacionOnline} no es una ubicación activa` },
      409,
    );
  }
  const cliente = clienteDelCanal(canalId);
  const usuarioId = opciones.usuarioId ?? (await usuarioSistemaId());

  // Marca de agua: la última ingesta real. Sin marca (nunca se encendió) la simulación
  // mira las últimas 24 h para poder mostrar algo; la corrida real exige la marca, que
  // PATCH /canales fija al encender el interruptor (la ingesta parte desde ese momento).
  let desde: Date | null = canal.ultimaIngestaEn;
  if (!desde && opciones.dryRun) desde = new Date(Date.now() - 24 * 3600 * 1000);
  if (!desde) {
    throw new ErrorCorrida({ error: 'SIN_MARCA_DE_AGUA', detalle: 'El canal no tiene ultimaIngestaEn; enciende ingestaPedidos primero' }, 409);
  }
  const hasta = new Date();

  const corrida = await abrirCorrida(canalId, 'pedidos', { simulacion: opciones.dryRun, usuarioId: opciones.usuarioId });
  const ctx: Contexto = { canalId, dryRun: opciones.dryRun, usuarioId, ubicacionOnlineId: ubicacion.id };
  const contadores = contadoresVacios();
  const plan: ItemPlanPedidos[] = [];
  const vistos = new Set<number>();

  try {
    const consultas = ['processing,completed', 'cancelled,refunded'];
    for (const status of consultas) {
      for await (const lote of cliente.paginarPedidos(status, desde.toISOString())) {
        for (const pedido of lote) {
          if (vistos.has(pedido.id)) continue; // un pedido puede salir en ambas consultas
          vistos.add(pedido.id);
          contadores.leidos += 1;
          try {
            const reembolsos = pedido.refunds?.length ? await cliente.listarReembolsos(pedido.id) : [];
            const item = await procesarPedido(ctx, pedido, reembolsos);
            plan.push(item);
            if (item.accion === 'ingerir' || item.accion === 'revisar') {
              contadores.aEscribir += 1;
              if (!ctx.dryRun) contadores.escritos += 1;
            } else contadores.omitidos += 1;
            if (item.candidatas?.length) contadores.detenidos += 0; // las discrepancias no detienen la ingesta
          } catch (e) {
            contadores.fallidos += 1;
            plan.push({ numero: pedido.number, externoId: pedido.id, estado: pedido.status, accion: 'fallar', motivo: (e as Error).message });
            await prisma.syncCorridaItem.create({
              data: { corridaId: corrida.id, sku: `pedido:${pedido.number}`, accion: 'fallar', mensaje: (e as Error).message },
            });
          }
        }
      }
    }
  } catch (e) {
    await cerrarCorrida(corrida.id, 'abortada', contadores, `lectura del canal fallida: ${(e as Error).message}`);
    throw new ErrorCorrida({ error: 'CANAL_ILEGIBLE', detalle: (e as Error).message, corridaId: corrida.id }, 502);
  }

  await cerrarCorrida(corrida.id, 'terminada', contadores);
  // La marca de agua avanza SOLO en una corrida real terminada sin fallos de lectura (§5.3).
  if (!ctx.dryRun) {
    await prisma.canal.update({ where: { id: canalId }, data: { ultimaIngestaEn: hasta } });
  }
  return {
    corridaId: corrida.id,
    simulacion: ctx.dryRun,
    tipo: 'pedidos',
    canalId,
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    resumen: contadores,
    plan,
  };
}

interface LineaResuelta {
  externoItemId: number;
  externoSku: string | null;
  descripcion: string;
  cantidad: number;
  cantidadDevuelta: number;
  precioUnitario: number;
  productoId: string | null;
  productoSku: string | null;
  controlaStock: boolean;
}

/** §8.2 paso 4 — mapeo por externoId (variación o producto) y luego por externoSku. */
async function resolverLineas(canalId: string, pedido: PedidoWoo, reembolsos: ReembolsoWoo[]): Promise<LineaResuelta[]> {
  const devueltas = devueltasPorLinea(reembolsos);
  const ids = pedido.line_items.flatMap((l) => [l.variation_id, l.product_id].filter((n) => n > 0));
  const skus = pedido.line_items.map((l) => l.sku).filter((s) => !!s);
  const vinculos = await prisma.productoCanal.findMany({
    where: { canalId, OR: [{ externoId: { in: ids } }, { externoSku: { in: skus } }] },
    select: { externoId: true, externoSku: true, producto: { select: { id: true, sku: true, controlaStock: true } } },
  });
  return pedido.line_items.map((l) => {
    const porId =
      (l.variation_id > 0 && vinculos.find((v) => v.externoId === l.variation_id)) ||
      vinculos.find((v) => v.externoId === l.product_id);
    const porSku = !porId && l.sku ? vinculos.find((v) => v.externoSku === l.sku) : undefined;
    const p = (porId || porSku)?.producto ?? null;
    return {
      externoItemId: l.id,
      externoSku: l.sku || null,
      descripcion: l.name,
      cantidad: l.quantity,
      cantidadDevuelta: devueltas.get(l.id) ?? 0,
      precioUnitario: montoDesdeWoo(l.price),
      productoId: p?.id ?? null,
      productoSku: p?.sku ?? null,
      controlaStock: p?.controlaStock ?? false,
    };
  });
}

async function resolverCliente(canalId: string, pedido: PedidoWoo): Promise<string | null> {
  if (!pedido.customer_id || pedido.customer_id <= 0) return null;
  const vinculo = await prisma.clienteCanal.findFirst({
    where: { canalId, externoUserId: pedido.customer_id, desvinculadoEn: null },
    select: { clienteId: true },
  });
  return vinculo?.clienteId ?? null;
}

function planDeLineas(lineas: LineaResuelta[], pagado: boolean, esNuevo: boolean): LineaPlan[] {
  return lineas.map((l) => ({
    externoItemId: l.externoItemId,
    sku: l.externoSku,
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    devuelta: l.cantidadDevuelta,
    productoSku: l.productoSku,
    controlaStock: l.controlaStock,
    descuenta: pagado && esNuevo && l.productoId && l.controlaStock ? Math.max(0, l.cantidad - l.cantidadDevuelta) : 0,
  }));
}

/** §8.2 — un pedido, una transacción. En simulación solo calcula el plan. */
async function procesarPedido(ctx: Contexto, pedido: PedidoWoo, reembolsos: ReembolsoWoo[]): Promise<ItemPlanPedidos> {
  const { canalId } = ctx;
  const existente = await prisma.pedidoCanal.findUnique({
    where: { canalId_externoId: { canalId, externoId: pedido.id } },
    include: { lineas: true },
  });
  const modificado = fechaGmt(pedido.date_modified_gmt);
  const pagado = pedidoPagado(pedido.status);
  const anulado = pedidoAnulado(pedido.status);
  const base = { numero: pedido.number, externoId: pedido.id, estado: pedido.status };

  // Paso 2: ya ingerido y sin cambios desde la última revisión → omitir.
  if (
    existente?.ingeridoEn &&
    existente.revisadoEn &&
    modificado &&
    existente.modificadoEnCanal &&
    existente.modificadoEnCanal.getTime() === modificado.getTime()
  ) {
    return { ...base, accion: 'omitir', motivo: 'sin cambios desde la última revisión' };
  }
  // Nunca ingerido y ya anulado: no hay nada que revertir (§8.3 aplica a lo ingerido).
  if (!existente && !pagado) {
    return { ...base, accion: 'omitir', motivo: anulado ? 'anulado antes de ingerirlo' : `estado ${pedido.status} no se ingiere (§8.4)` };
  }

  const lineas = await resolverLineas(canalId, pedido, reembolsos);
  const clienteId = await resolverCliente(canalId, pedido);
  const esNuevo = !existente?.ingeridoEn;
  const candidatas: { tipo: TipoDiscrepancia; detalle: string }[] = [];

  if (esNuevo) {
    for (const l of lineas) {
      if (!l.productoId) candidatas.push({ tipo: 'producto_sin_mapear', detalle: `${l.descripcion} (sku ${l.externoSku ?? '—'})` });
    }
  } else if (existente) {
    const eraAnulado = pedidoAnulado(existente.estadoCanal);
    if (anulado && !eraAnulado) {
      candidatas.push({ tipo: 'pedido_anulado', detalle: `Pedido ${pedido.number} pasó a ${pedido.status}` });
    }
    for (const l of lineas) {
      const antes = existente.lineas.find((x) => x.externoItemId === l.externoItemId)?.cantidadDevuelta ?? 0;
      if (!anulado && l.cantidadDevuelta > antes) {
        candidatas.push({ tipo: 'pedido_anulado', detalle: `${l.descripcion}: devueltas ${l.cantidadDevuelta} de ${l.cantidad}` });
      }
    }
  }

  const item: ItemPlanPedidos = {
    ...base,
    accion: esNuevo ? 'ingerir' : 'revisar',
    lineas: planDeLineas(lineas, pagado, esNuevo),
    candidatas,
  };
  if (ctx.dryRun) return item;
  if (!esNuevo && candidatas.length === 0 && existente) {
    // Cambió algo que no nos importa (nota, envío…): solo se actualiza la marca de revisión.
    await prisma.pedidoCanal.update({
      where: { id: existente.id },
      data: { estadoCanal: pedido.status, modificadoEnCanal: modificado, revisadoEn: new Date() },
    });
    return { ...item, accion: 'omitir', motivo: 'cambio sin efecto en el maestro' };
  }

  await prisma.$transaction(async (tx) => {
    // Paso 1: upsert por (canalId, externoId), nunca create a secas.
    const datosPedido = {
      numero: pedido.number,
      estadoCanal: pedido.status,
      total: montoDesdeWoo(pedido.total),
      montoReembolsado: Math.abs(reembolsos.reduce((s, r) => s + montoDesdeWoo(r.amount), 0)),
      clienteEmail: pedido.billing?.email || null,
      clienteExternoId: pedido.customer_id > 0 ? pedido.customer_id : null,
      clienteId,
      creadoEnCanal: fechaGmt(pedido.date_created_gmt) ?? new Date(),
      modificadoEnCanal: modificado,
      revisadoEn: new Date(),
    };
    const fila = await tx.pedidoCanal.upsert({
      where: { canalId_externoId: { canalId, externoId: pedido.id } },
      create: { canalId, externoId: pedido.id, ...datosPedido },
      update: datosPedido,
      select: { id: true, ingeridoEn: true },
    });
    // Paso 3: líneas (upsert por (pedidoId, externoItemId)).
    const idsLinea = new Map<number, string>();
    for (const l of lineas) {
      const fl = await tx.pedidoCanalLinea.upsert({
        where: { pedidoId_externoItemId: { pedidoId: fila.id, externoItemId: l.externoItemId } },
        create: {
          pedidoId: fila.id,
          externoItemId: l.externoItemId,
          externoSku: l.externoSku,
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          cantidadDevuelta: l.cantidadDevuelta,
          precioUnitario: l.precioUnitario,
          productoId: l.productoId,
        },
        update: { cantidadDevuelta: l.cantidadDevuelta, ...(l.productoId ? { productoId: l.productoId } : {}) },
        select: { id: true },
      });
      idsLinea.set(l.externoItemId, fl.id);
    }

    if (esNuevo && pagado) {
      // Paso 4: líneas sin mapear → discrepancia enlazada a la línea.
      for (const l of lineas) {
        if (l.productoId) continue;
        await registrarDiscrepancia(tx, {
          canalId,
          tipo: 'producto_sin_mapear',
          pedidoCanalId: fila.id,
          pedidoCanalLineaId: idsLinea.get(l.externoItemId),
          valorCanal: l.cantidad,
          detalle: `${l.descripcion} (sku ${l.externoSku ?? '—'}) del pedido ${pedido.number}`,
        });
      }
      // Paso 6: descuento de stock, solo mapeadas con control. Ordenadas por productoId
      // (mismo orden de candados que la venta del mostrador).
      const conStock = lineas.filter((l) => l.productoId && l.controlaStock).sort((a, b) => a.productoId!.localeCompare(b.productoId!));
      for (const l of conStock) {
        const descuenta = Math.max(0, l.cantidad - l.cantidadDevuelta);
        if (descuenta === 0) continue;
        const r = await registrarMovimiento(tx, {
          productoId: l.productoId!,
          ubicacionId: ctx.ubicacionOnlineId,
          cantidad: -descuenta,
          motivo: 'venta_online',
          referenciaTipo: 'pedido_canal',
          referenciaId: fila.id,
          nota: `Pedido ${pedido.number} de ${canalId}`,
          usuarioId: ctx.usuarioId,
          permitirNegativo: true, // §8.4: el pedido pagado es un hecho; lo revisa una persona
        });
        if (r.quedaNegativo) {
          await registrarDiscrepancia(tx, {
            canalId,
            tipo: 'pedido_sin_stock',
            pedidoCanalId: fila.id,
            pedidoCanalLineaId: idsLinea.get(l.externoItemId),
            valorMaestro: r.cantidadNueva,
            valorCanal: descuenta,
            detalle: `${l.descripcion}: el pedido ${pedido.number} pide ${descuenta} y el maestro queda en ${r.cantidadNueva} en la ubicación online`,
          });
        }
      }
      // Paso 7.
      await tx.pedidoCanal.update({ where: { id: fila.id }, data: { ingeridoEn: new Date() } });
    } else if (!esNuevo) {
      // §8.3: cambios posteriores → discrepancia, nunca reversión automática.
      for (const c of candidatas) {
        const entrada: EntradaDiscrepancia = { canalId, tipo: c.tipo, pedidoCanalId: fila.id, detalle: c.detalle };
        const linea = lineas.find((l) => c.detalle.startsWith(`${l.descripcion}:`));
        if (linea && !anulado) entrada.pedidoCanalLineaId = idsLinea.get(linea.externoItemId);
        await registrarDiscrepancia(tx, entrada);
      }
    }
  });
  return item;
}

/**
 * Vincular a mano una línea sin mapear (§6.2). Si el pedido ya está ingerido y pagado y el
 * producto controla stock, el descuento que la ingesta no pudo hacer se hace ahora.
 */
export async function mapearLineaPedido(
  pedidoId: string,
  lineaId: string,
  productoId: string,
  usuarioId: string,
): Promise<{ movimientoId: string | null; cantidadNueva: number | null }> {
  const linea = await prisma.pedidoCanalLinea.findFirst({
    where: { id: lineaId, pedidoId },
    include: { pedido: true },
  });
  if (!linea) throw new ErrorCorrida({ error: 'LINEA_NO_ENCONTRADA' }, 404);
  if (linea.productoId) throw new ErrorCorrida({ error: 'LINEA_YA_MAPEADA', detalle: `La línea ya apunta al producto ${linea.productoId}` }, 409);
  const producto = await prisma.producto.findUnique({ where: { id: productoId }, select: { id: true, controlaStock: true, sku: true } });
  if (!producto) throw new ErrorCorrida({ error: 'PRODUCTO_NO_ENCONTRADO' }, 422);
  const ubicacion = await prisma.ubicacion.findUnique({ where: { codigo: entorno.syncUbicacionOnline } });
  if (!ubicacion) throw new ErrorCorrida({ error: 'UBICACION_ONLINE_NO_CONFIGURADA' }, 409);

  return prisma.$transaction(async (tx) => {
    await tx.pedidoCanalLinea.update({ where: { id: linea.id }, data: { productoId } });
    await tx.discrepancia.updateMany({
      where: { pedidoCanalLineaId: linea.id, tipo: 'producto_sin_mapear', estado: 'abierta' },
      data: { estado: 'resuelta', claveAbierta: null, resueltaEn: new Date(), resueltaPorId: usuarioId, accionTomada: `mapear:${producto.sku}` },
    });
    let movimientoId: string | null = null;
    let cantidadNueva: number | null = null;
    const descuenta = Math.max(0, linea.cantidad - linea.cantidadDevuelta);
    if (linea.pedido.ingeridoEn && pedidoPagado(linea.pedido.estadoCanal) && producto.controlaStock && descuenta > 0) {
      const r = await registrarMovimiento(tx, {
        productoId,
        ubicacionId: ubicacion.id,
        cantidad: -descuenta,
        motivo: 'venta_online',
        referenciaTipo: 'pedido_canal',
        referenciaId: linea.pedidoId,
        nota: `Pedido ${linea.pedido.numero} de ${linea.pedido.canalId} (mapeado a mano)`,
        usuarioId,
        permitirNegativo: true,
      });
      movimientoId = r.movimientoId;
      cantidadNueva = r.cantidadNueva;
      if (r.quedaNegativo) {
        await registrarDiscrepancia(tx, {
          canalId: linea.pedido.canalId,
          tipo: 'pedido_sin_stock',
          pedidoCanalId: linea.pedidoId,
          pedidoCanalLineaId: linea.id,
          valorMaestro: r.cantidadNueva,
          valorCanal: descuenta,
          detalle: `${linea.descripcion}: el pedido ${linea.pedido.numero} pide ${descuenta} y el maestro queda en ${r.cantidadNueva}`,
        });
      }
    }
    await tx.auditoria.create({
      data: {
        usuarioId,
        entidad: 'pedido_canal',
        entidadId: linea.pedidoId,
        accion: 'editar',
        valorAnterior: { lineaId: linea.id, productoId: null },
        valorNuevo: { lineaId: linea.id, productoId, sku: producto.sku, movimientoId },
      },
    });
    return { movimientoId, cantidadNueva };
  });
}
