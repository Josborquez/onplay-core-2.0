// Reglas puras de devoluciones — docs/03-SDD-etapa2-inventario.md §6.6.

export interface LineaVendida {
  ventaLineaId: string;
  cantidad: number; // vendida
  precioUnitario: number;
  descuentoLinea: number;
  totalLinea: number;
  yaDevuelta: number; // suma de devoluciones previas de esta línea
}

export interface LineaADevolver {
  ventaLineaId: string;
  cantidad: number;
  reponeStock: boolean;
}

export interface VentaParaDevolver {
  estado: 'completada' | 'anulada';
  subtotal: number; // suma de totalLinea
  descuento: number; // descuento global de la venta
  lineas: readonly LineaVendida[];
}

export type ErrorDevolucion =
  | { codigo: 'VENTA_ANULADA'; detalle: string }
  | { codigo: 'SIN_LINEAS'; detalle: string }
  | { codigo: 'LINEA_NO_ENCONTRADA'; detalle: string; ventaLineaId: string }
  | { codigo: 'CANTIDAD_INVALIDA'; detalle: string; ventaLineaId: string }
  | {
      codigo: 'CANTIDAD_EXCEDE_VENTA';
      detalle: string;
      ventaLineaId: string;
      vendida: number;
      yaDevuelta: number;
      solicitada: number;
    };

export interface LineaDevolucionCalculada {
  ventaLineaId: string;
  cantidad: number;
  reponeStock: boolean;
  montoLinea: number;
}

export interface CalculoDevolucion {
  lineas: LineaDevolucionCalculada[];
  monto: number;
}

/**
 * Valida y calcula una devolución (§6.6):
 * - la venta no puede estar anulada;
 * - cada cantidad es entera > 0 y ≤ vendida − ya devuelta;
 * - `montoLinea` = parte proporcional del total pagado: el descuento global de la venta se
 *   prorratea por línea según su peso en el subtotal; el resto es cantidad × total unitario.
 *   Los redondeos se corrigen en la última línea para que Σ montoLinea = monto.
 */
export function validarDevolucion(
  venta: VentaParaDevolver,
  solicitud: readonly LineaADevolver[],
): CalculoDevolucion | ErrorDevolucion {
  if (venta.estado === 'anulada') {
    return { codigo: 'VENTA_ANULADA', detalle: 'Una venta anulada no admite devoluciones.' };
  }
  if (solicitud.length === 0) {
    return { codigo: 'SIN_LINEAS', detalle: 'Indica al menos una línea a devolver.' };
  }
  const porId = new Map(venta.lineas.map((l) => [l.ventaLineaId, l]));
  const lineas: LineaDevolucionCalculada[] = [];
  const descuentoPorLinea = prorratearDescuento(venta);

  for (const s of solicitud) {
    const l = porId.get(s.ventaLineaId);
    if (!l) {
      return {
        codigo: 'LINEA_NO_ENCONTRADA',
        detalle: 'La línea no pertenece a esta venta.',
        ventaLineaId: s.ventaLineaId,
      };
    }
    if (!Number.isInteger(s.cantidad) || s.cantidad <= 0) {
      return {
        codigo: 'CANTIDAD_INVALIDA',
        detalle: 'La cantidad a devolver debe ser un entero mayor que 0.',
        ventaLineaId: s.ventaLineaId,
      };
    }
    const disponible = l.cantidad - l.yaDevuelta;
    if (s.cantidad > disponible) {
      return {
        codigo: 'CANTIDAD_EXCEDE_VENTA',
        detalle: `Se vendieron ${l.cantidad}, ya se devolvieron ${l.yaDevuelta}; quedan ${disponible}.`,
        ventaLineaId: s.ventaLineaId,
        vendida: l.cantidad,
        yaDevuelta: l.yaDevuelta,
        solicitada: s.cantidad,
      };
    }
    // Lo efectivamente pagado por esta línea, neto del descuento global prorrateado.
    const pagadoLinea = l.totalLinea - (descuentoPorLinea.get(l.ventaLineaId) ?? 0);
    const montoLinea = Math.round((pagadoLinea * s.cantidad) / l.cantidad);
    lineas.push({
      ventaLineaId: s.ventaLineaId,
      cantidad: s.cantidad,
      reponeStock: s.reponeStock,
      montoLinea,
    });
  }
  const monto = lineas.reduce((acc, l) => acc + l.montoLinea, 0);
  return { lineas, monto };
}

/**
 * Reparte el descuento global entre las líneas en proporción a su total, en pesos enteros,
 * con método de resto mayor: la suma de las partes es EXACTAMENTE el descuento (sin perder
 * ni inventar un peso). Empates de resto: gana la línea que aparece primero.
 */
export function prorratearDescuento(venta: {
  subtotal: number;
  descuento: number;
  lineas: readonly { ventaLineaId: string; totalLinea: number }[];
}): Map<string, number> {
  const resultado = new Map<string, number>();
  if (venta.subtotal <= 0 || venta.descuento <= 0) {
    for (const l of venta.lineas) resultado.set(l.ventaLineaId, 0);
    return resultado;
  }
  const exactos = venta.lineas.map((l) => ({
    id: l.ventaLineaId,
    exacto: (l.totalLinea * venta.descuento) / venta.subtotal,
  }));
  let asignado = 0;
  for (const e of exactos) {
    const piso = Math.floor(e.exacto);
    resultado.set(e.id, piso);
    asignado += piso;
  }
  let resto = venta.descuento - asignado;
  const porFraccion = [...exactos]
    .map((e, i) => ({ id: e.id, fraccion: e.exacto - Math.floor(e.exacto), i }))
    .sort((a, b) => b.fraccion - a.fraccion || a.i - b.i);
  for (const e of porFraccion) {
    if (resto <= 0) break;
    resultado.set(e.id, (resultado.get(e.id) ?? 0) + 1);
    resto -= 1;
  }
  return resultado;
}

/** Folio de devolución (§6.6): D-2026-00001. */
export function formatearFolioDevolucion(anio: number, numero: number): string {
  return `D-${anio}-${String(numero).padStart(5, '0')}`;
}
