// Reglas puras de venta y arqueo (§5.3, §5.4 del SDD E1).
// Sin acceso a base de datos: las validaciones que dependen de la DB
// (turno abierto, idempotencia, congelado de descripción, folio) viven en la ruta.

export type MedioPago =
  | 'efectivo'
  | 'debito'
  | 'credito'
  | 'transferencia'
  | 'mercadopago'
  | 'otro'
  // E4 §6.2: saldo del cliente; la ruta exige clienteId y valida el tope.
  | 'monedero';

export interface LineaEntrada {
  productoId: string | null;
  descripcion?: string;
  cantidad: number;
  precioUnitario: number;
  descuentoLinea?: number;
}

export interface PagoEntrada {
  medio: MedioPago;
  monto: number;
  montoRecibido?: number;
  referencia?: string;
}

export interface CalculoVenta {
  ok: true;
  subtotal: number;
  totalLineas: number;
  total: number;
  /** totalLinea por línea, en el mismo orden de entrada. */
  totalesLinea: number[];
}

export interface ErrorVenta {
  ok: false;
  codigo:
    | 'SIN_LINEAS'
    | 'LINEA_INVALIDA'
    | 'DESCRIPCION_REQUERIDA'
    | 'DESCUENTO_LINEA_INVALIDO'
    | 'DESCUENTO_INVALIDO'
    | 'PAGOS_NO_CUADRAN'
    | 'MONTO_RECIBIDO_INSUFICIENTE';
  detalle: string;
}

const esEnteroNoNegativo = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * Validaciones 3–9 de §5.4, en orden, y fórmulas de cálculo.
 * Montos en CLP enteros.
 */
export function validarYCalcularVenta(
  lineas: LineaEntrada[],
  descuento: number,
  pagos: PagoEntrada[],
): CalculoVenta | ErrorVenta {
  // 3. Al menos una línea; cantidad > 0, precioUnitario >= 0.
  if (!Array.isArray(lineas) || lineas.length === 0) {
    return { ok: false, codigo: 'SIN_LINEAS', detalle: 'La venta debe tener al menos una línea' };
  }
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]!;
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0) {
      return { ok: false, codigo: 'LINEA_INVALIDA', detalle: `Línea ${i}: cantidad debe ser entero > 0` };
    }
    if (!esEnteroNoNegativo(l.precioUnitario)) {
      return { ok: false, codigo: 'LINEA_INVALIDA', detalle: `Línea ${i}: precioUnitario debe ser entero >= 0` };
    }
    // 4 (parte pura): productoId null exige descripcion. El congelado desde el producto es de la ruta.
    if (l.productoId === null && !(l.descripcion ?? '').trim()) {
      return { ok: false, codigo: 'DESCRIPCION_REQUERIDA', detalle: `Línea ${i}: descripcion es obligatoria si productoId es null` };
    }
    // 5. 0 <= descuentoLinea <= cantidad × precioUnitario.
    const bruto = l.cantidad * l.precioUnitario;
    const dl = l.descuentoLinea ?? 0;
    if (!esEnteroNoNegativo(dl) || dl > bruto) {
      return {
        ok: false,
        codigo: 'DESCUENTO_LINEA_INVALIDO',
        detalle: `Línea ${i}: descuentoLinea debe estar entre 0 y ${bruto}`,
      };
    }
  }

  // 6. Fórmulas.
  const totalesLinea = lineas.map((l) => l.cantidad * l.precioUnitario - (l.descuentoLinea ?? 0));
  const subtotal = lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
  const totalLineas = totalesLinea.reduce((s, t) => s + t, 0);

  // 7. 0 <= descuento <= totalLineas.
  if (!esEnteroNoNegativo(descuento) || descuento > totalLineas) {
    return {
      ok: false,
      codigo: 'DESCUENTO_INVALIDO',
      detalle: `descuento debe estar entre 0 y ${totalLineas}`,
    };
  }
  const total = totalLineas - descuento;

  // 8. SUM(pagos.monto) === total.
  if (!Array.isArray(pagos) || pagos.some((p) => !esEnteroNoNegativo(p.monto))) {
    return { ok: false, codigo: 'PAGOS_NO_CUADRAN', detalle: 'Cada pago debe tener monto entero >= 0' };
  }
  const sumaPagos = pagos.reduce((s, p) => s + p.monto, 0);
  if (sumaPagos !== total) {
    return {
      ok: false,
      codigo: 'PAGOS_NO_CUADRAN',
      detalle: `La suma de pagos (${sumaPagos}) no coincide con el total (${total}); diferencia ${sumaPagos - total}`,
    };
  }

  // 9. Efectivo con montoRecibido: montoRecibido >= monto. El vuelto no se persiste.
  for (let i = 0; i < pagos.length; i++) {
    const p = pagos[i]!;
    if (p.medio === 'efectivo' && p.montoRecibido !== undefined) {
      if (!esEnteroNoNegativo(p.montoRecibido) || p.montoRecibido < p.monto) {
        return {
          ok: false,
          codigo: 'MONTO_RECIBIDO_INSUFICIENTE',
          detalle: `Pago ${i}: montoRecibido (${p.montoRecibido}) es menor que el monto imputado (${p.monto})`,
        };
      }
    }
  }

  return { ok: true, subtotal, totalLineas, total, totalesLinea };
}

export interface Arqueo {
  montoEsperado: number;
  diferencia: number;
}

/** Términos de E2 (03-SDD §6.7). Todos en positivo; el signo lo pone la fórmula. */
export interface ExtrasArqueo {
  devolucionesEfectivo?: number;
  ingresosCaja?: number;
  retirosCaja?: number;
}

/**
 * Arqueo de cierre de turno (02 §5.3, extendido por 03 §6.7):
 * montoEsperado = montoApertura + efectivo de ventas completadas
 *               − devoluciones en efectivo + ingresos de caja − retiros de caja.
 * diferencia = montoDeclarado − montoEsperado.
 * Con los extras en cero (o ausentes) es exactamente la fórmula de E1.
 */
export function calcularArqueo(
  montoApertura: number,
  efectivoVentasCompletadas: number,
  montoDeclarado: number,
  extras: ExtrasArqueo = {},
): Arqueo {
  const montoEsperado =
    montoApertura +
    efectivoVentasCompletadas -
    (extras.devolucionesEfectivo ?? 0) +
    (extras.ingresosCaja ?? 0) -
    (extras.retirosCaja ?? 0);
  return { montoEsperado, diferencia: montoDeclarado - montoEsperado };
}
