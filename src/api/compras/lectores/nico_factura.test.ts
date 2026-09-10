import { describe, expect, it } from 'vitest';
import { leerNicoFactura, reconoceNicoFactura } from './nico_factura.js';
import { detectarLector } from './index.js';
import type { PaginaTexto } from '../pdf.js';

// Celdas reales del folio 111162 (docs/pdf/20260908141054213iw13z.pdf), tal como las entrega extraerPaginasPdf.
const LINEAS: string[][] = [
  ['239', '162', 'Lata ccu', '485', '0', '78.570'],
  ['830', '24', 'kem xtre.lata', '583', '0', '13.992'],
  ['655', '16', 'kryzpo grande', '1.286', '0', '20.576'],
  ['819', '1', 'Protein 45g x 5', '4.510', '0', '4.510'],
  ['11', '96', 'Alfajor game', '261', '0', '25.056'],
  ['344', '5', 'Nik', '335', '0', '1.675'],
  ['456', '24', 'Super 8', '250', '0', '6.000'],
  ['852', '4', 'Alfajor Premium Calaf', '4.025', '0', '16.100'],
  ['851', '2', 'ALFAJOR CLASIC CALAF', '4.025', '0', '8.050'],
  ['385', '1', 'Brownie sin azucar', '6.617', '0', '6.617'],
  ['534', '2', 'Brownie', '6.588', '0', '13.176'],
  ['58', '1', 'Braunichoc', '9.168', '0', '9.168'],
  ['532', '12', 'score 500 cc', '655', '0', '7.860'],
  ['822', '2', 'Orly tableta', '643', '0', '1.286'],
  ['102', '1', 'Suny', '1.664', '0', '1.664'],
];

function pagina(etiqueta: string): string[][] {
  return [
    ['Oscar Fernando Leiva Sanhueza'],
    ['R.U.T.:', '10.879.175', '-', '6'],
    ['Distribuidora de Confites'],
    ['Factura Electrónica'],
    ['Folio N° 111162'],
    ['www.distribuidoranico.cl', 'S.I.I.:'],
    ['Condiciones :', 'CONTADO', 'Vencimiento :', '08/09/2026', 'Fecha :', '08/09/2026'],
    ['CODIGO', 'CANT.', 'DETALLE', 'P.UNITARIO', 'DSCTO', 'TOTAL'],
    ...LINEAS.map((l) => [...l]),
    ['DOSCIENTOS SETENTA Y TRES MIL NOVENTA Y TRES'],
    ['CANCELADO', 'de', 'de'],
    ['214.300'],
    ['NETO :'],
    ['19 % I.V.A. :', '40.717'],
    ['18.076'],
    ['ILA18'],
    ['TOTAL :', '273.093'],
    [etiqueta],
  ];
}

const PAGINAS: PaginaTexto[] = [pagina('Timbre Electrónico'), pagina('CEDIBLE')];

describe('lector factura Nico — folio 111162', () => {
  it('se reconoce por el RUT partido en celdas + «Factura Electrónica», y gana al lector del pedido web', () => {
    expect(reconoceNicoFactura(PAGINAS)).toBe(true);
    expect(detectarLector(PAGINAS)?.clave).toBe('nico_factura');
  });

  it('lee folio, fecha, 15 líneas (sin la copia CEDIBLE) y los totales del pie aunque el neto venga en otra fila', () => {
    const d = leerNicoFactura(PAGINAS);
    expect(d.numeroDocumento).toBe('111162');
    expect(d.fechaDocumento).toBe('2026-09-08');
    expect(d.tipoDocumento).toBe('factura');
    expect(d.proveedor.rut).toBe('10879175-6');
    expect(d.lineas).toHaveLength(15);
    expect(d.totales).toEqual({ neto: 214300, impuestos: 273093 - 214300, total: 273093 });
  });

  it('las líneas son netas: se les suma el IVA y se reparte el ILA por neto hasta cuadrar el total', () => {
    const d = leerNicoFactura(PAGINAS);
    expect(d.lineas.reduce((a, l) => a + l.neto, 0)).toBe(214300);
    expect(d.lineas.reduce((a, l) => a + l.total, 0)).toBe(273093);
    const latas = d.lineas[0]!;
    expect(latas).toMatchObject({ codigoProveedor: '239', bultos: 162, unidadesPorBulto: 1, neto: 78570 });
    expect(latas.impuestos).toBeGreaterThan(Math.round(78570 * 0.19)); // IVA + parte del ILA
    const protein = d.lineas.find((l) => l.codigoProveedor === '819')!;
    expect(protein).toMatchObject({ bultos: 1, unidadesPorBulto: 5 });
    expect(d.advertencias.some((a) => a.includes('ILA'))).toBe(true);
    expect(d.advertencias.filter((a) => a.includes('se asumió'))).toHaveLength(0);
  });

  it('sin total en el pie, solo aplica IVA y avisa', () => {
    const p = pagina('x').filter((f) => f[0] !== 'TOTAL :');
    const d = leerNicoFactura([p]);
    expect(d.totales).toBeNull();
    expect(d.lineas[0]!.impuestos).toBe(Math.round(78570 * 0.19));
    expect(d.advertencias.some((a) => a.includes('total'))).toBe(true);
  });
});
