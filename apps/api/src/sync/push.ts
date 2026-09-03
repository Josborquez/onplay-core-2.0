// Push maestro → canal — docs/06-SDD-etapa3-sincronizacion.md §4, §6.1 y §7.
// E3a precio (Fase 3), E3b stock + adopción (Fase 4). dryRun por defecto en todo (S1):
// la simulación solo deja la SyncCorrida; no escribe en el canal, no crea discrepancias
// ni toca ProductoCanal. Toda escritura pasa por ClienteWoo.actualizarProducto/Variacion
// (PUT acotado, candado SYNC_SOLO_LECTURA) y S_publicado se guarda DESPUÉS del 200 (§4.1).
import type { Prisma, TipoDiscrepancia } from '@prisma/client';
import type { ClienteWoo, ProductoWoo, VariacionWoo } from '@onplay/woo-client';
import { decidirPushPrecio, decidirPushStock } from '@onplay/dominio';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import {
  ErrorCorrida,
  abrirCorrida,
  cerrarCorrida,
  clienteDelCanal,
  contadoresVacios,
  usuarioSistemaId,
  type ContadoresCorrida,
} from './corridas.js';
import { cerrarAbiertasDe, registrarDiscrepancia } from './discrepancias.js';
import type { CanalWoo } from './importador.js';
import { CLAVE_PADRE_EXTERNO } from './variaciones.js';

export interface OpcionesPush {
  dryRun: boolean;
  usuarioId: string | null;
  /** Acotar a estos productos (publicación a demanda, G9). */
  productoIds?: string[];
}

export interface ItemPlanPush {
  sku: string;
  externoId: number;
  accion: 'escribir' | 'detener' | 'omitir' | 'fallar';
  motivo?: string;
  precio?: { maestro: number; canal: number | null; publicado: number | null };
  stock?: { maestro: number; canal: number | null; publicado: number | null };
  explicacion?: string;
  discrepanciaId?: string;
}

export interface ResumenPush {
  corridaId: string;
  simulacion: boolean;
  tipo: 'precios' | 'stock' | 'adopcion';
  canalId: string;
  resumen: ContadoresCorrida;
  /** Vínculos publicados que NO entran a la corrida de stock (sin controlaStock, §7.3). */
  noElegibles?: number;
  omitida?: string;
  advertencia?: string;
  plan: ItemPlanPush[];
}

type Vinculo = Prisma.ProductoCanalGetPayload<{
  include: { producto: { select: { id: true; sku: true; precioVenta: true; controlaStock: true; atributos: true } } };
}>;

interface LecturaCanal {
  existe: boolean;
  regular: number | null;
  enOferta: boolean;
  manejaStock: boolean | null;
  stock: number | null;
}

function padreDe(v: Vinculo): number | null {
  const a = v.producto.atributos as Record<string, unknown> | null;
  // El importador lo guarda como string ("2897", R-003); se acepta número o string numérico.
  const p = Number(a?.[CLAVE_PADRE_EXTERNO]);
  return Number.isInteger(p) && p > 0 ? p : null;
}

function precioNumero(texto: string | undefined | null): number | null {
  if (texto === undefined || texto === null || texto === '') return null;
  const n = Math.round(Number(texto));
  return Number.isFinite(n) ? n : null;
}

function lecturaDe(p: ProductoWoo | VariacionWoo): LecturaCanal {
  const manage = p.manage_stock;
  return {
    existe: true,
    regular: precioNumero(p.regular_price),
    enOferta: p.on_sale === true || (p.sale_price !== undefined && p.sale_price !== ''),
    manejaStock: manage === 'parent' ? true : typeof manage === 'boolean' ? manage : null,
    stock: typeof p.stock_quantity === 'number' ? p.stock_quantity : null,
  };
}

/**
 * S_canal por listado paginado (§7.5): simples por `include` de a 100; variaciones con una
 * llamada por padre. Lo que no vuelve se marca `existe: false` (§7.7, producto desaparecido).
 */
