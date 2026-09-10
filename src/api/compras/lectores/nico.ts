// Lector de Distribuidora Nico (distribuidoranico.cl) — 11-SDD §6.3.
// No manda factura: manda el «PEDIDO» de su tienda web («orden de pedido web interno … no
// representa a un documento tributario»). Una fila por producto: SKU · Producto · Cantidad ·
// Precio · Total, con «SKU: …» repetido en la fila siguiente (se ignora). Los precios vienen
// CON IVA incluido (tienda web): el neto se estima ÷ 1,19 y el costo unitario usa el total (D-E6-1).
// La cantidad es de bultos tal como los vende Nico («Lata Bilz x 6 und» × 1 = 6 latas; «Kryzpo
// 130 g» × 4 = 4 unidades). Verificado con el pedido 216107 del 07-09-2026 (docs/pdf/factura-216107.pdf).
import {
  fechaIsoDesdeCl,
  parsearNumeroCl,
  unidadesPorBultoDesdeDescripcion,
  type DocumentoLeido,
  type LineaLeida,
} from '@onplay/dominio';
import type { PaginaTexto } from '../pdf.js';

export const NOMBRE_NICO = 'Distribuidora Nico';
const IVA = 1.19;

/** ¿Este documento es de Nico? Su razón social aparece en la cabecera de la primera página. */
export function reconoceNico(paginas: PaginaTexto[]): boolean {
  const primera = paginas[0] ?? [];
  return primera.some((fila) => fila.some((c) => /distribuidora\s*nico/i.test(c) || /distribuidoranico\.cl/i.test(c)));
}

const ES_SKU = /^[0-9]+(-[0-9]+)*$/;
const ES_ENTERO = /^\d+$/;

function monto(celda: string): number | null {
  const n = parsearNumeroCl(celda.replace(/^\$\s*/, ''));
  return n === null ? null : Math.round(n);
}

function leerLinea(fila: string[]): LineaLeida | null {
  // SKU · Producto · Cantidad · Precio · Total
  if (fila.length !== 5 || !ES_SKU.test(fila[0]!) || !ES_ENTERO.test(fila[2]!)) return null;
  const total = monto(fila[4]!);
  const precio = monto(fila[3]!);
  if (total === null || precio === null) return null;
  const descripcion = fila[1]!;
  const neto = Math.round(total / IVA);
  return {
    codigoProveedor: fila[0]!,
    descripcion,
    bultos: Number(fila[2]),
    unidadesPorBulto: unidadesPorBultoDesdeDescripcion(descripcion) ?? 1,
    sueltas: 0,
    neto,
    impuestos: total - neto,
    total,
  };
}

export function leerNico(paginas: PaginaTexto[]): DocumentoLeido {
  const advertencias: string[] = [];
  let numeroDocumento: string | null = null;
  let fechaDocumento: string | null = null;
  let total: number | null = null;
  const lineas: LineaLeida[] = [];

  for (const pagina of paginas) {
    for (const fila of pagina) {
      const texto = fila.join(' ');
      if (numeroDocumento === null) {
        const m = /N[úu]mero de pedido:\s*(\d{3,})/.exec(texto);
        if (m) numeroDocumento = m[1]!;
      }
      if (fechaDocumento === null) {
        const m = /Fecha de pedido:\s*(\d{2}\/\d{2}\/\d{4})/.exec(texto);
        if (m) fechaDocumento = fechaIsoDesdeCl(m[1]!);
      }
      const linea = leerLinea(fila);
      if (linea) {
        lineas.push(linea);
        continue;
      }
      // Fila de totales: «Total | $273.080» (Subtotal y Envío se ignoran: el total ya los incluye).
      if (fila.length >= 2 && fila[0] === 'Total') {
        const t = monto(fila[fila.length - 1]!);
        if (t !== null) total = t;
      }
    }
  }

  if (numeroDocumento === null) advertencias.push('No se encontró el número de pedido.');
  if (fechaDocumento === null) advertencias.push('No se encontró la fecha del pedido.');
  if (lineas.length === 0) advertencias.push('No se reconoció ninguna línea de producto.');
  if (total === null) advertencias.push('No se encontró el total del pedido.');
  for (const l of lineas) {
    if (unidadesPorBultoDesdeDescripcion(l.descripcion) === null) {
      advertencias.push(`«${l.descripcion}»: no dice cuántas unidades trae; se asumió 1 por bulto.`);
    }
  }

  const neto = total === null ? null : Math.round(total / IVA);
  return {
    lector: 'nico',
    proveedor: { rut: null, nombre: NOMBRE_NICO },
    tipoDocumento: 'otro', // pedido web, no documento tributario
    numeroDocumento,
    fechaDocumento,
    lineas,
    totales: total === null || neto === null ? null : { neto, impuestos: total - neto, total },
    advertencias,
  };
}
