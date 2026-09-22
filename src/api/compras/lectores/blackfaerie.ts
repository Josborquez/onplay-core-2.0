// Lector de Black Faerie (Accesorios Tcg SpA, RUT 76.648.466-2) — 11-SDD §6.3.
// Factura electrónica de varias páginas: «[CÓDIGO] DESCRIPCIÓN · CANTIDAD · PRECIO UNITARIO · $ · IMPORTE».
// Ojo: el PRECIO UNITARIO es NETO redondeado, pero el IMPORTE ya trae el IVA (10 × 5.143 = 51.430 neto
// → $61.200). Por eso manda el importe: total = importe, neto = importe ÷ 1,19 y el resto de redondeo se
// ajusta en la última línea para que Σ neto = «Total neto» del pie. La descripción larga sigue en la fila
// siguiente («(100)», «LAGOON»). Cantidades en unidades vendibles (un pack de 100 fundas es 1).
// Verificado con la factura N° 2940 del 15-09-2026 (docs/pdf/N 2940 BLACKFAERIE_CLIENTE_…pdf).
import {
  fechaIsoDesdeCl,
  normalizarRut,
  parsearNumeroCl,
  type DocumentoLeido,
  type LineaLeida,
} from '@onplay/dominio';
import type { PaginaTexto } from '../pdf.js';

export const RUT_BLACKFAERIE = '76648466-2';
export const NOMBRE_BLACKFAERIE = 'Black Faerie (Accesorios Tcg SpA)';
const IVA = 0.19;
const CODIGO_Y_DESCRIPCION = /^\[([^\]]+)\]\s*(.*)$/;

export function reconoceBlackfaerie(paginas: PaginaTexto[]): boolean {
  const primera = paginas[0] ?? [];
  return primera.some((fila) =>
    fila.some((c) => normalizarRut(c) === RUT_BLACKFAERIE || /blackfaerie|accesorios tcg/i.test(c)),
  );
}

/** «$ 61.200» viene como dos celdas («$», «61.200»); también acepta «$61.200» en una. */
function montoAlFinal(fila: string[]): number | null {
  const n = parsearNumeroCl((fila[fila.length - 1] ?? '').replace(/^\$\s*/, ''));
  return n === null ? null : Math.round(n);
}

interface LineaBruta {
  codigoProveedor: string;
  descripcion: string;
  cantidad: number;
  importe: number; // con IVA
}

function leerLinea(fila: string[]): LineaBruta | null {
  const m = CODIGO_Y_DESCRIPCION.exec(fila[0] ?? '');
  if (!m || fila.length < 4) return null;
  const sinPeso = fila.filter((c) => c.trim() !== '$');
  const importe = montoAlFinal(sinPeso);
  const cantidad = parsearNumeroCl(sinPeso[1] ?? '');
  if (importe === null || cantidad === null || cantidad <= 0 || !Number.isInteger(cantidad)) return null;
  return { codigoProveedor: m[1]!.trim(), descripcion: m[2]!.trim(), cantidad, importe };
}

export function leerBlackfaerie(paginas: PaginaTexto[]): DocumentoLeido {
  const advertencias: string[] = [];
  let numeroDocumento: string | null = null;
  let fechaDocumento: string | null = null;
  const pie = { neto: null as number | null, total: null as number | null };
  const brutas: LineaBruta[] = [];

  for (const pagina of paginas) {
    let anterior: LineaBruta | null = null;
    for (const fila of pagina) {
      const texto = fila.join(' ');
      if (numeroDocumento === null && /^N[°º]:?$/.test(fila[0] ?? '') && /^\d+$/.test(fila[1] ?? '')) {
        numeroDocumento = fila[1]!;
      }
      if (fechaDocumento === null && fila[0] === 'Fecha:' && fila[1]) fechaDocumento = fechaIsoDesdeCl(fila[1]);
      const linea = leerLinea(fila);
      if (linea) {
        brutas.push(linea);
        anterior = linea;
        continue;
      }
      if (/^Total neto$/i.test(fila[0] ?? '')) pie.neto = montoAlFinal(fila);
      else if (/^Total$/i.test(fila[0] ?? '')) pie.total = montoAlFinal(fila);
      // Continuación de la descripción: una sola celda justo debajo de una línea.
      if (anterior && fila.length === 1 && !/p[áa]gina|timbre|total/i.test(texto)) {
        anterior.descripcion = `${anterior.descripcion} ${fila[0]!.trim()}`;
        continue;
      }
      anterior = null;
    }
  }

  const sumaImportes = brutas.reduce((a, l) => a + l.importe, 0);
  const totalDoc = pie.total ?? sumaImportes;
  const netoDoc = pie.neto ?? Math.round(totalDoc / (1 + IVA));
  if (pie.total !== null && pie.total !== sumaImportes) {
    advertencias.push(`El total del pie ($${pie.total.toLocaleString('es-CL')}) no cuadra con la suma de los importes ($${sumaImportes.toLocaleString('es-CL')}).`);
  }

  let netoAsignado = 0;
  const lineas: LineaLeida[] = brutas.map((l, i) => {
    let neto = Math.round(l.importe / (1 + IVA));
    if (i === brutas.length - 1 && pie.total === sumaImportes) neto = netoDoc - netoAsignado; // Σ neto = pie
    netoAsignado += neto;
    return {
      codigoProveedor: l.codigoProveedor,
      descripcion: l.descripcion,
      bultos: l.cantidad,
      unidadesPorBulto: 1, // factura en unidades vendibles: «(100)» son las fundas del pack, no el bulto
      sueltas: 0,
      neto,
      impuestos: l.importe - neto,
      total: l.importe,
    };
  });

  if (numeroDocumento === null) advertencias.push('No se encontró el número de la factura.');
  if (fechaDocumento === null) advertencias.push('No se encontró la fecha de emisión.');
  if (lineas.length === 0) advertencias.push('No se reconoció ninguna línea de producto.');
  if (pie.total === null) advertencias.push('No se encontró el total de la factura: se usó la suma de los importes.');

  return {
    lector: 'blackfaerie',
    moneda: 'CLP',
    proveedor: { rut: RUT_BLACKFAERIE, nombre: NOMBRE_BLACKFAERIE },
    tipoDocumento: 'factura',
    numeroDocumento,
    fechaDocumento,
    lineas,
    totales: lineas.length ? { neto: netoDoc, impuestos: totalDoc - netoDoc, total: totalDoc } : null,
    advertencias,
  };
}
