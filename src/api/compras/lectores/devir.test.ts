import { describe, expect, it } from 'vitest';
import { leerDevir, reconoceDevir } from './devir.js';
import { detectarLector } from './index.js';
import type { PaginaTexto } from '../pdf.js';

// Celdas reales de la factura 107327 (docs/pdf/Onplay 107327.pdf), tal como las entrega extraerPaginasPdf.
const PAGINAS: PaginaTexto[] = [
  [
    ['DEVIR CHILE LIMITADA', 'R.U.T. 76.632.420-7'],
    ['Importación y Exportación de Articulos De Juegos', 'FACTURA ELECTRONICA'],
    ['N° 107327'],
    ['SEÑOR(ES):', 'COMERCIALIZADORA Y DISTRIBUIDORA BM LIMITADA', 'SANTIAGO,', '04/08/2026'],
    ['DIRECCION:', 'MERCED 832 LOCAL 53', 'R.U.T.:', '77.862.085-5'],
    ['VENCIMIENTO:', '04/08/2026'],
    ['CANTIDAD', 'DETALLE', 'VALOR UNIT.', 'TOTAL'],
    ['9', 'MTI The Hobbit Play Booster(Display 30ud)(Inglés)-Cartas', '139,122', '1,252,098'],
    ['3', 'MTG The Hobbit Sobres de Juego(Display 30ud)(Español)-Cartas', '139,122', '417,366'],
    ['1', 'MTI The Hobbit Collector (Display 12ud)(Inglés)-Cartas', '327,666', '327,666'],
    ['1', 'DSP Despacho', '7,000', '7,000'],
    ['NETO', '2,004,130'],
    ['EXENTO'],
    ['IVA (19%)', '380,785'],
    ['TOTAL', '2,384,915'],
    ['Timbre Electrónico SII', 'SON: DOS MILLONES TRESCIENTOS OCHENTA Y CUATRO MIL NOVECIENTOS'],
  ],
];

describe('lector Devir — factura 107327', () => {
  it('se reconoce por nombre o RUT y lo elige el registro', () => {
    expect(reconoceDevir(PAGINAS)).toBe(true);
    expect(detectarLector(PAGINAS)?.clave).toBe('devir');
  });

  it('lee número, fecha, 3 productos (el despacho no es producto) y los totales con coma de miles', () => {
    const d = leerDevir(PAGINAS);
    expect(d.numeroDocumento).toBe('107327');
    expect(d.fechaDocumento).toBe('2026-08-04');
    expect(d.tipoDocumento).toBe('factura');
    expect(d.proveedor.rut).toBe('76632420-7');
    expect(d.lineas).toHaveLength(3);
    expect(d.totales).toEqual({ neto: 2004130, impuestos: 380785, total: 2384915 });
    expect(d.advertencias.some((a) => a.includes('Despacho') && a.includes('flete'))).toBe(true);
  });

  it('reparte flete e IVA por neto: Σ total de líneas = total del documento; display 30ud → 30 por bulto', () => {
    const d = leerDevir(PAGINAS);
    expect(d.lineas.reduce((a, l) => a + l.total, 0)).toBe(2384915);
    expect(d.lineas.reduce((a, l) => a + l.neto, 0)).toBe(2004130); // productos + flete repartido
    const play = d.lineas[0]!;
    expect(play).toMatchObject({ bultos: 9, unidadesPorBulto: 30, codigoProveedor: 'MTI The Hobbit Play Booster(Display 30ud)(Inglés)-Cartas' });
    expect(play.neto).toBeGreaterThan(1252098); // lleva parte del flete
    expect(d.lineas[2]!.unidadesPorBulto).toBe(12);
    expect(d.advertencias.filter((a) => a.includes('se asumió'))).toHaveLength(0);
  });
});
