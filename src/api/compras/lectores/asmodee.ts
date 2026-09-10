// Lector de Asmodee Chile (Importadora y Comercializadora Skyship SPA, RUT 76.353.094-9) — 11-SDD §6.3.
// Factura electrónica con código de producto: CÓDIGO · DESCRIPCIÓN · UNID · CANTIDAD · PRECIO UNITARIO ·
// TOTAL, montos NETOS con «$» y punto de miles. El IVA solo aparece en el pie («MONTO IVA 19%») y se
// reparte por línea según el neto. La línea «LOG01 Envío y Embalaje» es flete: sale de las líneas y su
// neto se reparte entre los productos (costo puesto en la tienda, D-E6-1). Cantidades en unidades
// vendibles (un pack de fundas es 1). La segunda página repite la primera (copia): se descarta.
// Verificado con la factura N° 48041 del 01-09-2026 (docs/pdf/Factura de venta_39045.pdf).
import {
  fechaIsoDesdeCl,
  normalizarRut,
  parsearNumeroCl,
  type DocumentoLeido,
  type LineaLeida,
} from '@onplay/dominio';
import type { PaginaTexto } from '../pdf.js';

export const RUT_ASMODEE = '76353094-9';
export const NOMBRE_ASMODEE = 'Asmodee Chile (Skyship SPA)';
const IVA = 0.19;
const ES_FLETE = /^(LOG\d*|FLETE|DESPACHO)$/i;
const ES_DESCRIPCION_FLETE = /env[íi]o|embalaje|flete|despacho/i;

export function reconoceAsmodee(paginas: PaginaTexto[]): boolean {
  const primera = paginas[0] ?? [];
  return primera.some((fila) => fila.some((c) => normalizarRut(c) === RUT_ASMODEE || /asmodee|skyship/i.test(c)));
}

function monto(celda: string): number | null {
  const n = parsearNumeroCl(celda.replace(/^\$\s*/, ''));
  return n === null ? null : Math.round(n);
}

interface LineaNeta {
  codigoProveedor: string;
  descripcion: string;
  bultos: number;
  neto: number;
  esFlete: boolean;
}

function leerLinea(fila: string[]): LineaNeta | null {
  // CÓDIGO · DESCRIPCIÓN · UNID · CANTIDAD · PRECIO UNITARIO · TOTAL (6 celdas; se lee desde la derecha)
  if (fila.length < 6 || !/^[A-Z0-9-]{3,}$/i.test(fila[0]!)) return null;
  const n = fila.length;
  const total = monto(fila[n - 1]!);
  const unitario = monto(fila[n - 2]!);
  if (total === null || unitario === null || !/^\d+$/.test(fila[n - 3]!)) return null;
  const descripcion = fila.slice(1, n - 4).join(' ').trim();
  if (!descripcion) return null;
  const codigo = fila[0]!;
  return {
    codigoProveedor: codigo,
    descripcion,
    bultos: Number(fila[n - 3]),
    neto: total,
    esFlete: ES_FLETE.test(codigo) || ES_DESCRIPCION_FLETE.test(descripcion),
  };
}