async function leerCanal(cliente: ClienteWoo, vinculos: Vinculo[]): Promise<Map<number, LecturaCanal>> {
  const lectura = new Map<number, LecturaCanal>();
  const simples: number[] = [];
  const porPadre = new Map<number, number[]>();
  for (const v of vinculos) {
    const padre = padreDe(v);
    if (padre) porPadre.set(padre, [...(porPadre.get(padre) ?? []), v.externoId!]);
    else simples.push(v.externoId!);
  }
  for (const p of await cliente.listarProductosPorIds(simples)) lectura.set(p.id, lecturaDe(p));
  for (const [padre, hijos] of porPadre) {
    try {
      const variaciones = await cliente.listarVariaciones(padre);
      for (const va of variaciones) if (hijos.includes(va.id)) lectura.set(va.id, lecturaDe(va));
    } catch (e) {
      if (!/HTTP 404/.test((e as Error).message)) throw e;
    }
  }
  for (const v of vinculos) {
    if (!lectura.has(v.externoId!)) lectura.set(v.externoId!, { existe: false, regular: null, enOferta: false, manejaStock: null, stock: null });
  }
  return lectura;
}

/** Concurrencia limitada (§7.1): n a la vez, sin abortar el lote por un fallo. */
async function enParalelo<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const trabajador = async () => {
    while (i < items.length) {
      const item = items[i++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, trabajador));
}

async function vinculosElegibles(canalId: string, soloConControl: boolean, productoIds?: string[]): Promise<Vinculo[]> {
  return prisma.productoCanal.findMany({
    where: {
      canalId,
      publicado: true,
      externoId: { not: null },
      producto: { activo: true, ...(soloConControl ? { controlaStock: true } : {}), ...(productoIds ? { id: { in: productoIds } } : {}) },
    },
    include: { producto: { select: { id: true, sku: true, precioVenta: true, controlaStock: true, atributos: true } } },
    orderBy: { externoId: 'asc' },
  });
}

async function escribirEnCanal(cliente: ClienteWoo, v: Vinculo, cambios: { regular_price?: string; stock_quantity?: number }) {
  const padre = padreDe(v);
  if (padre) await cliente.actualizarVariacion(padre, v.externoId!, cambios);
  else await cliente.actualizarProducto(v.externoId!, cambios);
}

async function productoDesaparecido(canalId: string, v: Vinculo, dryRun: boolean): Promise<string | undefined> {
  if (dryRun) return undefined;
  await prisma.productoCanal.update({ where: { id: v.id }, data: { publicado: false, sincronizadoEn: new Date() } });
  const d = await registrarDiscrepancia(prisma, {
    canalId,
    tipo: 'producto_desaparecido',
    productoCanalId: v.id,
    detalle: `El canal respondió 404 para externoId=${v.externoId}; se marcó publicado=false, nada se borra (P9)`,
  });
  return d.id;
}

// ─── E3a · precio (§4.3) ──────────────────────────────────────────────────────

