import { describe, expect, it } from 'vitest';
import { leerAsmodee, reconoceAsmodee } from './asmodee.js';
import { detectarLector } from './index.js';
import type { PaginaTexto } from '../pdf.js';

// Celdas reales de la factura N° 48041 (docs/pdf/Factura de venta_39045.pdf), tal como las entrega extraerPaginasPdf.
const LINEAS: string[][] = [
  ['GGS10153ML', 'GG Matte Prime Sleeves Purple 66x91', 'UND', '6', '$4.700', '$28.200'],
  ['GGS10172ML', 'GG Soft Sleeves 67x94', 'UND', '10', '$935', '$9.350'],
  ['GGS25015ML', 'GG Essential Line Fourtress 320+ - Blue', 'UND', '3', '$5.876', '$17.628'],
  ['GGS25079ML', 'GG Essential Line Side Holder 100+ XL Black', 'UND', '4', '$2.053', '$8.212'],
  ['LOG01', 'Envío y Embalaje', 'UND', '1', '$15.000', '$15.000'],
];
const NETO = 28200 + 9350 + 17628 + 8212 + 15000; // 78.390
const IVA = Math.round(NETO * 0.19); // 14.894
const TOTAL = NETO + IVA;

function pagina(): string[][] {
  return [
    ['Importadora y Comercializadora Skyship SPA'],
    ['VENTA AL POR MAYOR DE OTROS PRODUCTOS N.C.P - OTROS TIPOS DE VENTA', 'R.U.T.', '76353094-9'],
    ['Región Metropolitana', 'FACTURA ELECTRÓNICA'],
    ['Chile', 'N°', '48041'],
    ['Mail:', 'info.cl@asmodee.com'],
    ['SEÑOR (ES)', ': COMERCIALIZADORA Y DISTRIBUIDORA BM LIMI', 'FECHA EMISIÓN', ': 1/9/2026'],
    ['Orden de Venta', '52052', '26/8/2026', 'Comuna', ': Santiago Ciudad: Santiago'],
    ['CÓDIGO', 'DESCRIPCIÓN', 'UNID', 'CANTIDAD', 'UNITARIO', 'TOTAL'],
    ...LINEAS.map((l) => [...l]),
    ['Son: $' + TOTAL.toLocaleString('es-CL')],
    ['FECHA:___________________FIRMA:___________________________', 'MONTO NETO:', `$${NETO.toLocaleString('es-CL')}`],
    ['lo dispuesto en la letra b) del Art. 4º y la letra c) del Art. 5º', 'MONTO IVA 19%:', `$${IVA.toLocaleString('es-CL')}`],
    ['o servicio(s) prestado(s) ha(n) sido recibidos(s)', 'MONTO EXENTO:', '$0'],
    ['Timbre Electronico S.I.I.', 'MONTO TOTAL:', `$${TOTAL.toLocaleString('es-CL')}`],
  ];
}

const PAGINAS: PaginaTexto[] = [pagina(), pagina()];

describe('lector Asmodee — factura 48041', () => {
  it('se reconoce por RUT o nombre y lo elige el registro', () => {
    expect(reconoceAsmodee(PAGINAS)).toBe(true);
    expect(detectarLector(PAGINAS)?.clave).toBe('asmodee');
  });

  it('lee número, fecha d/m/aaaa sin ceros, 4 productos (el envío no es producto) y los totales; descarta la copia', () => {
    const d = leerAsmodee(PAGINAS);
    expect(d.numeroDocumento).toBe('48041');
    expect(d.fechaDocumento).toBe('2026-09-01');
    expect(d.tipoDocumento).toBe('factura');
    expect(d.proveedor.rut).toBe('76353094-9');
    expect(d.lineas).toHaveLength(4);
    expect(d.totales).toEqual({ neto: NETO, impuestos: TOTAL - NETO, total: TOTAL });
    expect(d.advertencias.some((a) => a.includes('Envío y Embalaje') && a.includes('flete'))).toBe(true);
  });

  it('las líneas son netas con código: reparte flete e IVA por neto, Σ total = total del documento, 1 unidad por bulto', () => {
    const d = leerAsmodee(PAGINAS);
    expect(d.lineas.reduce((a, l) => a + l.total, 0)).toBe(TOTAL);
    expect(d.lineas.reduce((a, l) => a + l.neto, 0)).toBe(NETO);
    const purple = d.lineas[0]!;
    expect(purple).toMatchObject({ codigoProveedor: 'GGS10153ML', bultos: 6, unidadesPorBulto: 1, sueltas: 0 });
    expect(purple.neto).toBeGreaterThan(28200); // lleva parte del flete
    expect(d.lineas.every((l) => l.unidadesPorBulto === 1)).toBe(true);
  });
});