export function leerAsmodee(paginas: PaginaTexto[]): DocumentoLeido {
  const advertencias: string[] = [];
  let numeroDocumento: string | null = null;
  let fechaDocumento: string | null = null;
  const pie = { neto: null as number | null, total: null as number | null };
  const netas: LineaNeta[] = [];
  let firmaPrimera: string | null = null;

  paginas.forEach((pagina, indice) => {
    const deEstaPagina: LineaNeta[] = [];
    for (const fila of pagina) {
      const texto = fila.join(' ');
      if (numeroDocumento === null) {
        const m = /N[°º]\s*(\d{3,})/.exec(texto);
        if (m) numeroDocumento = m[1]!;
      }
      if (fechaDocumento === null) {
        const m = /FECHA EMISI[ÓO]N\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(texto);
        if (m) fechaDocumento = fechaIsoDesdeCl(m[1]!);
      }
      const linea = leerLinea(fila);
      if (linea) {
        deEstaPagina.push(linea);
        continue;
      }
      if (/^MONTO NETO/i.test(fila[fila.length - 2] ?? '')) {
        const v = monto(fila[fila.length - 1]!);
        if (v !== null) pie.neto = v;
      }
      if (/^MONTO TOTAL/i.test(fila[fila.length - 2] ?? '')) {
        const v = monto(fila[fila.length - 1]!);
        if (v !== null) pie.total = v;
      }
    }
    const firma = JSON.stringify(deEstaPagina);
    if (indice === 0) firmaPrimera = firma;
    else if (firma === firmaPrimera && deEstaPagina.length > 0) return; // copia
    netas.push(...deEstaPagina);
  });

  const fletes = netas.filter((l) => l.esFlete);
  const productos = netas.filter((l) => !l.esFlete);
  const fleteNeto = fletes.reduce((a, l) => a + l.neto, 0);
  const sumaNetoProductos = productos.reduce((a, l) => a + l.neto, 0);
  const sumaNeto = sumaNetoProductos + fleteNeto;
  if (pie.neto !== null && Math.abs(pie.neto - sumaNeto) > Math.max(1, netas.length)) {
    advertencias.push(`El neto del pie ($${pie.neto.toLocaleString('es-CL')}) no cuadra con la suma de las líneas ($${sumaNeto.toLocaleString('es-CL')}).`);
  }
  const totalDoc = pie.total;
  const impuestosTotal = totalDoc === null ? Math.round(sumaNeto * IVA) : Math.max(0, totalDoc - sumaNeto);
  const aRepartir = fleteNeto + impuestosTotal;
  let asignado = 0;
  let fleteAsignado = 0;
  const lineas: LineaLeida[] = productos.map((l, i) => {
    let extra = sumaNetoProductos > 0 ? Math.round((aRepartir * l.neto) / sumaNetoProductos) : 0;
    let parteFlete = sumaNetoProductos > 0 ? Math.round((fleteNeto * l.neto) / sumaNetoProductos) : 0;
    if (i === productos.length - 1) {
      extra = aRepartir - asignado; // el resto, para que Σ total = total del documento
      parteFlete = fleteNeto - fleteAsignado; // y Σ neto = neto del documento
    }
    asignado += extra;
    fleteAsignado += parteFlete;
    return {
      codigoProveedor: l.codigoProveedor,
      descripcion: l.descripcion,
      bultos: l.bultos,
      unidadesPorBulto: 1, // Asmodee factura en unidades vendibles (un pack de fundas es 1)
      sueltas: 0,
      neto: l.neto + parteFlete,
      impuestos: extra - parteFlete,
      total: l.neto + extra,
    };
  });

  if (numeroDocumento === null) advertencias.push('No se encontró el número de la factura.');
  if (fechaDocumento === null) advertencias.push('No se encontró la fecha de emisión.');
  if (lineas.length === 0) advertencias.push('No se reconoció ninguna línea de producto.');
  if (totalDoc === null) advertencias.push('No se encontró el total de la factura: se aplicó IVA 19 % a las líneas.');
  if (fletes.length) {
    advertencias.push(`«${fletes.map((f) => f.descripcion).join('», «')}» ($${fleteNeto.toLocaleString('es-CL')} neto) es flete: se repartió entre los productos según su neto y forma parte del costo.`);
  }

  return {
    lector: 'asmodee',
    moneda: 'CLP',
    proveedor: { rut: RUT_ASMODEE, nombre: NOMBRE_ASMODEE },
    tipoDocumento: 'factura',
    numeroDocumento,
    fechaDocumento,
    lineas,
    totales: totalDoc === null ? null : { neto: sumaNeto, impuestos: totalDoc - sumaNeto, total: totalDoc },
    advertencias,
  };
}