export async function publicarPrecios(canalId: CanalWoo, op: OpcionesPush): Promise<ResumenPush> {
  const canal = await prisma.canal.findUnique({ where: { id: canalId } });
  if (!canal) throw new ErrorCorrida({ error: 'CANAL_DESCONOCIDO' }, 404);
  if (!op.dryRun && !canal.pushPrecio) throw new ErrorCorrida({ error: 'PUSH_APAGADO', detalle: 'pushPrecio apagado en el canal (G8)' }, 409);
  const cliente = clienteDelCanal(canalId);
  const corrida = await abrirCorrida(canalId, 'precios', { simulacion: op.dryRun, usuarioId: op.usuarioId });
  const contadores = contadoresVacios();
  const plan: ItemPlanPush[] = [];
  try {
    const vinculos = await vinculosElegibles(canalId, false, op.productoIds);
    contadores.leidos = vinculos.length;
    const lectura = await leerCanal(cliente, vinculos);
    const aEscribir: { v: Vinculo; maestro: number; item: ItemPlanPush }[] = [];

    for (const v of vinculos) {
      const l = lectura.get(v.externoId!)!;
      const maestro = v.precioCanal ?? v.producto.precioVenta;
      const item: ItemPlanPush = { sku: v.producto.sku, externoId: v.externoId!, accion: 'omitir', precio: { maestro, canal: l.regular, publicado: v.precioPublicado } };
      if (!l.existe) {
        item.accion = 'detener';
        item.motivo = 'producto_desaparecido';
        item.discrepanciaId = await productoDesaparecido(canalId, v, op.dryRun);
        contadores.detenidos += 1;
        plan.push(item);
        continue;
      }
      const d = decidirPushPrecio({ publicado: v.publicado, maestro, regularCanal: l.regular, enOferta: l.enOferta, precioPublicado: v.precioPublicado });
      if (d.informativa && !op.dryRun) {
        const disc = await registrarDiscrepancia(prisma, {
          canalId,
          tipo: 'precio_derivado',
          productoCanalId: v.id,
          valorMaestro: maestro,
          valorCanal: l.regular,
          valorPublicado: v.precioPublicado,
          detalle: `regular_price del canal (${l.regular}) ≠ último publicado (${v.precioPublicado}); se escribe igual (§4.3)`,
        });
        item.discrepanciaId = disc.id;
      }
      if (d.informativa) item.explicacion = 'El precio del canal cambió por fuera del maestro; se escribe igual (informativa).';
      if (d.accion === 'detener') {
        item.accion = 'detener';
        item.motivo = d.motivo;
        contadores.detenidos += 1;
        if (!op.dryRun) {
          const disc = await registrarDiscrepancia(prisma, {
            canalId,
            tipo: 'precio_en_oferta',
            productoCanalId: v.id,
            valorMaestro: maestro,
            valorCanal: l.regular,
            valorPublicado: v.precioPublicado,
            detalle: 'sale_price activo en el canal: el maestro no toca su precio (§4.3, RS7)',
          });
          item.discrepanciaId = disc.id;
          await prisma.productoCanal.update({ where: { id: v.id }, data: { syncPrecio: 'detenido', syncMensaje: 'producto en oferta' } });
        }
      } else if (d.accion === 'omitir') {
        item.motivo = d.motivo ?? 'al_dia';
        contadores.omitidos += 1;
        if (!op.dryRun && !d.motivo && v.syncPrecio !== 'al_dia') {
          await prisma.productoCanal.update({ where: { id: v.id }, data: { syncPrecio: 'al_dia', syncMensaje: null, precioPublicado: v.precioPublicado ?? maestro } });
        }
      } else {
        item.accion = 'escribir';
        contadores.aEscribir += 1;
        aEscribir.push({ v, maestro, item });
      }
      plan.push(item);
    }

    if (!op.dryRun) {
      await enParalelo(aEscribir, entorno.syncConcurrencia, async ({ v, maestro, item }) => {
        try {
          await escribirEnCanal(cliente, v, { regular_price: String(maestro) });
          // S_publicado se guarda DESPUÉS del 200, en una transacción corta (§4.1).
          await prisma.productoCanal.update({
            where: { id: v.id },
            data: { precioPublicado: maestro, publicadoEn: new Date(), syncPrecio: 'al_dia', syncMensaje: null },
          });
          await prisma.syncCorridaItem.create({ data: { corridaId: corrida.id, sku: v.producto.sku, accion: 'escribir', valorAntes: item.precio!.canal, valorDespues: maestro } });
          contadores.escritos += 1;
        } catch (e) {
          const mensaje = (e as Error).message;
          item.accion = 'fallar';
          item.motivo = mensaje;
          contadores.fallidos += 1;
          await prisma.productoCanal.update({ where: { id: v.id }, data: { syncPrecio: 'error', syncMensaje: mensaje } });
          await prisma.syncCorridaItem.create({ data: { corridaId: corrida.id, sku: v.producto.sku, accion: 'fallar', valorAntes: item.precio!.canal, valorDespues: maestro, mensaje } });
        }
      });
      for (const it of plan) {
        if (it.accion === 'detener') await prisma.syncCorridaItem.create({ data: { corridaId: corrida.id, sku: it.sku, accion: 'detener', valorAntes: it.precio?.canal ?? null, valorDespues: it.precio?.maestro ?? null, mensaje: it.motivo } });
      }
    }
  } catch (e) {
    await cerrarCorrida(corrida.id, 'abortada', contadores, `lectura del canal fallida: ${(e as Error).message}`);
    if (e instanceof ErrorCorrida) throw e;
    throw new ErrorCorrida({ error: 'CANAL_ILEGIBLE', detalle: (e as Error).message, corridaId: corrida.id }, 502);
  }
  await cerrarCorrida(corrida.id, 'terminada', contadores);
  if (!op.dryRun && contadores.fallidos === 0 && !op.productoIds) {
    await prisma.canal.update({ where: { id: canalId }, data: { ultimoPushPrecioEn: new Date() } });
  }
  return { corridaId: corrida.id, simulacion: op.dryRun, tipo: 'precios', canalId, resumen: contadores, plan };
}

