// Lector de Devir Chile Limitada (RUT 76.632.420-7) — 11-SDD §6.3.
// Factura electrónica simple: CANTIDAD · DETALLE · VALOR UNIT. · TOTAL, sin código de producto y con
// montos NETOS escritos con coma de miles («139,122», «2,004,130»). El IVA solo aparece en el pie y
// se reparte por línea según el neto. No hay código: la memoria de vinculación usa la descripción.
// Una línea «DSP Despacho» es flete, no producto: se saca de las líneas y su monto se reparte entre
// las demás por neto (costo puesto en la tienda, D-E6-1). «(Display 30ud)» → 30 unidades por display.
// Verificado con la factura 107327 del 04-08-2026 (docs/pdf/Onplay 107327.pdf).
import {
  fechaIsoDesdeCl,
  normalizarRut,
  parsearNumeroUs,
  unidadesPorBultoDesdeDescripcion,
  type DocumentoLeido,
  type LineaLeida,
} from '@onplay/dominio';
import type { PaginaTexto } from '../pdf.js';

export const RUT_DEVIR = '76632420-7';
export const NOMBRE_DEVIR = 'Devir Chile Limitada';
const IVA = 0.19;
const ES_FLETE = /^(DSP\s+)?(despacho|flete|env[íi]o)\b/i;

export function reconoceDevir(paginas: PaginaTexto[]): boolean {
  const primera = paginas[0] ?? [];
  return primera.some((fila) =>
    fila.some((c) => /devir chile/i.test(c) || normalizarRut(c.replace(/^R\.U\.T\.:?\s*/i, '')) === RUT_DEVIR),
  );
}

interface LineaNeta {
  descripcion: string;
  bultos: number;
  neto: number;
  esFlete: boolean;
}

function leerLinea(fila: string[]): LineaNeta | null {
  // CANTIDAD · DETALLE · VALOR UNIT. · TOTAL
  if (fila.length < 4 || !/^\d+$/.test(fila[0]!)) return null;
  const n = fila.length;
  const total = parsearNumeroUs(fila[n - 1]!);
  const unit = parsearNumeroUs(fila[n - 2]!);
  if (total === null || unit === null) return null;
  const descripcion = fila.slice(1, n - 2).join(' ').trim();
  if (!descripcion) return null;
  return { descripcion, bultos: Number(fila[0]), neto: Math.round(total), esFlete: ES_FLETE.test(descripcion) };
}

export function leerDevir(paginas: PaginaTexto[]): DocumentoLeido {
  const advertencias: string[] = [];
  let numeroDocumento: string | null = null;
  let fechaDocumento: string | null = null;
  const pie = { neto: null as number | null, total: null as number | null };
  const netas: LineaNeta[] = [];

  for (const pagina of paginas) {
    for (const fila of pagina) {
      const texto = fila.join(' ');
      if (numeroDocumento === null) {
        const m = /N[°º]\s*(\d{3,})/.exec(texto);
        if (m) numeroDocumento = m[1]!;
      }
      if (fechaDocumento === null) {
        const m = /SANTIAGO,\s*(\d{2}\/\d{2}\/\d{4})/.exec(texto);
        if (m) fechaDocumento = fechaIsoDesdeCl(m[1]!);
      }
      const linea = leerLinea(fila);
      if (linea) {
        netas.push(linea);
        continue;
      }
      if (fila[0] === 'NETO' && fila.length > 1) {
        const v = parsearNumeroUs(fila[fila.length - 1]!);
        if (v !== null) pie.neto = Math.round(v);
      }
      if (fila[0] === 'TOTAL' && fila.length > 1) {
        const v = parsearNumeroUs(fila[fila.length - 1]!);
        if (v !== null) pie.total = Math.round(v);
      }
    }
  }

  // Flete: fuera de las líneas, repartido por neto entre los productos.
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
  // Cada producto carga: su neto + parte del flete (por neto) + parte de los impuestos (por neto).
  const aRepartir = fleteNeto + impuestosTotal;
  let asignado = 0;
  const lineas: LineaLeida[] = productos.map((l, i) => {
    let extra = sumaNetoProductos > 0 ? Math.round((aRepartir * l.neto) / sumaNetoProductos) : 0;
    if (i === productos.length - 1) extra = aRepartir - asignado;
    asignado += extra;
    const parteFlete = sumaNetoProductos > 0 ? Math.round((fleteNeto * l.neto) / sumaNetoProductos) : 0;
    return {
      codigoProveedor: l.descripcion.slice(0, 191), // Devir no trae código: la descripción hace de clave
      descripcion: l.descripcion,
      bultos: l.bultos,
      unidadesPorBulto: unidadesPorBultoDesdeDescripcion(l.descripcion) ?? 1,
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
  for (const l of lineas) {
    if (unidadesPorBultoDesdeDescripcion(l.descripcion) === null) {
      advertencias.push(`«${l.descripcion}»: no dice cuántas unidades trae; se asumió 1 por bulto.`);
    }
  }

  return {
    lector: 'devir',
    moneda: 'CLP',
    proveedor: { rut: RUT_DEVIR, nombre: NOMBRE_DEVIR },
    tipoDocumento: 'factura',
    numeroDocumento,
    fechaDocumento,
    lineas,
    totales: totalDoc === null ? null : { neto: sumaNeto, impuestos: totalDoc - sumaNeto, total: totalDoc },
    advertencias,
  };
}
