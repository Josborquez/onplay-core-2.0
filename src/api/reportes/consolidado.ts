// R-036 — Lectura consolidada de ventas por canal (docs/14 §4 y §5).
// Dos fuentes, una sola forma: `Venta`/`VentaLinea` del mostrador y `PedidoCanal`/`PedidoCanalLinea`
// de las tiendas web. NO se crean ventas POS ficticias para los pedidos web (exigirían turno de
// caja y moverían caja y stock). Este módulo SOLO lee: ningún reporte escribe (P5/P9).
import {
  calcularMargen,
  consolidarCanales,
  type ConsolidadoCanales,
  type LineaAnalitica,
  type Margen,
  type OperacionAnalitica,
} from '@onplay/dominio';
import { prisma } from '../db.js';
import { fechaChile, periodoDe, rangoChile, type Agrupar } from '../fechas.js';

/** SKU de la carga de saldo (E4 §6.3): es un movimiento de monedero, no una venta comercial. */
const SKU_CARGA = 'SRV-000001';
/** Criterio operativo de venta en Woo (§8 de E3). No es conciliación bancaria. */
const ESTADOS_VENTA_WEB = new Set(['processing', 'completed']);
const ESTADOS_ANULADOS_WEB = new Set(['cancelled', 'refunded', 'failed']);

export interface FiltrosReporte {
  desde: string;
  hasta: string;
  canalIds?: string[];
  categoriaIds?: string[];
  juego?: string;
  tipo?: string;
  /**
   * Opción EXPLÍCITA (docs/14 §6.2): para las líneas sin costo congelado, imputa el costo de
   * referencia de HOY. Queda rotulado como estimación; por defecto esas líneas no tienen margen.
   */
  costoActual?: boolean;
}

export interface Cobertura {
  canalId: string;
  nombre: string;
  activo: boolean;
  /** Fecha del dato más antiguo del canal: NO prueba por sí sola cobertura completa (§6). */
  primeraFecha: string | null;
  ultimaFecha: string | null;
  ultimaIngestaEn: string | null;
  operacionesEnPeriodo: number;
  /** true cuando el canal no tiene ningún dato: se dice «Sin datos suficientes», no «$0». */
  sinDatos: boolean;
  /** Errores abiertos del canal en SyncLog: avisan de lagunas. */
  erroresAbiertos: number;
}

export interface FilaCategoria {
  canalId: string;
  categoriaId: string | null;
  categoria: string;
  unidadesNetas: number;
  importe: number;
  porcentaje: number | null;
}

export interface ReporteCanales {
  desde: string;
  hasta: string;
  agrupar: Agrupar;
  consultadoEn: string;
  criterio: string;
  consolidado: ConsolidadoCanales;
  canales: { id: string; nombre: string; activo: boolean }[];
  evolucion: { periodo: string; canalId: string; importeAjustado: number; operaciones: number }[];
  categorias: FilaCategoria[];
  margen: Margen & { estimadoACostoActual: boolean };
  /** Importe de pedidos web que no está en ninguna línea: envío, cargos y ajustes (§5). */
  noAtribuible: number;
  desglose: { impuestos: number | null; envio: number | null; descuentos: number | null };
  cobertura: Cobertura[];
  filtrado: boolean;
}

/** Origen de cada línea, en el MISMO orden que `ctx.lineas`: permite rearmar el universo
 * cuando hay filtros de producto (§5: el filtro es por línea, no arrastra el pedido entero). */
interface OrigenLinea {
  operacionId: string;
  canalId: string;
  dia: string;
  fuente: 'pos' | 'web';
}

interface Contexto {
  operaciones: OperacionAnalitica[];
  lineas: LineaAnalitica[];
  origen: OrigenLinea[];
  sinReposicion: number[];
  noAtribuible: number;
  desglose: { impuestos: number | null; envio: number | null; descuentos: number | null };
}