// ─── E3b · stock (§4.1, §4.2, §7.3) ───────────────────────────────────────────

async function stockMaestroPublicable(productoIds: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (productoIds.length === 0) return mapa;
  const publicables = await prisma.ubicacion.findMany({ where: { publicable: true, activa: true }, select: { id: true } });
  if (publicables.length === 0) return mapa;
  const filas = await prisma.stockActual.groupBy({
    by: ['productoId'],
    where: { productoId: { in: productoIds }, ubicacionId: { in: publicables.map((u) => u.id) } },
    _sum: { cantidad: true },
  });
  for (const f of filas) mapa.set(f.productoId, f._sum.cantidad ?? 0);
  return mapa;
}

async function ingestaReciente(canalId: string): Promise<boolean> {
  const desde = new Date(Date.now() - entorno.syncVentanaIngestaMin * 60 * 1000);
  const c = await prisma.syncCorrida.findFirst({
    where: { canalId, tipo: 'pedidos', estado: 'terminada', simulacion: false, iniciadaEn: { gte: desde } },
    select: { id: true },
  });
  return !!c;
}

const TIPO_POR_MOTIVO: Record<string, TipoDiscrepancia> = {
  stock_derivado: 'stock_derivado',
  primera_publicacion: 'primera_publicacion',
  canal_sin_gestion: 'canal_sin_gestion',
};

