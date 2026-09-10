import { describe, expect, it } from 'vitest';
import { leerAndina, reconoceAndina } from './andina.js';
import { detectarLector } from './index.js';
import type { PaginaTexto } from '../pdf.js';

// Celdas reales de la factura 097397951 (docs/pdf), tal como las entrega extraerPaginasPdf.
const LINEAS: string[][] = [
  ['122629', 'Vital C/G PT600cc x 12 ter', '4/00', '3.739', '14.956', '6,50', '972', '5.640', '19.624', '0', '23.353', '487'],
  ['122729', 'Vital S/G PT600cc x 12 term', '3/00', '3.739', '11.217', '6,50', '729', '4.230', '14.718', '0', '17.514', '487'],
  ['122202', 'Monster Energy LT473cc x 6', '4/00', '7.776', '31.104', '28,10', '8.740', '1.212', '23.576', '4.026', '32.081', '1.337'],
  ['122217', 'Monster Mango Loco LT473cc x 6', '4/00', '8.258', '33.032', '28,10', '9.282', '1.212', '24.962', '2.375', '32.080', '1.337'],
  ['120710', 'Inca Kola LT350cc x 6', '2/00', '3.655', '7.310', '20,93', '1.530', '476', '6.256', '1.040', '8.485', '707'],
  ['120472', 'Coca Cola Sin Azucar PT2,5 x 6 term', '1/00', '11.974', '11.974', '19,00', '2.275', '1.496', '11.195', '970', '14.292', '2.382'],
  ['120475', 'Coca Cola Sin Azucar LT350cc x 6', '8/00', '3.885', '31.080', '20,93', '6.505', '1.904', '26.479', '2.457', '33.967', '708'],
  ['122233', 'Monster NJ Ripper LT473cc x 6', '2/00', '7.776', '15.552', '28,10', '4.370', '606', '11.788', '2.013', '16.041', '1.337'],
];

function pagina(etiqueta: string): string[][] {
  return [
    ['Embotelladora Andina S.A.'],
    ['R.U.T.: 91.144.000-8'],
    ['PUBLICIDAD', 'FACTURA ELECTRONICA'],
    ['MIRAFLORES 9153 - CASILLA 488 - 3 - COMUNA RENCA - SANTIAGO', 'N° 097397951'],
    ['LUGAR EMISION: Planta Renca, FECHA: 09-09-2026'],
    ['NOMBRE', ':', 'COMERCIALIZADORA Y DISTRIBUIDORA BM', 'DESPACHAR A', ':', 'COMERCIALIZADORA Y DISTRIBUIDORA BM'],
    ['R.U.T.', ':', '77.862.085-5', 'DIRECC. DESPACHO', ':', 'merced 832, local 54'],
    ['TASA', 'MONTO', 'IMPTO', 'BRUTO x'],
    ['COD', 'DESCRIPCION', 'CAJ / BOT', 'P. UNIT.', 'SUB TOTAL', 'FLETE', 'NETO', 'TOTAL'],
    ['DESCTO%', 'DESCTO', 'ESPECIF.', 'BOT.'],
    ...LINEAS.map((l) => [...l]),
    ['NETO', 'MONTO EXENTO', 'DEP. ENVASES', 'IVA 19%', 'IABA 10%', 'IABA 18%', 'ILA 20,5%', 'ILA 31,5%', 'TOTAL'],
    ['138.598', '0', '0', '26.334', '5.802', '7.079', '177.813'],
    ['Doc.Sap: 4029948517 OC Envases: 7036622'],
    ['Total Cajas: 28 Usuario SAP : PRPEREZ'],
    [etiqueta],
  ];
}

const PAGINAS: PaginaTexto[] = [pagina('CLIENTE'), pagina('CEDIBLE')];

describe('lector Andina — factura 097397951', () => {
  it('se reconoce por RUT y lo elige el registro', () => {
    expect(reconoceAndina(PAGINAS)).toBe(true);
    expect(detectarLector(PAGINAS)?.clave).toBe('andina');
    expect(detectarLector([[['Otra empresa'], ['R.U.T.: 77.862.085-5']]])).toBeNull();
  });

  it('lee cabecera, 8 líneas (sin repetir la copia CEDIBLE) y totales', () => {
    const d = leerAndina(PAGINAS);
    expect(d.numeroDocumento).toBe('097397951');
    expect(d.fechaDocumento).toBe('2026-09-09');
    expect(d.tipoDocumento).toBe('factura');
    expect(d.proveedor.rut).toBe('91144000-8');
    expect(d.lineas).toHaveLength(8);
    expect(d.totales).toEqual({ neto: 138598, impuestos: 177813 - 138598, total: 177813 });
    expect(d.advertencias).toEqual([]);
  });

  it('cada línea trae cajas, unidades por caja y montos con impuestos', () => {
    const d = leerAndina(PAGINAS);
    const vital = d.lineas[0]!;
    expect(vital).toMatchObject({
      codigoProveedor: '122629',
      bultos: 4,
      sueltas: 0,
      unidadesPorBulto: 12,
      neto: 19624,
      total: 23353,
      impuestos: 23353 - 19624,
    });
    const monster = d.lineas[2]!;
    expect(monster).toMatchObject({ codigoProveedor: '122202', bultos: 4, unidadesPorBulto: 6, neto: 23576, total: 32081 });
    // Σ neto de las líneas = neto del documento; Σ total = total del documento.
    expect(d.lineas.reduce((a, l) => a + l.neto, 0)).toBe(138598);
    expect(d.lineas.reduce((a, l) => a + l.total, 0)).toBe(177813);
  });

  it('avisa cuando la descripción no dice cuántas unidades trae la caja', () => {
    const p = pagina('CLIENTE');
    p.splice(10, 0, ['999999', 'Producto raro', '2/03', '1.000', '2.000', '0,00', '0', '0', '2.000', '0', '2.380', '1']);
    const d = leerAndina([p]);
    const raro = d.lineas.find((l) => l.codigoProveedor === '999999')!;
    expect(raro).toMatchObject({ bultos: 2, sueltas: 3, unidadesPorBulto: 1 });
    expect(d.advertencias.some((a) => a.includes('Producto raro'))).toBe(true);
  });

  it('una segunda página con líneas distintas se suma (factura larga)', () => {
    const p2 = pagina('CLIENTE');
    p2.splice(10, 8, ['123456', 'Sprite LT350cc x 6', '1/00', '3.000', '3.000', '0,00', '0', '0', '3.000', '0', '3.570', '595']);
    const d = leerAndina([pagina('CLIENTE'), p2]);
    expect(d.lineas).toHaveLength(9);
  });
});
