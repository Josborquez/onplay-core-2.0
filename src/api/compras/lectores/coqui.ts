// Lector de Coqui Hobby Distribution (Sanford, FL; distribuidor extranjero) — 11-SDD §6.3.
// Coqui manda DOS documentos en USD:
//   · «Sales Order» (orden 0092856): pdfjs entrega una palabra por celda, así que se trabaja sobre la
//     fila unida por espacios; línea = `N CODIGO: descripción UOM QTY MSRP NET EXT` y las filas siguientes
//     sin ese patrón continúan la descripción.
//   · «INVOICE» (referencia 097440): celdas enteras `N · (CODIGO) descripción · QTY · UOM · MSRP · PRICE ·
//     EXT PRICE`, continuación en una celda sola («(24ct)»), y un «Shipping & Handling» en USD que se
//     reparte entre las líneas con monto (costo puesto en la tienda, D-E6-1).
// Los kits de torneo vienen a 0.00. Montos en la moneda del documento (`totalOriginal`); los CLP se
// calculan en la ruta con el tipo de cambio y los gastos de importación que indica la persona (§6.6).
// Las cantidades son unidades vendibles (un pack de 100 fundas es 1); un display se fija al vincular.
import { parsearNumeroUs, type DocumentoLeido, type LineaLeida } from '@onplay/dominio';
import type { PaginaTexto } from '../pdf.js';

export const NOMBRE_COQUI = 'Coqui Hobby Distribution';

export function reconoceCoqui(paginas: PaginaTexto[]): boolean {
  const primera = paginas[0] ?? [];
  return primera.some((fila) => /coqui\s*hobby/i.test(fila.join(' ')));
}

const LINEA_ORDEN = /^(\d{1,3}) ([A-Z0-9-]+): (.*?) (EACH|CASE|BOX|PACK|PK|EA) (\d+) (\S+) (\S+) (\S+)$/i;
const ITEM_INVOICE = /^\(([A-Z0-9-]+)\)\s*(.+)$/;
const FIN_DE_TABLA = /^(Continued\.\.\.|Page|NOTE:|Sales Total|Freight|Less Discount|Tax Total|Shipping|Total \(USD\)|Please remit)/i;
const MESES_EN: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

interface LineaUsd extends LineaLeida {
  totalOriginal: number;
}

function lineaDesdeInvoice(fila: string[]): LineaUsd | null {
  // N · (CODIGO) descripción · QTY · UOM · MSRP · PRICE · EXT PRICE
  if (fila.length < 7 || !/^\d{1,3}$/.test(fila[0]!) || !/^\d+$/.test(fila[2]!)) return null;
  const m = ITEM_INVOICE.exec(fila[1]!);
  if (!m) return null;
  const ext = parsearNumeroUs(fila[fila.length - 1]!);
  if (ext === null) return null;
  return { codigoProveedor: m[1]!, descripcion: m[2]!.trim(), bultos: Number(fila[2]), unidadesPorBulto: 1, sueltas: 0, neto: 0, impuestos: 0, total: 0, totalOriginal: ext };
}

function lineaDesdeOrden(texto: string): LineaUsd | null {
  const m = LINEA_ORDEN.exec(texto);
  if (!m) return null;
  const ext = parsearNumeroUs(m[8]!);
  if (ext === null) return null;
  return { codigoProveedor: m[2]!, descripcion: m[3]!, bultos: Number(m[5]), unidadesPorBulto: 1, sueltas: 0, neto: 0, impuestos: 0, total: 0, totalOriginal: ext };
}