export async function publicarStock(canalId: CanalWoo, op: OpcionesPush): Promise<ResumenPush> {
  const canal = await prisma.canal.findUnique({ where: { id: canalId } });
  if (!canal) throw new ErrorCorrida({ error: 'CANAL_DESCONOCIDO' }, 404);
  if (!op.dryRun && !canal.pushStock) throw new ErrorCorrida({ error: 'PUSH_APAGADO', detalle: 'pushStock apagado en el canal (G8)' }, 409);
  const cliente = clienteDelCanal(canalId);
  const corrida = await abrirCorrida(canalId, 'stock', { simulacion: op.dryRun, usuarioId: op.usuarioId });
  const contadores = contadoresVacios();
  const plan: ItemPlanPush[] = [];

  // §4.2: el orden se garantiza por dependencia. Sin ingesta reciente la corrida real se omite entera.
  const hayIngesta = await ingestaReciente(canalId);
  if (!hayIngesta && !op.dryRun) {
    const omitida = `sin corrida de pedidos terminada en los últimos ${entorno.syncVentanaIngestaMin} min (§4.2)`;
    await cerrarCorrida(corrida.id, 'abortada', contadores, `omitida: ${omitida}`);
    return { corridaId: corrida.id, simulacion: false, tipo: 'stock', canalId, resumen: contadores, omitida, plan };
  }

  let noElegibles = 0;
  try {
    const [vinculos, publicados] = await Promise.all([
      vinculosElegibles(canalId, true, op.productoIds),
      prisma.productoCanal.count({ where: { canalId, publicado: true, externoId: { not: null }, producto: { activo: true, controlaStock: false } } }),
    ]);
    noElegibles = publicados;
    contadores.leidos = vinculos.length;
    const [lectura, maestroPor] = await Promise.all([leerCanal(cliente, vinculos), stockMaestroPublicable(vinculos.map((v) => v.productoId))]);
    const aEscribir: { v: Vinculo; maestro: number; item: ItemPlanPush }[] = [];

    for (const v of vinculos) {
      const l = lectura.get(v.externoId!)!;
      const maestro = maestroPor.get(v.productoId) ?? 0;
      const item: ItemPlanPush = { sku: v.producto.sku, externoId: v.externoId!, accion: 'omitir', stock: { maestro, canal: l.stock, publicado: v.stockPublicado } };
      if (!l.existe) {
        item.accion = 'detener';
        item.motivo = 'producto_desaparecido';
        item.discrepanciaId = await productoDesaparecido(canalId, v, op.dryRun);
        contadores.detenidos += 1;
        plan.push(item);
        continue;
      }
      // Espejo de E2 (solo lectura) de paso: ya leímos el stock del canal.
      if (!op.dryRun && (v.stockCanal !== l.stock || v.manejaStockCanal !== l.manejaStock)) {
        await prisma.productoCanal.update({ where: { id: v.id }, data: { stockCanal: l.stock, manejaStockCanal: l.manejaStock, stockCanalEn: new Date() } });
      }
      const d = decidirPushStock({ controlaStock: v.producto.controlaStock, publicado: v.publicado, manejaStockCanal: l.manejaStock, maestro, canal: l.stock, publicadoAntes: v.stockPublicado });
      if (d.accion === 'detener') {
        item.accion = 'detener';
        item.motivo = d.motivo;
        item.explicacion = d.explicacion;
        contadores.detenidos += 1;
        if (!op.dryRun) {
          const disc = await registrarDiscrepancia(prisma, {
            canalId,
            tipo: TIPO_POR_MOTIVO[d.motivo!] ?? 'stock_derivado',
            productoCanalId: v.id,
            valorMaestro: maestro,
            valorCanal: l.stock,
            valorPublicado: v.stockPublicado,
            detalle: d.explicacion ?? null,
          });
          item.discrepanciaId = disc.id;
          await prisma.productoCanal.update({ where: { id: v.id }, data: { syncStock: 'detenido', syncMensaje: d.explicacion ?? d.motivo ?? null } });
        }
      } else if (d.accion === 'omitir') {
        item.motivo = d.motivo ?? 'al_dia';
        contadores.omitidos += 1;
        if (!op.dryRun && !d.motivo && v.syncStock !== 'al_dia') {
          await prisma.productoCanal.update({ where: { id: v.id }, data: { syncStock: 'al_dia', syncMensaje: null } });
        }
      } else {
        item.accion = 'escribir';
        contadores.aEscribir += 1;
        aEscribir.push({ v, maestro, item });
      }
      plan.push(item);
    }

    if (!op.dryRun) {
      await enParalelo(aEscribir, entorno.syncConcurrencia, async ({ v, maestro, item }) => {
        try {
          await escribirEnCanal(cliente, v, { stock_quantity: maestro });
          await prisma.productoCanal.update({
            where: { id: v.id },
            data: { stockPublicado: maestro, stockCanal: maestro, stockCanalEn: new Date(), publicadoEn: new Date(), syncStock: 'al_dia', syncMensaje: null },
          });
          await prisma.syncCorridaItem.create({ data: { corridaId: corrida.id, sku: v.producto.sku, accion: 'escribir', valorAntes: item.stock!.canal, valorDespues: maestro } });
          contadores.escritos += 1;
        } catch (e) {
          const mensaje = (e as Error).message;
          item.accion = 'fallar';
          item.motivo = mensaje;
          contadores.fallidos += 1;
          await prisma.productoCanal.update({ where: { id: v.id }, data: { syncStock: 'error', syncMensaje: mensaje } });
          await prisma.syncCorridaItem.create({ data: { corridaId: corrida.id, sku: v.producto.sku, accion: 'fallar', valorAntes: item.stock!.canal, valorDespues: maestro, mensaje } });
        }
      });
      for (const it of plan) {
        if (it.accion === 'detener') await prisma.syncCorridaItem.create({ data: { corridaId: corrida.id, sku: it.sku, accion: 'detener', valorAntes: it.stock?.canal ?? null, valorDespues: it.stock?.maestro ?? null, mensaje: it.motivo } });
      }
    }
  } catch (e) {
    await cerrarCorrida(corrida.id, 'abortada', contadores, `lectura del canal fallida: ${(e as Error).message}`);
    if (e instanceof ErrorCorrida) throw e;
    throw new ErrorCorrida({ error: 'CANAL_ILEGIBLE', detalle: (e as Error).message, corridaId: corrida.id }, 502);
  }
  await cerrarCorrida(corrida.id, 'terminada', contadores);
  if (!op.dryRun && contadores.fallidos === 0 && !op.productoIds) {
    await prisma.canal.update({ where: { id: canalId }, data: { ultimoPushStockEn: new Date() } });
  }
  return {
    corridaId: corrida.id,
    simulacion: op.dryRun,
    tipo: 'stock',
    canalId,
    resumen: contadores,
    noElegibles,
    ...(op.dryRun && !hayIngesta ? { advertencia: 'sin ingesta reciente: la corrida real se omitiría (§4.2)' } : {}),
    plan,
  };
}

