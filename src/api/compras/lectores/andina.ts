// Lector de Embotelladora Andina S.A. (Coca-Cola, RUT 91.144.000-8) — 11-SDD §6.3.
// Factura electrónica en cajas/botellas. Columnas de la tabla, de izquierda a derecha:
//   COD · DESCRIPCION · CAJ/BOT · P.UNIT · SUB TOTAL · TASA DESCTO% · MONTO DESCTO · FLETE ·
//   NETO · IMPTO ESPECIF · TOTAL · BRUTO x BOT
// Verificado con la factura 097397951 del 09-09-2026: TOTAL de la línea = NETO × 1,19 + IMPTO
// ESPECÍFICO, y BRUTO x BOT = TOTAL / botellas. El total del documento = Σ NETO + IVA + Σ específicos.
// La segunda página es la copia CEDIBLE con las mismas líneas: se descarta si repite la primera.
import {
  fechaIsoDesdeCl,
  normalizarRut,
  parsearNumeroCl,
  unidadesPorBultoDesdeDescripcion,
  type DocumentoLeido,
  type LineaLeida,
} from '@onplay/dominio';
import type { PaginaTexto } from '../pdf.js';

export const RUT_ANDINA = '91144000-8';

/** ¿Este documento es de Andina? Basta con que aparezca su RUT o su razón social. */
export function reconoceAndina(paginas: PaginaTexto[]): boolean {
  const primera = paginas[0] ?? [];
  return primera.some((fila) =>
    fila.some(
      (c) => normalizarRut(c.replace(/^R\.U\.T\.:?\s*/i, '')) === RUT_ANDINA || /embotelladora andina/i.test(c),
    ),
  );
}

const ES_CODIGO = /^\d{5,7}$/;
const ES_CAJ_BOT = /^(\d+)\/(\d+)$/;

function leerLinea(fila: string[]): LineaLeida | null {
  // Forma mínima: código · descripción · caj/bot · … · neto · impto · total · bruto x bot (≥ 8 celdas).
  if (fila.length < 8 || !ES_CODIGO.test(fila[0]!)) return null;
  const cajBot = ES_CAJ_BOT.exec(fila[2]!);
  if (!cajBot) return null;
  // Se lee desde el final: las columnas de la derecha son estables aunque falte alguna del medio.
  const n = fila.length;
  const total = parsearNumeroCl(fila[n - 2]!);
  const impuesto = parsearNumeroCl(fila[n - 3]!);
  const neto = parsearNumeroCl(fila[n - 4]!);
  if (total === null || impuesto === null || neto === null) return null;
  const descripcion = fila[1]!;
  return {
    codigoProveedor: fila[0]!,
    descripcion,
    bultos: Number(cajBot[1]),
    unidadesPorBulto: unidadesPorBultoDesdeDescripcion(descripcion) ?? 1,
    sueltas: Number(cajBot[2]),
    neto: Math.round(neto),
    impuestos: Math.round(total - neto), // IVA de la línea + impuesto específico
    total: Math.round(total),
  };
}

export function leerAndina(paginas: PaginaTexto[]): DocumentoLeido {
  const advertencias: string[] = [];
  let numeroDocumento: string | null = null;
  let fechaDocumento: string | null = null;
  let tipo: DocumentoLeido['tipoDocumento'] = 'factura';
  let totales: DocumentoLeido['totales'] = null;
  const lineas: LineaLeida[] = [];
  let firmaPrimera: string | null = null;

  paginas.forEach((pagina, indice) => {
    const deEstaPagina: LineaLeida[] = [];
    let enTotales = false;
    for (const fila of pagina) {
      const texto = fila.join(' ');
      if (numeroDocumento === null) {
        const m = /N[°º]\s*(\d{4,})/.exec(texto);
        if (m) numeroDocumento = m[1]!;
      }
      if (fechaDocumento === null) {
        const m = /FECHA:\s*(\d{2}-\d{2}-\d{4})/.exec(texto);
        if (m) fechaDocumento = fechaIsoDesdeCl(m[1]!);
      }
      if (/NOTA DE CR[ÉE]DITO/i.test(texto)) tipo = 'otro';
      if (/GU[ÍI]A DE DESPACHO/i.test(texto)) tipo = 'guia';
      const linea = leerLinea(fila);
      if (linea) {
        deEstaPagina.push(linea);
        continue;
      }
      if (fila[0] === 'NETO' && fila.includes('TOTAL')) {
        enTotales = true;
        continue;
      }
      if (enTotales && totales === null) {
        // Las celdas vacías no viajan: solo el primer (neto) y el último (total) número son fiables.
        const numeros = fila.map(parsearNumeroCl).filter((x): x is number => x !== null);
        if (numeros.length >= 2) {
          const neto = Math.round(numeros[0]!);
          const total = Math.round(numeros[numeros.length - 1]!);
          totales = { neto, impuestos: total - neto, total };
        }
        enTotales = false;
      }
    }
    const firma = JSON.stringify(deEstaPagina);
    if (indice === 0) firmaPrimera = firma;
    else if (firma === firmaPrimera && deEstaPagina.length > 0) return; // copia CEDIBLE
    lineas.push(...deEstaPagina);
  });

  if (numeroDocumento === null) advertencias.push('No se encontró el número de la factura.');
  if (fechaDocumento === null) advertencias.push('No se encontró la fecha de emisión.');
  if (lineas.length === 0) advertencias.push('No se reconoció ninguna línea de producto.');
  if (totales === null) advertencias.push('No se encontró la fila de totales.');
  for (const l of lineas) {
    if (unidadesPorBultoDesdeDescripcion(l.descripcion) === null) {
      advertencias.push(`«${l.descripcion}»: no dice cuántas unidades trae la caja; se asumió 1.`);
    }
  }
  if (tipo !== 'factura') {
    advertencias.push('El documento no parece una factura (nota de crédito o guía): revisar antes de recibir.');
  }

  return {
    lector: 'andina',
    proveedor: { rut: RUT_ANDINA, nombre: 'Embotelladora Andina S.A.' },
    tipoDocumento: tipo,
    numeroDocumento,
    fechaDocumento,
    lineas,
    totales,
    advertencias,
  };
}
