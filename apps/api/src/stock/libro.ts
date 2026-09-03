// Libro de stock — docs/03-SDD-etapa2-inventario.md §6.1 (M1).
// ÚNICO lugar del sistema que escribe StockActual. Todo pasa por registrarMovimiento:
// INSERT del movimiento + UPDATE del resumen, en la misma transacción, con la fila bloqueada.
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  aplicarMovimiento,
  estadoStock,
  validarMovimientoStock,
  type EstadoStock,
  type MotivoStock,
} from '@onplay/dominio';

export type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export class ErrorStock extends Error {
  constructor(
    public readonly cuerpo: { error: string; detalle?: string; [k: string]: unknown },
    public readonly status = 422,
  ) {
    super(cuerpo.error);
  }
}

export interface EntradaMovimiento {
  productoId: string;
  ubicacionId: string;
  cantidad: number; // con signo
  motivo: MotivoStock;
  referenciaTipo?: string | null;
  referenciaId?: string | null;
  nota?: string | null;
  usuarioId: string;
  /**
   * E3 §8.4 (R-016): SOLO la ingesta de un pedido web ya PAGADO puede dejar el libro en
   * negativo — la unidad ya se vendió en el canal y el maestro debe reflejarlo; la
   * discrepancia `pedido_sin_stock` la resuelve una persona. Nadie más lo usa.
   */
  permitirNegativo?: boolean;
}

export interface ResultadoMovimiento {
  movimientoId: string;
  cantidadAnterior: number;
  cantidadNueva: number;
  quedaNegativo: boolean;
}

/**
 * Bloquea la fila de StockActual (creándola en 0 si no existe) y devuelve la cantidad vigente.
 * Se usa para tomar los candados en el ORDEN fijo de §6.1 (Cliente → StockActual ascendente →
 * Correlativo) antes de crear la venta; volver a bloquear la misma fila en la misma tx es gratis.
 */
export async function bloquearStock(tx: Tx, productoId: string, ubicacionId: string): Promise<number> {
  // UTC_TIMESTAMP(3), no NOW(3): Prisma guarda DateTime en UTC y el delta del catalogo offline
  // compara contra esa marca; NOW() en MariaDB es hora local de Chile (R-014).
  // ON DUPLICATE KEY UPDATE cantidad = cantidad: no pisa nada si la fila ya existe y evita
  // la carrera de dos transacciones creando la misma fila.
  await tx.$executeRaw`
    INSERT INTO StockActual (productoId, ubicacionId, cantidad, actualizadoEn)
    VALUES (${productoId}, ${ubicacionId}, 0, UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE cantidad = cantidad`;
  const filas = await tx.$queryRaw<{ cantidad: number }[]>`
    SELECT cantidad FROM StockActual
    WHERE productoId = ${productoId} AND ubicacionId = ${ubicacionId} FOR UPDATE`;
  return Number(filas[0]?.cantidad ?? 0);
}

/** §6.1 pasos 1–5. Lanza ErrorStock (422) si el movimiento no valida. */
export async function registrarMovimiento(tx: Tx, e: EntradaMovimiento): Promise<ResultadoMovimiento> {
  const error = validarMovimientoStock({ cantidad: e.cantidad, motivo: e.motivo, nota: e.nota });
  if (error) throw new ErrorStock({ error: error.codigo, detalle: error.detalle });

  const actual = await bloquearStock(tx, e.productoId, e.ubicacionId);
  // R-014 (decisión del dueño 2026-09-02): el stock NUNCA queda negativo. Una salida mayor que
  // lo disponible aborta la transacción entera (venta, merma, ajuste o traslado).
  const r = aplicarMovimiento(actual, e.cantidad);
  if (r.quedaNegativo && !(e.permitirNegativo && e.motivo === 'venta_online')) {
    throw new ErrorStock({
      error: 'STOCK_INSUFICIENTE',
      detalle: `Disponible ${actual}, se intenta sacar ${-e.cantidad}`,
      productoId: e.productoId,
      ubicacionId: e.ubicacionId,
      disponible: actual,
      solicitado: -e.cantidad,
    });
  }
  const mov = await tx.movimientoStock.create({
    data: {
      productoId: e.productoId,
      ubicacionId: e.ubicacionId,
      cantidad: e.cantidad,
      motivo: e.motivo,
      referenciaTipo: e.referenciaTipo ?? null,
      referenciaId: e.referenciaId ?? null,
      nota: e.nota?.trim() || null,
      usuarioId: e.usuarioId,
    },
  });
  await tx.$executeRaw`
    UPDATE StockActual SET cantidad = cantidad + ${e.cantidad}, actualizadoEn = UTC_TIMESTAMP(3)
    WHERE productoId = ${e.productoId} AND ubicacionId = ${e.ubicacionId}`;
  return { movimientoId: mov.id, ...r };
}

/** La única ubicación de venta (D-E2-2). 409 si no está configurada. */
export async function ubicacionVenta(db: Db) {
  const u = await db.ubicacion.findFirst({ where: { esVenta: true, activa: true } });
  if (!u) {
    throw new ErrorStock(
      { error: 'UBICACION_VENTA_NO_CONFIGURADA', detalle: 'Ninguna ubicación activa tiene esVenta = true' },
      409,
    );
  }
  return u;
}