// ─── Adopción inicial (§4.4) ──────────────────────────────────────────────────

export async function adoptarStock(canalId: CanalWoo, op: OpcionesPush): Promise<ResumenPush> {
  const canal = await prisma.canal.findUnique({ where: { id: canalId } });
  if (!canal) throw new ErrorCorrida({ error: 'CANAL_DESCONOCIDO' }, 404);
  const cliente = clienteDelCanal(canalId);
  const corrida = await abrirCorrida(canalId, 'adopcion', { simulacion: op.dryRun, usuarioId: op.usuarioId });
  const contadores = contadoresVacios();
  const plan: ItemPlanPush[] = [];
  try {
    const vinculos = await vinculosElegibles(canalId, true, op.productoIds);
    contadores.leidos = vinculos.length;
    const [lectura, maestroPor] = await Promise.all([leerCanal(cliente, vinculos), stockMaestroPublicable(vinculos.map((v) => v.productoId))]);
    for (const v of vinculos) {
      const l = lectura.get(v.externoId!)!;
      const maestro = maestroPor.get(v.productoId) ?? 0;
      const item: ItemPlanPush = { sku: v.producto.sku, externoId: v.externoId!, accion: 'omitir', stock: { maestro, canal: l.stock, publicado: v.stockPublicado } };
      if (!l.existe || l.manejaStock === false || l.stock === null) {
        item.accion = 'detener';
        item.motivo = !l.existe ? 'producto_desaparecido' : 'canal_sin_gestion';
        item.explicacion = !l.existe ? 'El canal no devolvió el producto' : 'El canal no gestiona stock para este producto (manage_stock apagado); encenderlo es decisión de una persona (§7.4).';
        contadores.detenidos += 1;
        if (!op.dryRun) {
          const disc = !l.existe
            ? { id: await productoDesaparecido(canalId, v, false) }
            : await registrarDiscrepancia(prisma, { canalId, tipo: 'canal_sin_gestion', productoCanalId: v.id, valorMaestro: maestro, valorCanal: l.stock, detalle: item.explicacion });
          item.discrepanciaId = disc.id;
        }
      } else if (v.stockPublicado === l.stock) {
        item.motivo = 'ya_adoptado';
        contadores.omitidos += 1;
      } else {
        item.accion = 'escribir'; // "escribir" en el maestro: stockPublicado = S_canal, sin tocar el canal
        contadores.aEscribir += 1;
        if (!op.dryRun) {
          await prisma.productoCanal.update({
            where: { id: v.id },
            data: {
              stockPublicado: l.stock,
              stockCanal: l.stock,
              manejaStockCanal: l.manejaStock,
              stockCanalEn: new Date(),
              syncStock: maestro === l.stock ? 'al_dia' : 'por_publicar',
              syncMensaje: null,
            },
          });
          await prisma.syncCorridaItem.create({ data: { corridaId: corrida.id, sku: v.producto.sku, accion: 'escribir', valorAntes: v.stockPublicado, valorDespues: l.stock, mensaje: 'adopción: stockPublicado = stock del canal' } });
          // Adoptar cierra la primera_publicacion abierta de ese vínculo: ya tiene punto de partida.
          await cerrarAbiertasDe(prisma, { canalId, tipo: 'primera_publicacion', productoCanalId: v.id }, { usuarioId: op.usuarioId ?? (await usuarioSistemaId()), accionTomada: `adopcion:${corrida.id}` });
          contadores.escritos += 1;
        }
      }
      plan.push(item);
    }
  } catch (e) {
    await cerrarCorrida(corrida.id, 'abortada', contadores, `lectura del canal fallida: ${(e as Error).message}`);
    if (e instanceof ErrorCorrida) throw e;
    throw new ErrorCorrida({ error: 'CANAL_ILEGIBLE', detalle: (e as Error).message, corridaId: corrida.id }, 502);
  }
  await cerrarCorrida(corrida.id, 'terminada', contadores);
  if (!op.dryRun) {
    await prisma.auditoria.create({
      data: {
        usuarioId: op.usuarioId ?? (await usuarioSistemaId()),
        entidad: 'canal',
        entidadId: canalId,
        accion: 'ajustar_stock',
        valorNuevo: { adopcion: corrida.id, ...contadores },
      },
    });
  }
  return { corridaId: corrida.id, simulacion: op.dryRun, tipo: 'adopcion', canalId, resumen: contadores, plan };
}