/** Reparte un importe entre partes por peso, con resto mayor: la suma cuadra exacta (§8). */
function repartir(total: number, pesos: number[]): number[] {
  const suma = pesos.reduce((a, b) => a + b, 0);
  if (suma <= 0 || total === 0) return pesos.map(() => 0);
  const brutos = pesos.map((p) => (total * p) / suma);
  const base = brutos.map((b) => Math.floor(b));
  let resto = total - base.reduce((a, b) => a + b, 0);
  const orden = brutos
    .map((b, i) => ({ i, frac: b - Math.floor(b) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of orden) {
    if (resto <= 0) break;
    base[i] = base[i]! + 1;
    resto -= 1;
  }
  return base;
}

async function leerPos(f: FiltrosReporte, inicio: Date, fin: Date, ctx: Contexto): Promise<void> {
  const ventas = await prisma.venta.findMany({
    where: { creadoEn: { gte: inicio, lt: fin }, ...(f.canalIds ? { canalId: { in: f.canalIds } } : {}) },
    select: {
      id: true,
      folio: true,
      canalId: true,
      total: true,
      descuento: true,
      estado: true,
      creadoEn: true,
      lineas: {
        select: {
          id: true,
          descripcion: true,
          cantidad: true,
          totalLinea: true,
          costoUnitario: true,
          costoEn: true,
          producto: {
            select: { id: true, sku: true, juego: true, tipo: true, categoriaId: true, costoReferencia: true, categoria: { select: { nombre: true } } },
          },
          devolucionLineas: { select: { cantidad: true, montoLinea: true, reponeStock: true } },
        },
      },
      devoluciones: { select: { monto: true } },
    },
  });

  for (const v of ventas) {
    const dia = fechaChile(v.creadoEn);
    const cargaMonedero = v.lineas.filter((l) => l.producto?.sku === SKU_CARGA).reduce((a, l) => a + l.totalLinea, 0);
    const comerciales = v.lineas.filter((l) => l.producto?.sku !== SKU_CARGA);
    const reembolsos = v.devoluciones.reduce((a, d) => a + d.monto, 0);
    const unidades = comerciales.reduce((a, l) => a + l.cantidad, 0);
    const devueltas = comerciales.reduce((a, l) => a + l.devolucionLineas.reduce((b, d) => b + d.cantidad, 0), 0);
    ctx.operaciones.push({
      id: v.id,
      fuente: 'pos',
      canalId: v.canalId,
      referencia: v.folio,
      dia,
      moneda: 'CLP',
      estado: v.estado === 'anulada' ? 'anulada' : 'valida',
      // El descuento global ya está dentro de `total`; la carga de saldo sale aparte (§4).
      importeBruto: Math.max(0, v.total - cargaMonedero),
      reembolsos,
      unidades,
      unidadesDevueltas: devueltas,
      cargaMonedero,
    });
    if (v.estado === 'anulada') continue;

    for (const l of comerciales) {
      const p = l.producto;
      if (!coincideFiltro(f, p?.categoriaId ?? null, p?.juego ?? null, p?.tipo ?? null)) continue;
      const devueltasLinea = l.devolucionLineas.reduce((a, d) => a + d.cantidad, 0);
      const montoDevuelto = l.devolucionLineas.reduce((a, d) => a + d.montoLinea, 0);
      const dañadas = l.devolucionLineas.filter((d) => !d.reponeStock).reduce((a, d) => a + d.cantidad, 0);
      ctx.lineas.push({
        canalId: v.canalId,
        categoriaId: p?.categoriaId ?? null,
        categoria: p?.categoria?.nombre ?? null,
        juego: p?.juego ?? null,
        tipo: p?.tipo ?? null,
        productoId: p?.id ?? null,
        sku: p?.sku ?? null,
        descripcion: l.descripcion,
        unidades: l.cantidad,
        unidadesDevueltas: devueltasLinea,
        importe: l.totalLinea - montoDevuelto,
        // Costo congelado al vender; si la línea es vieja queda desconocido salvo que se pida
        // explícitamente la estimación a costo de hoy (§6.2).
        costoUnitario: l.costoUnitario ?? (f.costoActual ? (p?.costoReferencia ?? null) : null),
        costoCongelado: l.costoEn !== null,
      });
      ctx.origen.push({ operacionId: v.id, canalId: v.canalId, dia, fuente: 'pos' });
      ctx.sinReposicion.push(dañadas);
    }
  }
}

async function leerWeb(f: FiltrosReporte, inicio: Date, fin: Date, ctx: Contexto): Promise<void> {
  const pedidos = await prisma.pedidoCanal.findMany({
    where: { creadoEnCanal: { gte: inicio, lt: fin }, ...(f.canalIds ? { canalId: { in: f.canalIds } } : {}) },
    select: {
      id: true,
      canalId: true,
      numero: true,
      estadoCanal: true,
      total: true,
      montoReembolsado: true,
      moneda: true,
      totalImpuestos: true,
      totalEnvio: true,
      totalDescuento: true,
      creadoEnCanal: true,
      ingeridoEn: true,
      lineas: {
        select: {
          cantidad: true,
          cantidadDevuelta: true,
          precioUnitario: true,
          totalLinea: true,
          descripcion: true,
          costoUnitario: true,
          costoEn: true,
          producto: {
            select: { id: true, sku: true, juego: true, tipo: true, categoriaId: true, costoReferencia: true, categoria: { select: { nombre: true } } },
          },
        },
      },
    },
  });

  for (const p of pedidos) {
    const esVenta = ESTADOS_VENTA_WEB.has(p.estadoCanal);
    const anulado = ESTADOS_ANULADOS_WEB.has(p.estadoCanal);
    // Cancelado tras haber sido ingerido (o sea, pagado) y sin reembolso registrado: no se
    // inventa una devolución de dinero, se marca para revisión (§4).
    const estado = esVenta ? 'valida' : anulado && p.ingeridoEn && p.montoReembolsado === 0 ? 'revision' : anulado ? 'cancelada' : 'cancelada';
    const unidades = p.lineas.reduce((a, l) => a + l.cantidad, 0);
    const devueltas = p.lineas.reduce((a, l) => a + l.cantidadDevuelta, 0);
    ctx.operaciones.push({
      id: p.id,
      fuente: 'web',
      canalId: p.canalId,
      referencia: p.numero,
      dia: fechaChile(p.creadoEnCanal),
      moneda: p.moneda || 'CLP',
      estado,
      importeBruto: p.total,
      reembolsos: p.montoReembolsado,
      unidades,
      unidadesDevueltas: devueltas,
      cargaMonedero: 0,
    });
    if (estado === 'cancelada' || (p.moneda || 'CLP') !== 'CLP') continue;

    ctx.desglose.impuestos = suma(ctx.desglose.impuestos, p.totalImpuestos);
    ctx.desglose.envio = suma(ctx.desglose.envio, p.totalEnvio);
    ctx.desglose.descuentos = suma(ctx.desglose.descuentos, p.totalDescuento);

    // Importe por línea: manda `totalLinea` del canal; si no vino, cantidad × unitario (§4).
    const importes = p.lineas.map((l) => l.totalLinea ?? l.cantidad * l.precioUnitario);
    const reembolsoPorLinea = repartir(Math.min(p.montoReembolsado, importes.reduce((a, b) => a + b, 0)), importes);
    // Lo que el pedido cobró y no está en ninguna línea (envío, cargos): se informa aparte y no
    // se reparte a escondidas entre los productos.
    ctx.noAtribuible += p.total - p.montoReembolsado - (importes.reduce((a, b) => a + b, 0) - reembolsoPorLinea.reduce((a, b) => a + b, 0));

    p.lineas.forEach((l, i) => {
      const prod = l.producto;
      if (!coincideFiltro(f, prod?.categoriaId ?? null, prod?.juego ?? null, prod?.tipo ?? null)) return;
      ctx.lineas.push({
        canalId: p.canalId,
        categoriaId: prod?.categoriaId ?? null,
        categoria: prod?.categoria?.nombre ?? null,
        juego: prod?.juego ?? null,
        tipo: prod?.tipo ?? null,
        productoId: prod?.id ?? null,
        sku: prod?.sku ?? null,
        descripcion: l.descripcion,
        unidades: l.cantidad,
        unidadesDevueltas: l.cantidadDevuelta,
        importe: importes[i]! - reembolsoPorLinea[i]!,
        costoUnitario: l.costoUnitario ?? (f.costoActual ? (prod?.costoReferencia ?? null) : null),
        costoCongelado: l.costoEn !== null,
      });
      ctx.origen.push({ operacionId: p.id, canalId: p.canalId, dia: fechaChile(p.creadoEnCanal), fuente: 'web' });
      // Woo no dice si la unidad devuelta volvió a la bodega: no se asume pérdida (§6.4).
      ctx.sinReposicion.push(0);
    });
  }
}

const suma = (a: number | null, b: number | null): number | null => (b === null ? a : (a ?? 0) + b);

function coincideFiltro(f: FiltrosReporte, categoriaId: string | null, juego: string | null, tipo: string | null): boolean {
  if (f.categoriaIds && (categoriaId === null || !f.categoriaIds.includes(categoriaId))) return false;
  if (f.juego && juego !== f.juego) return false;
  if (f.tipo && tipo !== f.tipo) return false;
  return true;
}

/** Cobertura por canal (§6): hasta dónde llegan los datos y si hay errores abiertos. */
async function leerCobertura(canales: { id: string; nombre: string; activo: boolean; ultimaIngestaEn: Date | null }[], inicio: Date, fin: Date): Promise<Cobertura[]> {
  const salida: Cobertura[] = [];
  for (const c of canales) {
    const esFisico = c.id === 'tienda_fisica';
    const [primera, ultima, enPeriodo, errores] = await Promise.all([
      esFisico
        ? prisma.venta.findFirst({ where: { canalId: c.id }, orderBy: { creadoEn: 'asc' }, select: { creadoEn: true } })
        : prisma.pedidoCanal.findFirst({ where: { canalId: c.id }, orderBy: { creadoEnCanal: 'asc' }, select: { creadoEnCanal: true } }),
      esFisico
        ? prisma.venta.findFirst({ where: { canalId: c.id }, orderBy: { creadoEn: 'desc' }, select: { creadoEn: true } })
        : prisma.pedidoCanal.findFirst({ where: { canalId: c.id }, orderBy: { creadoEnCanal: 'desc' }, select: { creadoEnCanal: true } }),
      esFisico
        ? prisma.venta.count({ where: { canalId: c.id, creadoEn: { gte: inicio, lt: fin } } })
        : prisma.pedidoCanal.count({ where: { canalId: c.id, creadoEnCanal: { gte: inicio, lt: fin } } }),
      prisma.syncLog.count({ where: { canalId: c.id, resultado: 'error', resuelto: false } }),
    ]);
    const fecha = (d: Date | null | undefined) => (d ? fechaChile(d) : null);
    const primeraFecha = fecha((primera as { creadoEn?: Date; creadoEnCanal?: Date } | null)?.creadoEn ?? (primera as { creadoEnCanal?: Date } | null)?.creadoEnCanal);
    const ultimaFecha = fecha((ultima as { creadoEn?: Date; creadoEnCanal?: Date } | null)?.creadoEn ?? (ultima as { creadoEnCanal?: Date } | null)?.creadoEnCanal);
    salida.push({
      canalId: c.id,
      nombre: c.nombre,
      activo: c.activo,
      primeraFecha,
      ultimaFecha,
      ultimaIngestaEn: c.ultimaIngestaEn ? c.ultimaIngestaEn.toISOString() : null,
      operacionesEnPeriodo: enPeriodo,
      sinDatos: primeraFecha === null,
      erroresAbiertos: errores,
    });
  }
  return salida;
}

/**
 * Operaciones reconstruidas desde las líneas que pasaron el filtro (§5). El importe ya viene neto
 * de lo devuelto, así que `reembolsos` queda en 0 y el ajustado es el importe de esas líneas.
 */
function operacionesDesdeLineas(ctx: Contexto): OperacionAnalitica[] {
  const mapa = new Map<string, OperacionAnalitica>();
  ctx.lineas.forEach((l, i) => {
    const o = ctx.origen[i]!;
    const op = mapa.get(o.operacionId) ?? {
      id: o.operacionId,
      fuente: o.fuente,
      canalId: o.canalId,
      referencia: o.operacionId,
      dia: o.dia,
      moneda: 'CLP',
      estado: 'valida' as const,
      importeBruto: 0,
      reembolsos: 0,
      unidades: 0,
      unidadesDevueltas: 0,
      cargaMonedero: 0,
    };
    op.importeBruto += l.importe;
    op.unidades += l.unidades;
    op.unidadesDevueltas += l.unidadesDevueltas;
    mapa.set(o.operacionId, op);
  });
  return [...mapa.values()];
}

export async function reporteCanales(f: FiltrosReporte, agrupar: Agrupar): Promise<ReporteCanales> {
  const { inicio, fin } = rangoChile(f.desde, f.hasta);
  const canales = await prisma.canal.findMany({ orderBy: { nombre: 'asc' }, select: { id: true, nombre: true, activo: true, ultimaIngestaEn: true } });
  const ctx: Contexto = { operaciones: [], lineas: [], origen: [], sinReposicion: [], noAtribuible: 0, desglose: { impuestos: null, envio: null, descuentos: null } };
  await leerPos(f, inicio, fin, ctx);
  await leerWeb(f, inicio, fin, ctx);

  const ids = (f.canalIds ?? canales.map((c) => c.id)).filter((id) => canales.some((c) => c.id === id));
  const filtrado = !!(f.categoriaIds || f.juego || f.tipo);
  // Con filtros de producto el universo son las LÍNEAS que coinciden: la participación se calcula
  // sobre mercadería identificada y el envío/los cargos no atribuibles quedan fuera (§5).
  const universo = filtrado ? operacionesDesdeLineas(ctx) : ctx.operaciones;
  const consolidado = consolidarCanales(universo, ids);

  // Evolución: se arma sobre las mismas operaciones válidas del consolidado.
  const evolucionMapa = new Map<string, { periodo: string; canalId: string; importeAjustado: number; operaciones: number }>();
  for (const op of universo) {
    if (op.estado === 'anulada' || op.estado === 'cancelada' || op.moneda !== 'CLP') continue;
    if (op.importeBruto === 0 && op.unidades === 0) continue;
    const periodo = periodoDe(agrupar, op.dia);
    const clave = `${periodo}|${op.canalId}`;
    const fila = evolucionMapa.get(clave) ?? { periodo, canalId: op.canalId, importeAjustado: 0, operaciones: 0 };
    fila.importeAjustado += op.importeBruto - op.reembolsos;
    fila.operaciones += 1;
    evolucionMapa.set(clave, fila);
  }

  // Matriz canal × categoría sobre LÍNEAS (§5): un filtro de categoría no arrastra el pedido entero.
  const catMapa = new Map<string, FilaCategoria>();
  for (const l of ctx.lineas) {
    const clave = `${l.canalId}|${l.categoriaId ?? 'sin'}`;
    const fila = catMapa.get(clave) ?? {
      canalId: l.canalId,
      categoriaId: l.categoriaId,
      categoria: l.categoria ?? 'Sin clasificar',
      unidadesNetas: 0,
      importe: 0,
      porcentaje: null,
    };
    fila.unidadesNetas += l.unidades - l.unidadesDevueltas;
    fila.importe += l.importe;
    catMapa.set(clave, fila);
  }
  const categorias = [...catMapa.values()];
  const totalLineas = categorias.reduce((a, c) => a + c.importe, 0);
  for (const c of categorias) c.porcentaje = totalLineas > 0 ? (c.importe / totalLineas) * 100 : null;
  categorias.sort((a, b) => b.importe - a.importe);

  const margen = calcularMargen(ctx.lineas, ctx.sinReposicion);
  return {
    desde: f.desde,
    hasta: f.hasta,
    agrupar,
    consultadoEn: new Date().toISOString(),
    criterio: 'Ventas originadas en el período, ajustadas por devoluciones conocidas a la fecha de consulta',
    consolidado,
    canales: canales.map((c) => ({ id: c.id, nombre: c.nombre, activo: c.activo })),
    evolucion: [...evolucionMapa.values()].sort((a, b) => a.periodo.localeCompare(b.periodo) || a.canalId.localeCompare(b.canalId)),
    categorias,
    margen: { ...margen, estimadoACostoActual: !!f.costoActual },
    noAtribuible: ctx.noAtribuible,
    desglose: ctx.desglose,
    cobertura: await leerCobertura(canales, inicio, fin),
    filtrado,
  };
}
