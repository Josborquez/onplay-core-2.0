import { describe, expect, it } from 'vitest';
import { leerCoqui, reconoceCoqui } from './coqui.js';
import { detectarLector } from './index.js';
import type { PaginaTexto } from '../pdf.js';

// Celdas reales de la orden 0092856 (docs/pdf/Sales OrderSO 0092856 (1).pdf): pdfjs entrega una palabra por celda.
const p = (s: string) => s.split(' ');
const CABECERA: string[][] = [
  p('Sales Order'),
  p('Order No.: 0092856'),
  p('Order Date: 5/21/2026'),
  p('Coqui Hobby Delivery Date: 5/21/2026'),
  p('Sanford, FL, 32771 Currency: USD'),
  p('NO. ITEM UOM QTY. MSRP NET PRICE EXT PRICE'),
];
const PAGINAS: PaginaTexto[] = [
  [
    ...CABECERA,
    p('1 ATMDSH16050: Dragon Shield Sleeves: Standard- Matte EACH 4 16.99 8.70 34.80'),
    p("'Flesh & Blood Uprising Dromai' Art, Limited Edition (100"),
    p('ct.)'),
    p('6 ATMDSH19002: Dragon Shield Deckbox: 100+ Strongbox- EACH 6 7.99 4.00 24.00'),
    p('Clear Black'),
    p('12 UGD010249: Deck Case: 80+ Standard Size- Black EACH 6 3.49 1.75 10.50'),
    p('Continued... Page: 1 of 2'),
  ],
  [
    ...CABECERA,
    p('34 BANOPTK9564: One Piece TCG: Store Tournament Kit EACH 4 .00 .00 0.00'),
    p('2026 Vol.2'),
    p('37 BAN2846609: *DISPLAY*- One Piece TCG: Starter Deck EACH 2 119.94 67.50 135.00'),
    p('[ST-30] (6ct)'),
    p('NOTE: Products Paid, not founded yet on warehouse Sales Total: 204.30'),
    p('Freight & Misc: 0.00'),
    p('Total (USD): 204.30'),
    p('Page: 2 of 2'),
  ],
];

describe('lector Coqui — Sales Order 0092856', () => {
  it('se reconoce y lo elige el registro', () => {
    expect(reconoceCoqui(PAGINAS)).toBe(true);
    expect(detectarLector(PAGINAS)?.clave).toBe('coqui');
  });

  it('lee número, fecha (m/d/aaaa), moneda, total y las líneas con su descripción continuada', () => {
    const d = leerCoqui(PAGINAS);
    expect(d.numeroDocumento).toBe('0092856');
    expect(d.fechaDocumento).toBe('2026-05-21');
    expect(d.moneda).toBe('USD');
    expect(d.totalOriginal).toBe(204.3);
    expect(d.totales).toBeNull();
    expect(d.tipoDocumento).toBe('otro');
    expect(d.lineas).toHaveLength(5);
    expect(d.lineas[0]).toMatchObject({
      codigoProveedor: 'ATMDSH16050',
      descripcion: "Dragon Shield Sleeves: Standard- Matte 'Flesh & Blood Uprising Dromai' Art, Limited Edition (100 ct.)",
      bultos: 4,
      unidadesPorBulto: 1,
      totalOriginal: 34.8,
      total: 0,
    });
    expect(d.lineas[1]!.descripcion).toBe('Dragon Shield Deckbox: 100+ Strongbox- Clear Black');
    expect(d.lineas[2]!.descripcion).toBe('Deck Case: 80+ Standard Size- Black');
    expect(d.lineas.reduce((a, l) => a + (l.totalOriginal ?? 0), 0)).toBeCloseTo(204.3, 2);
  });

  it('avisa por los kits gratis y por los displays, y no cuenta «(100 ct.)» como unidades por bulto', () => {
    const d = leerCoqui(PAGINAS);
    expect(d.lineas.find((l) => l.codigoProveedor === 'BANOPTK9564')).toMatchObject({ bultos: 4, totalOriginal: 0 });
    expect(d.lineas.every((l) => l.unidadesPorBulto === 1)).toBe(true);
    expect(d.advertencias.some((a) => a.includes('sin costo'))).toBe(true);
    expect(d.advertencias.some((a) => a.includes('display'))).toBe(true);
  });
});