export function leerCoqui(paginas: PaginaTexto[]): DocumentoLeido {
  const advertencias: string[] = [];
  let numeroDocumento: string | null = null;
  let fechaDocumento: string | null = null;
  let moneda: 'CLP' | 'USD' = 'USD';
  let totalOriginal: number | null = null;
  let envio = 0;
  const lineas: LineaUsd[] = [];

  for (const pagina of paginas) {
    let enLinea = false; // las filas siguientes a una línea continúan su descripción
    for (const fila of pagina) {
      const texto = fila.join(' ').trim();
      if (numeroDocumento === null) {
        const m = /(?:Order No\.|Reference No\.):\s*(\d{3,})/.exec(texto);
        if (m) numeroDocumento = m[1]!;
      }
      if (fechaDocumento === null) {
        const mUs = /(?:Order )?Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto); // m/d/yyyy (Sales Order)
        const mEn = /(?:^|\s)Date:\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(texto); // 01-Sep-2026 (Invoice)
        if (mUs) fechaDocumento = `${mUs[3]}-${mUs[1]!.padStart(2, '0')}-${mUs[2]!.padStart(2, '0')}`;
        else if (mEn && MESES_EN[mEn[2]!.toLowerCase()]) fechaDocumento = `${mEn[3]}-${MESES_EN[mEn[2]!.toLowerCase()]}-${mEn[1]!.padStart(2, '0')}`;
      }
      const mMoneda = /Currency:\s*([A-Z]{3})/.exec(texto);
      if (mMoneda) moneda = mMoneda[1] === 'CLP' ? 'CLP' : 'USD';
      const mTotal = /Total \((?:USD|[A-Z]{3})\):\s*([\d,]+\.\d{2})/.exec(texto);
      if (mTotal) {
        const t = parsearNumeroUs(mTotal[1]!);
        if (t !== null) totalOriginal = t;
      }
      if (/^Shipping/i.test(fila[0] ?? '') && fila.length >= 2) {
        const s = parsearNumeroUs(fila[fila.length - 1]!);
        if (s !== null) envio = s;
      }
      const linea = lineaDesdeInvoice(fila) ?? lineaDesdeOrden(texto);
      if (linea) {
        lineas.push(linea);
        enLinea = true;
        continue;
      }
      if (FIN_DE_TABLA.test(texto) || /^NO\.\s+ITEM/.test(texto) || /^PRICE$/.test(texto)) {
        enLinea = false;
        continue;
      }
      if (enLinea && lineas.length > 0) {
        const ultima = lineas[lineas.length - 1]!;
        ultima.descripcion = `${ultima.descripcion} ${texto}`.slice(0, 191);
      }
    }
  }

  // Envío del invoice: se reparte entre las líneas con monto según su monto, con el resto en la última.
  if (envio > 0 && lineas.length > 0) {
    const base = lineas.map((l) => l.totalOriginal);
    const sumaBase = base.reduce((a, b) => a + b, 0);
    if (sumaBase > 0) {
      let asignado = 0;
      let ultimaConMonto = -1;
      base.forEach((b, i) => {
        if (b > 0) ultimaConMonto = i;
      });
      lineas.forEach((l, i) => {
        let parte = Math.round(((envio * base[i]!) / sumaBase) * 100) / 100;
        if (i === ultimaConMonto) parte = Math.round((envio - asignado) * 100) / 100;
        asignado = Math.round((asignado + parte) * 100) / 100;
        l.totalOriginal = Math.round((l.totalOriginal + parte) * 100) / 100;
      });
      advertencias.push(`El envío (US$ ${envio.toFixed(2)}) se repartió entre los productos con monto según su precio y forma parte del costo.`);
    }
  }

  if (numeroDocumento === null) advertencias.push('No se encontró el número de la orden.');
  if (fechaDocumento === null) advertencias.push('No se encontró la fecha de la orden.');
  if (lineas.length === 0) advertencias.push('No se reconoció ninguna línea de producto.');
  if (totalOriginal === null) advertencias.push('No se encontró el total de la orden.');
  const gratis = lineas.filter((l) => l.totalOriginal === 0);
  if (gratis.length) advertencias.push(`${gratis.length} línea(s) sin costo (kits o promociones): entran al stock con costo 0.`);
  for (const l of lineas) {
    if (/display/i.test(l.descripcion)) advertencias.push(`«${l.descripcion.slice(0, 60)}…» es un display: al vincular, indica cuántas unidades trae si se vende por unidad.`);
  }

  return {
    lector: 'coqui',
    moneda,
    proveedor: { rut: null, nombre: NOMBRE_COQUI },
    tipoDocumento: 'otro', // orden o invoice del distribuidor, no documento tributario chileno
    numeroDocumento,
    fechaDocumento,
    lineas,
    totales: null, // en CLP se calcula con el tipo de cambio (ruta)
    totalOriginal,
    advertencias,
  };
}
