// Lector de Coqui Hobby Distribution (Sanford, FL; distribuidor extranjero) — 11-SDD §6.3.
// «Sales Order» en USD. pdfjs entrega cada palabra en una celda, así que se trabaja sobre la fila
// unida por espacios. Columnas: NO. · ITEM («CODIGO: descripción», que puede seguir en las filas
// siguientes) · UOM · QTY. · MSRP · NET PRICE · EXT PRICE. Los kits de torneo vienen a 0.00.
// Montos en la moneda del documento (`totalOriginal`); los CLP se calculan en la ruta con el tipo de
// cambio y los gastos de importación que indica la persona (11-SDD §6.6). Las cantidades son
// unidades vendibles (un pack de 100 fundas es 1); un «*DISPLAY*» trae varios y se fija al vincular.
// Verificado con la orden 0092856 del 21-05-2026 (docs/pdf/Sales OrderSO 0092856 (1).pdf).
import { parsearNumeroUs, type DocumentoLeido, type LineaLeida } from '@onplay/dominio';
import type { PaginaTexto } from '../pdf.js';

export const NOMBRE_COQUI = 'Coqui Hobby Distribution';

export function reconoceCoqui(paginas: PaginaTexto[]): boolean {
  const primera = paginas[0] ?? [];
  return primera.some((fila) => /coqui\s+hobby/i.test(fila.join(' ')));
}

const LINEA = /^(\d{1,3}) ([A-Z0-9-]+): (.*?) (EACH|CASE|BOX|PACK|PK|EA) (\d+) (\S+) (\S+) (\S+)$/i;
const FIN_DE_TABLA = /^(Continued\.\.\.|Page:|NOTE:|Sales Total:|Freight|Less Discount|Tax Total|Total \(USD\))/i;

export function leerCoqui(paginas: PaginaTexto[]): DocumentoLeido {
  const advertencias: string[] = [];
  let numeroDocumento: string | null = null;
  let fechaDocumento: string | null = null;
  let moneda: 'CLP' | 'USD' = 'USD';
  let totalOriginal: number | null = null;
  const lineas: (LineaLeida & { uom: string })[] = [];

  for (const pagina of paginas) {
    let enLinea = false; // las filas siguientes a una línea continúan su descripción
    for (const fila of pagina) {
      const texto = fila.join(' ').trim();
      if (numeroDocumento === null) {
        const m = /Order No\.:\s*(\d{3,})/.exec(texto);
        if (m) numeroDocumento = m[1]!;
      }
      if (fechaDocumento === null) {
        const m = /Order Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto); // m/d/yyyy (EE. UU.)
        if (m) fechaDocumento = `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
      }
      const mMoneda = /Currency:\s*([A-Z]{3})/.exec(texto);
      if (mMoneda) moneda = mMoneda[1] === 'CLP' ? 'CLP' : 'USD';
      const mTotal = /Total \((?:USD|[A-Z]{3})\):\s*([\d,]+\.\d{2})/.exec(texto);
      if (mTotal) {
        const t = parsearNumeroUs(mTotal[1]!);
        if (t !== null) totalOriginal = t;
      }
      const m = LINEA.exec(texto);
      if (m) {
        const ext = parsearNumeroUs(m[8]!);
        if (ext === null) {
          advertencias.push(`Línea ${m[1]}: no se entendió el monto «${m[8]}».`);
          enLinea = false;
          continue;
        }
        lineas.push({
          codigoProveedor: m[2]!,
          descripcion: m[3]!,
          bultos: Number(m[5]),
          unidadesPorBulto: 1,
          sueltas: 0,
          neto: 0,
          impuestos: 0,
          total: 0,
          totalOriginal: ext,
          uom: m[4]!.toUpperCase(),
        });
        enLinea = true;
        continue;
      }
      if (FIN_DE_TABLA.test(texto) || /^NO\. ITEM/.test(texto)) {
        enLinea = false;
        continue;
      }
      if (enLinea && lineas.length > 0) {
        const ultima = lineas[lineas.length - 1]!;
        ultima.descripcion = `${ultima.descripcion} ${texto}`.slice(0, 191);
      }
    }
  }

  if (numeroDocumento === null) advertencias.push('No se encontró el número de la orden.');
  if (fechaDocumento === null) advertencias.push('No se encontró la fecha de la orden.');
  if (lineas.length === 0) advertencias.push('No se reconoció ninguna línea de producto.');
  if (totalOriginal === null) advertencias.push('No se encontró el total de la orden.');
  const gratis = lineas.filter((l) => (l.totalOriginal ?? 0) === 0);
  if (gratis.length) advertencias.push(`${gratis.length} línea(s) sin costo (kits o promociones): entran al stock con costo 0.`);
  for (const l of lineas) {
    if (/display/i.test(l.descripcion)) advertencias.push(`«${l.descripcion.slice(0, 60)}…» es un display: al vincular, indica cuántas unidades trae si se vende por unidad.`);
  }

  return {
    lector: 'coqui',
    moneda,
    proveedor: { rut: null, nombre: NOMBRE_COQUI },
    tipoDocumento: 'otro', // orden de venta del distribuidor, no documento tributario chileno
    numeroDocumento,
    fechaDocumento,
    lineas: lineas.map(({ uom: _uom, ...l }) => l),
    totales: null, // en CLP se calcula con el tipo de cambio (ruta)
    totalOriginal,
    advertencias,
  };
}