// ─── Imponer el maestro (§6.2, admin) ─────────────────────────────────────────

/** Escribe en el canal el valor del maestro para una discrepancia de stock o precio. */
export async function imponerMaestro(
  d: { id: string; tipo: TipoDiscrepancia; canalId: string; productoCanalId: string | null },
): Promise<{ valorEscrito: number; campo: 'stock_quantity' | 'regular_price' }> {
  if (!d.productoCanalId) throw new ErrorCorrida({ error: 'ACCION_NO_APLICA', detalle: 'imponer_maestro exige una discrepancia de producto' });
  const v = await prisma.productoCanal.findUniqueOrThrow({
    where: { id: d.productoCanalId },
    include: { producto: { select: { id: true, sku: true, precioVenta: true, controlaStock: true, atributos: true } } },
  });
  if (!v.externoId) throw new ErrorCorrida({ error: 'SIN_EXTERNO_ID' });
  const cliente = clienteDelCanal(d.canalId as CanalWoo);
  const esPrecio = d.tipo === 'precio_derivado' || d.tipo === 'precio_en_oferta';
  if (esPrecio) {
    const maestro = v.precioCanal ?? v.producto.precioVenta;
    await escribirEnCanal(cliente, v, { regular_price: String(maestro) });
    await prisma.productoCanal.update({ where: { id: v.id }, data: { precioPublicado: maestro, publicadoEn: new Date(), syncPrecio: 'al_dia', syncMensaje: null } });
    return { valorEscrito: maestro, campo: 'regular_price' };
  }
  if (!v.producto.controlaStock) throw new ErrorCorrida({ error: 'SIN_CONTROL_STOCK', detalle: 'El producto no controla stock (§7.3)' });
  const maestro = (await stockMaestroPublicable([v.productoId])).get(v.productoId) ?? 0;
  await escribirEnCanal(cliente, v, { stock_quantity: maestro });
  await prisma.productoCanal.update({
    where: { id: v.id },
    data: { stockPublicado: maestro, stockCanal: maestro, stockCanalEn: new Date(), publicadoEn: new Date(), syncStock: 'al_dia', syncMensaje: null },
  });
  return { valorEscrito: maestro, campo: 'stock_quantity' };
}

// ─── Publicación a demanda (G9) ───────────────────────────────────────────────

/** Al guardar un precio: publica el producto en cada canal con pushPrecio encendido. */
export async function publicarProductoADemanda(productoId: string, usuarioId: string | null): Promise<Record<string, string>> {
  const canales = await prisma.canal.findMany({ where: { tipo: 'woocommerce', activo: true, pushPrecio: true }, select: { id: true } });
  const resultado: Record<string, string> = {};
  for (const { id } of canales) {
    try {
      const r = await publicarPrecios(id as CanalWoo, { dryRun: false, usuarioId, productoIds: [productoId] });
      const it = r.plan[0];
      resultado[id] = it ? `${it.accion}${it.motivo ? ' (' + it.motivo + ')' : ''}` : 'sin vínculo';
    } catch (e) {
      resultado[id] = e instanceof ErrorCorrida ? e.cuerpo.error : (e as Error).message;
    }
  }
  return resultado;
}
