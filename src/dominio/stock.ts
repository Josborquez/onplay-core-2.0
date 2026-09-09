// Reglas puras del inventario — docs/03-SDD-etapa2-inventario.md §6.
// La transacción (FOR UPDATE, INSERT, UPDATE) vive en apps/api; aquí solo se decide.

export type MotivoStock =
  | 'recuento_inicial'
  | 'compra'
  | 'venta'
  | 'venta_online'
  | 'ajuste'
  | 'merma'
  | 'devolucion'
  | 'traslado';

/** Motivos que un encargado puede registrar a mano (§6.5). `venta`/`devolucion`/`recuento_inicial`
 * los genera el sistema; `venta_online` es de E3c. */
export const MOTIVOS_MANUALES: readonly MotivoStock[] = ['ajuste', 'merma', 'compra'];

/** Motivos que exigen nota (M3). */
export const MOTIVOS_CON_NOTA: readonly MotivoStock[] = ['ajuste', 'merma', 'compra', 'traslado'];

export interface MovimientoStockEntrada {
  cantidad: number;
  motivo: MotivoStock;
  nota?: string | null;
}

export type ErrorMovimientoStock =
  | { codigo: 'CANTIDAD_INVALIDA'; detalle: string }
  | { codigo: 'NOTA_REQUERIDA'; detalle: string }
  | { codigo: 'SIGNO_INVALIDO'; detalle: string }
  | { codigo: 'MOTIVO_NO_MANUAL'; detalle: string };

/**
 * Valida un movimiento antes de registrarlo (§6.1 paso 1).
 * - cantidad entera y ≠ 0;
 * - nota obligatoria en ajuste/merma/compra/traslado (M3);
 * - merma siempre negativa, compra siempre positiva (§6.5); ajuste y traslado llevan el signo que traen.
 */
export function validarMovimientoStock(m: MovimientoStockEntrada): ErrorMovimientoStock | null {
  if (!Number.isInteger(m.cantidad) || m.cantidad === 0) {
    return { codigo: 'CANTIDAD_INVALIDA', detalle: 'La cantidad debe ser un entero distinto de 0.' };
  }
  if (MOTIVOS_CON_NOTA.includes(m.motivo) && !(m.nota ?? '').trim()) {
    return { codigo: 'NOTA_REQUERIDA', detalle: `El motivo «${m.motivo}» exige una nota.` };
  }
  if (m.motivo === 'merma' && m.cantidad > 0) {
    return { codigo: 'SIGNO_INVALIDO', detalle: 'Una merma siempre resta.' };
  }
  if (m.motivo === 'compra' && m.cantidad < 0) {
    return { codigo: 'SIGNO_INVALIDO', detalle: 'Un ingreso siempre suma.' };
  }
  return null;
}

/**
 * Firma la cantidad que viene en positivo desde la interfaz según el motivo manual (§6.5):
 * merma → negativa, compra → positiva, ajuste → tal cual (ya trae signo).
 * Devuelve MOTIVO_NO_MANUAL para motivos que el encargado no puede registrar a mano.
 */
export function firmarCantidadManual(
  motivo: MotivoStock,
  cantidad: number,
): { cantidad: number } | ErrorMovimientoStock {
  if (!MOTIVOS_MANUALES.includes(motivo)) {
    return {
      codigo: 'MOTIVO_NO_MANUAL',
      detalle: `El motivo «${motivo}» lo genera el sistema; a mano solo ajuste, merma o compra.`,
    };
  }
  if (motivo === 'merma') return { cantidad: -Math.abs(cantidad) };
  if (motivo === 'compra') return { cantidad: Math.abs(cantidad) };
  return { cantidad };
}

/** Resultado de aplicar un movimiento sobre la cantidad actual: puro, sin efectos. */
export function aplicarMovimiento(cantidadActual: number, cantidad: number): {
  cantidadAnterior: number;
  cantidadNueva: number;
  quedaNegativo: boolean;
} {
  const cantidadNueva = cantidadActual + cantidad;
  return { cantidadAnterior: cantidadActual, cantidadNueva, quedaNegativo: cantidadNueva < 0 };
}

