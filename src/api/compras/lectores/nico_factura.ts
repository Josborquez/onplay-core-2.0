// Lector de la FACTURA electrónica de Distribuidora Nico (Oscar Fernando Leiva Sanhueza,
// «Distribuidora de Confites», RUT 10.879.175-6) — 11-SDD §6.3.
// Es el documento tributario que acompaña al «pedido» web (lectores/nico.ts). Difiere del pedido:
//   · una fila por CÓDIGO base (el pedido separa variantes: «239-2 Bilz», «239-3 Pepsi»…; la factura
//     trae «239 Lata ccu 162» con todo junto), y la cantidad viene en la unidad que Nico factura
//     (latas sueltas para bebidas, cajas para alfajores);
//   · precios y totales de línea NETOS; el IVA y el impuesto específico (ILA18) solo aparecen en el
//     pie: aquí se prorratean por línea según el neto para que el costo unitario sea bruto (D-E6-1).
// Columnas: CODIGO · CANT. · DETALLE · P.UNITARIO · DSCTO · TOTAL. La segunda página es CEDIBLE.
// Verificado con el folio 111162 del 08-09-2026 (docs/pdf/20260908141054213iw13z.pdf).
import {
  fechaIsoDesdeCl,
  parsearNumeroCl,
  unidadesPorBultoDesdeDescripcion,
  type DocumentoLeido,
  type LineaLeida,
} from '@onplay/dominio';
import type { PaginaTexto } from '../pdf.js';

import { NOMBRE_NICO, RUT_NICO } from './nico.js';

const IVA = 0.19;

/** El RUT llega partido en celdas («R.U.T.: | 10.879.175 | - | 6»): se junta la fila sin espacios. */
export function reconoceNicoFactura(paginas: PaginaTexto[]): boolean {
  const primera = paginas[0] ?? [];
  const tieneRut = primera.some((fila) => /10\.?879\.?175-?6/.test(fila.join('')));
  const esFactura = primera.some((fila) => fila.some((c) => /factura electr[óo]nica/i.test(c)));
  return tieneRut && esFactura;
}

const ES_CODIGO = /^\d{1,7}$/;
const ES_ENTERO = /^\d+$/;

interface LineaNeta {
  codigoProveedor: string;
  descripcion: string;
  bultos: number;
  unidadesPorBulto: number;
  neto: number;
}

function leerLinea(fila: string[]): LineaNeta | null {
  // CODIGO · CANT. · DETALLE · P.UNITARIO · DSCTO · TOTAL (≥ 6 celdas; se lee desde la derecha)
  if (fila.length < 6 || !ES_CODIGO.test(fila[0]!) || !ES_ENTERO.test(fila[1]!)) return null;
  const n = fila.length;
  const total = parsearNumeroCl(fila[n - 1]!);
  const dscto = parsearNumeroCl(fila[n - 2]!);
  const punit = parsearNumeroCl(fila[n - 3]!);
  if (total === null || dscto === null || punit === null) return null;
  const descripcion = fila.slice(2, n - 3).join(' ');
  return {
    codigoProveedor: fila[0]!,
    descripcion,
    bultos: Number(fila[1]),
    unidadesPorBulto: unidadesPorBultoDesdeDescripcion(descripcion) ?? 1,
    neto: Math.round(total),
  };
}