export interface ResumenStock {
  stockTotal: number | null; // null = no controla stock
  stockVenta: number | null;
  stockCanalMin: number | null; // menor stock publicado entre canales que manejan stock
  estadoStock: EstadoStock;
}

/**
 * Resumen por producto (§6.2) para listados, buscador y caché offline. Suma solo ubicaciones
 * activas. `stockCanalMin` es el espejo de solo lectura (§6.8): informativo, nunca se suma (M6).
 */
export async function resumenStock(db: Db, productoIds: string[]): Promise<Map<string, ResumenStock>> {
  const mapa = new Map<string, ResumenStock>();
  if (productoIds.length === 0) return mapa;
  const [ubicaciones, productos, filas, canales] = await Promise.all([
    db.ubicacion.findMany({ where: { activa: true }, select: { id: true, esVenta: true } }),
    db.producto.findMany({
      where: { id: { in: productoIds } },
      select: { id: true, controlaStock: true, stockMinimo: true },
    }),
    db.stockActual.findMany({
      where: { productoId: { in: productoIds } },
      select: { productoId: true, ubicacionId: true, cantidad: true },
    }),
    db.productoCanal.findMany({
      where: { productoId: { in: productoIds }, manejaStockCanal: true, stockCanal: { not: null }, publicado: true },
      select: { productoId: true, stockCanal: true },
    }),
  ]);
  const activas = new Set(ubicaciones.map((u) => u.id));
  const ventaId = ubicaciones.find((u) => u.esVenta)?.id ?? null;
  const porProducto = new Map<string, number[]>();
  const enVenta = new Map<string, number>();
  for (const f of filas) {
    if (!activas.has(f.ubicacionId)) continue;
    porProducto.set(f.productoId, [...(porProducto.get(f.productoId) ?? []), f.cantidad]);
    if (f.ubicacionId === ventaId) enVenta.set(f.productoId, f.cantidad);
  }
  const canalMin = new Map<string, number>();
  for (const c of canales) {
    const previo = canalMin.get(c.productoId);
    canalMin.set(c.productoId, previo === undefined ? c.stockCanal! : Math.min(previo, c.stockCanal!));
  }
  for (const p of productos) {
    const porUbicacion = porProducto.get(p.id) ?? [];
    mapa.set(p.id, {
      stockTotal: p.controlaStock ? porUbicacion.reduce((s, c) => s + c, 0) : null,
      stockVenta: p.controlaStock ? enVenta.get(p.id) ?? 0 : null,
      stockCanalMin: canalMin.get(p.id) ?? null,
      estadoStock: estadoStock({ controlaStock: p.controlaStock, stockMinimo: p.stockMinimo, porUbicacion }),
    });
  }
  return mapa;
}

/** Adjunta el resumen de stock a una lista de productos (por `id`). */
export async function adjuntarStock<T extends { id: string }>(db: Db, productos: T[]): Promise<(T & ResumenStock)[]> {
  const mapa = await resumenStock(
    db,
    productos.map((p) => p.id),
  );
  return productos.map((p) => ({
    ...p,
    ...(mapa.get(p.id) ?? { stockTotal: null, stockVenta: null, stockCanalMin: null, estadoStock: 'sin_control' as const }),
  }));
}

export interface ContextoReserva {
  stockPropioVenta: number;
  canales: { canalId: string; manejaStockCanal: boolean | null; stockCanal: number | null; stockCanalEn: Date | null }[];
}

/** Datos para `avisoWeb` (§6.9) de varios productos, sin bloquear nada. */
export async function contextoReserva(
  db: Db,
  productoIds: string[],
  ubicacionVentaId: string,
): Promise<Map<string, ContextoReserva>> {
  const mapa = new Map<string, ContextoReserva>();
  if (productoIds.length === 0) return mapa;
  const [filas, canales] = await Promise.all([
    db.stockActual.findMany({
      where: { productoId: { in: productoIds }, ubicacionId: ubicacionVentaId },
      select: { productoId: true, cantidad: true },
    }),
    db.productoCanal.findMany({
      where: { productoId: { in: productoIds }, publicado: true },
      select: { productoId: true, canalId: true, manejaStockCanal: true, stockCanal: true, stockCanalEn: true },
    }),
  ]);
  for (const id of productoIds) {
    mapa.set(id, {
      stockPropioVenta: filas.find((f) => f.productoId === id)?.cantidad ?? 0,
      canales: canales.filter((c) => c.productoId === id).map(({ productoId: _p, ...c }) => c),
    });
  }
  return mapa;
}

/** Desglose por ubicación activa de un producto (todas, con 0 donde no hay fila). */
export async function stockPorUbicacion(db: Db, productoId: string) {
  const [ubicaciones, filas] = await Promise.all([
    db.ubicacion.findMany({ where: { activa: true }, orderBy: { orden: 'asc' } }),
    db.stockActual.findMany({ where: { productoId } }),
  ]);
  return ubicaciones.map((u) => ({
    id: u.id,
    codigo: u.codigo,
    nombre: u.nombre,
    esVenta: u.esVenta,
    publicable: u.publicable,
    cantidad: filas.find((f) => f.ubicacionId === u.id)?.cantidad ?? 0,
  }));
}