export type EstadoStock = 'sin_control' | 'negativo' | 'quiebre' | 'bajo' | 'ok';

/**
 * Estado de stock de un producto (§6.2): `sin_control` si no controla; `negativo` si alguna
 * ubicación está bajo cero; `quiebre` si el total es 0; `bajo` si 0 < total ≤ stockMinimo; `ok`.
 */
export function estadoStock(p: {
  controlaStock: boolean;
  stockMinimo: number;
  porUbicacion: readonly number[];
}): EstadoStock {
  if (!p.controlaStock) return 'sin_control';
  if (p.porUbicacion.some((c) => c < 0)) return 'negativo';
  const total = p.porUbicacion.reduce((s, c) => s + c, 0);
  if (total === 0) return 'quiebre';
  if (p.stockMinimo > 0 && total <= p.stockMinimo) return 'bajo';
  return 'ok';
}

export type NivelAvisoWeb = 'reservado' | 'ultimo' | null;

/**
 * Prioridad entre canales (§6.9, decisión del dueño 2026-09-02).
 * WooCommerce descuenta `stock_quantity` solo al pasar a pagado, así que `stockCanal` refleja
 * únicamente pedidos pagados, que son los que ganan a la tienda física.
 * - `reservado`: el canal maneja stock, marca ≤ 0 y hay stock propio ≥ 1 → el cobro se detiene
 *   (salida solo de encargado con nota).
 * - `ultimo`: el canal marca exactamente 1 → aviso, no bloquea.
 * - null: sin conflicto (o el producto no controla stock / el canal no maneja stock).
 */
export function avisoWeb(p: {
  controlaStock: boolean;
  stockPropioVenta: number;
  canales: readonly { manejaStockCanal: boolean | null; stockCanal: number | null }[];
}): NivelAvisoWeb {
  if (!p.controlaStock) return null;
  let nivel: NivelAvisoWeb = null;
  for (const c of p.canales) {
    if (!c.manejaStockCanal || c.stockCanal === null) continue;
    if (c.stockCanal <= 0 && p.stockPropioVenta >= 1) return 'reservado';
    if (c.stockCanal === 1) nivel = 'ultimo';
  }
  return nivel;
}

/**
 * Cierre de recuento (§6.4 paso 3): por cada línea CONTADA calcula la diferencia contra el
 * stock actual (no contra el snapshot: pudo haber ventas durante el conteo) y decide el motivo:
 * `recuento_inicial` si el producto aún no controlaba stock, `ajuste` si ya lo hacía.
 * Las líneas sin contar no producen nada ni encienden el control.
 */
export interface LineaRecuentoCierre {
  productoId: string;
  cantidadContada: number | null;
  stockActual: number;
  controlaStock: boolean;
}

export interface MovimientoDeCierre {
  productoId: string;
  cantidad: number;
  motivo: 'recuento_inicial' | 'ajuste';
}

export function cerrarRecuento(lineas: readonly LineaRecuentoCierre[]): {
  movimientos: MovimientoDeCierre[];
  encender: string[]; // productoIds que pasan a controlaStock = true
  contadas: number;
  conDiferencia: number;
  sumaAbs: number;
} {
  const movimientos: MovimientoDeCierre[] = [];
  const encender: string[] = [];
  let contadas = 0;
  let sumaAbs = 0;
  for (const l of lineas) {
    if (l.cantidadContada === null || l.cantidadContada === undefined) continue;
    contadas += 1;
    if (!l.controlaStock) encender.push(l.productoId);
    const diferencia = l.cantidadContada - l.stockActual;
    if (diferencia !== 0) {
      movimientos.push({
        productoId: l.productoId,
        cantidad: diferencia,
        motivo: l.controlaStock ? 'ajuste' : 'recuento_inicial',
      });
      sumaAbs += Math.abs(diferencia);
    }
  }
  return { movimientos, encender, contadas, conDiferencia: movimientos.length, sumaAbs };
}