export function leerNicoFactura(paginas: PaginaTexto[]): DocumentoLeido {
  const advertencias: string[] = [];
  let numeroDocumento: string | null = null;
  let fechaDocumento: string | null = null;
  // En un objeto: se asignan dentro del forEach y TypeScript no sigue esas asignaciones en variables sueltas.
  const pie = { neto: null as number | null, total: null as number | null };
  const netas: LineaNeta[] = [];
  let firmaPrimera: string | null = null;

  paginas.forEach((pagina, indice) => {
    const deEstaPagina: LineaNeta[] = [];
    let ultimoNumeroSolo: number | null = null; // en el pie, el valor de NETO viene en la fila ANTERIOR a la etiqueta
    for (const fila of pagina) {
      const texto = fila.join(' ');
      if (numeroDocumento === null) {
        const m = /Folio\s*N[°º]\s*(\d{3,})/.exec(texto);
        if (m) numeroDocumento = m[1]!;
      }
      if (fechaDocumento === null) {
        const m = /Fecha\s*:\s*(\d{2}\/\d{2}\/\d{4})/.exec(texto);
        if (m) fechaDocumento = fechaIsoDesdeCl(m[1]!);
      }
      const linea = leerLinea(fila);
      if (linea) {
        deEstaPagina.push(linea);
        continue;
      }
      // Pie: «NETO :» trae el valor en la misma fila o, por la maqueta, en la fila justo anterior.
      if (/^NETO\s*:/.test(fila[0] ?? '')) {
        const v = fila.length > 1 ? parsearNumeroCl(fila[fila.length - 1]!) : ultimoNumeroSolo;
        if (v !== null) pie.neto = Math.round(v);
        continue;
      }
      ultimoNumeroSolo = fila.length === 1 ? parsearNumeroCl(fila[0]!) : null;
      if (/^TOTAL\s*:/.test(fila[0] ?? '') && fila.length > 1) {
        const v = parsearNumeroCl(fila[fila.length - 1]!);
        if (v !== null) pie.total = Math.round(v);
      }
    }
    const firma = JSON.stringify(deEstaPagina);
    if (indice === 0) firmaPrimera = firma;
    else if (firma === firmaPrimera && deEstaPagina.length > 0) return; // copia CEDIBLE
    netas.push(...deEstaPagina);
  });

  // Las líneas SON el neto del documento; el «NETO :» del pie solo sirve para confirmar.
  const sumaNeto = netas.reduce((a, l) => a + l.neto, 0);
  const neto = sumaNeto;
  const totalDoc = pie.total;
  if (pie.neto !== null && Math.abs(pie.neto - sumaNeto) > Math.max(1, netas.length)) {
    advertencias.push(`El neto del pie ($${pie.neto.toLocaleString('es-CL')}) no cuadra con la suma de las líneas ($${sumaNeto.toLocaleString('es-CL')}).`);
  }
  // Impuestos por línea: TODO lo que separa el neto del total (IVA + ILA y otros específicos) se
  // reparte por neto, con el resto en la última línea, así Σ total de líneas = total del documento.
  // Sin total en el pie, solo IVA por línea.
  const ivaTotal = Math.round(neto * IVA);
  const impuestosTotal = totalDoc === null ? ivaTotal : Math.max(0, totalDoc - neto);
  const especificos = Math.max(0, impuestosTotal - ivaTotal);
  let asignado = 0;
  const lineas: LineaLeida[] = netas.map((l, i) => {
    let impuestos = sumaNeto > 0 ? Math.round((impuestosTotal * l.neto) / sumaNeto) : 0;
    if (i === netas.length - 1) impuestos = impuestosTotal - asignado;
    asignado += impuestos;
    return {
      codigoProveedor: l.codigoProveedor,
      descripcion: l.descripcion,
      bultos: l.bultos,
      unidadesPorBulto: l.unidadesPorBulto,
      sueltas: 0,
      neto: l.neto,
      impuestos,
      total: l.neto + impuestos,
    };
  });

  if (numeroDocumento === null) advertencias.push('No se encontró el folio de la factura.');
  if (fechaDocumento === null) advertencias.push('No se encontró la fecha de emisión.');
  if (lineas.length === 0) advertencias.push('No se reconoció ninguna línea de producto.');
  if (totalDoc === null) advertencias.push('No se encontró el total de la factura: solo se aplicó IVA a las líneas.');
  if (especificos > 0) {
    advertencias.push(
      `La factura trae $${especificos.toLocaleString('es-CL')} de impuestos específicos (ILA) solo en el total: se repartieron entre las líneas según su neto, así que el costo unitario de las bebidas es aproximado.`,
    );
  }

  return {
    lector: 'nico_factura',
    proveedor: { rut: RUT_NICO, nombre: NOMBRE_NICO },
    tipoDocumento: 'factura',
    numeroDocumento,
    fechaDocumento,
    lineas,
    totales: totalDoc === null ? null : { neto, impuestos: totalDoc - neto, total: totalDoc },
    advertencias,
  };
}
