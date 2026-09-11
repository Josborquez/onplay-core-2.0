import { describe, expect, it } from 'vitest';
import {
  calcularImportacion,
  calcularLinea,
  convertirLineasAClp,
  resumenImportacion,
  cuadrarTotales,
  fechaIsoDesdeCl,
  lectorPorRut,
  margenPorcentaje,
  parsearNumeroCl,
  parsearNumeroUs,
  precioParaMargen,
  unidadesPorBultoDesdeDescripcion,
  type LineaCalculada,
} from './compra.js';

const base = {
  codigoProveedor: '122629',
  descripcion: 'Vital C/G PT600cc x 12 ter',
  bultos: 4,
  unidadesPorBulto: 12,
  sueltas: 0,
  neto: 19624,
  impuestos: 3729,
  total: 23353,
};

describe('parsearNumeroCl', () => {
  it('entiende punto de miles y coma decimal', () => {
    expect(parsearNumeroCl('14.956')).toBe(14956);
    expect(parsearNumeroCl('138.598')).toBe(138598);
    expect(parsearNumeroCl('6,50')).toBe(6.5);
    expect(parsearNumeroCl('0')).toBe(0);
    expect(parsearNumeroCl('487')).toBe(487);
  });
  it('rechaza lo que no es número chileno', () => {
    expect(parsearNumeroCl('4/00')).toBeNull();
    expect(parsearNumeroCl('Vital')).toBeNull();
    expect(parsearNumeroCl('1,234.5')).toBeNull();
  });
});

describe('unidadesPorBultoDesdeDescripcion', () => {
  it('lee «x N» en descripciones reales de Andina', () => {
    expect(unidadesPorBultoDesdeDescripcion('Vital C/G PT600cc x 12 ter')).toBe(12);
    expect(unidadesPorBultoDesdeDescripcion('Monster Energy LT473cc x 6')).toBe(6);
    expect(unidadesPorBultoDesdeDescripcion('Coca Cola Sin Azucar PT2,5 x 6 term')).toBe(6);
  });
  it('acepta las formas de Distribuidora Nico: «x 6 und», «x 6u», «x12u», «x24», «x5»', () => {
    expect(unidadesPorBultoDesdeDescripcion('Lata Bilz x 6 und')).toBe(6);
    expect(unidadesPorBultoDesdeDescripcion('Lata Kem Xtreme x 6u')).toBe(6);
    expect(unidadesPorBultoDesdeDescripcion('Alfajor Premium x12u')).toBe(12);
    expect(unidadesPorBultoDesdeDescripcion('Alfajor Game Blanco x24')).toBe(24);
    expect(unidadesPorBultoDesdeDescripcion('Wild Protein Chocolate-Coco 45g x5')).toBe(5);
    expect(unidadesPorBultoDesdeDescripcion('Lata Pepsi Zero x 6 u')).toBe(6);
  });
  it('entiende «(Display 30ud)» de Devir', () => {
    expect(unidadesPorBultoDesdeDescripcion('MTI The Hobbit Play Booster(Display 30ud)(Inglés)-Cartas')).toBe(30);
    expect(unidadesPorBultoDesdeDescripcion('MTI The Hobbit Collector (Display 12ud)(Inglés)-Cartas')).toBe(12);
    expect(unidadesPorBultoDesdeDescripcion('*DISPLAY*- One Piece TCG: Starter Deck [ST-30] (6ct)')).toBeNull();
  });
  it('devuelve null si no hay «x N»', () => {
    expect(unidadesPorBultoDesdeDescripcion('Display sobres Pokémon')).toBeNull();
    expect(unidadesPorBultoDesdeDescripcion('Xbox')).toBeNull();
    expect(unidadesPorBultoDesdeDescripcion('Kryzpo Original 130 g')).toBeNull();
    expect(unidadesPorBultoDesdeDescripcion('Super 8')).toBeNull();
  });
});

describe('calcularLinea — §6.1', () => {
  it('cantidad = bultos × unidades + sueltas; costo unitario redondeado (Andina: 23.353 / 48 = 487)', () => {
    const r = calcularLinea(base) as LineaCalculada;
    expect(r.cantidad).toBe(48);
    expect(r.costoUnitario).toBe(487);
  });
  it('suma las sueltas', () => {
    const r = calcularLinea({ ...base, bultos: 1, sueltas: 3 }) as LineaCalculada;
    expect(r.cantidad).toBe(15);
  });
  it('rechaza líneas sin unidades o con bulto inválido', () => {
    expect(calcularLinea({ ...base, bultos: 0, sueltas: 0 })).toMatchObject({ codigo: 'CANTIDAD_INVALIDA' });
    expect(calcularLinea({ ...base, unidadesPorBulto: 0 })).toMatchObject({ codigo: 'BULTO_INVALIDO' });
    expect(calcularLinea({ ...base, bultos: -1 })).toMatchObject({ codigo: 'CANTIDAD_INVALIDA' });
    expect(calcularLinea({ ...base, total: -5 })).toMatchObject({ codigo: 'MONTO_INVALIDO' });
  });
});

describe('cuadrarTotales — §6.2', () => {
  const l1 = calcularLinea(base) as LineaCalculada;
  const l2 = calcularLinea({
    ...base,
    codigoProveedor: '122202',
    descripcion: 'Monster Energy LT473cc x 6',
    unidadesPorBulto: 6,
    neto: 23576,
    impuestos: 8505,
    total: 32081,
  }) as LineaCalculada;

  it('sin totales del documento, los totales son la suma', () => {
    const t = cuadrarTotales([l1, l2], null);
    expect(t.total).toBe(23353 + 32081);
    expect(t.neto).toBe(19624 + 23576);
    expect(t.advertencias).toEqual([]);
  });
  it('manda el documento y avisa si no cuadra más allá del redondeo', () => {
    const ok = cuadrarTotales([l1, l2], { neto: 43200, impuestos: 12234, total: 55434 });
    expect(ok.total).toBe(55434);
    expect(ok.advertencias).toEqual([]);
    const mal = cuadrarTotales([l1, l2], { neto: 43200, impuestos: 12234, total: 60000 });
    expect(mal.total).toBe(60000);
    expect(mal.advertencias).toHaveLength(1);
    expect(mal.advertencias[0]).toContain('total');
  });
});

describe('moneda extranjera — §6.6', () => {
  it('parsearNumeroUs entiende el formato de EE. UU.', () => {
    expect(parsearNumeroUs('1,398.90')).toBe(1398.9);
    expect(parsearNumeroUs('34.80')).toBe(34.8);
    expect(parsearNumeroUs('.00')).toBe(0);
    expect(parsearNumeroUs('16.99')).toBe(16.99);
    expect(parsearNumeroUs('EACH')).toBeNull();
    expect(parsearNumeroUs('1.398,90')).toBeNull();
  });
  it('convierte a CLP con el tipo de cambio y reparte los gastos por monto, cuadrando exacto', () => {
    const lineas = [
      { ...base, codigoProveedor: 'A', totalOriginal: 34.8 },
      { ...base, codigoProveedor: 'B', totalOriginal: 0 }, // kit gratis
      { ...base, codigoProveedor: 'C', totalOriginal: 135 },
    ];
    const r = convertirLineasAClp(lineas, 950, 20000);
    expect(r[0]!.total).toBe(Math.round(34.8 * 950) + Math.round((20000 * 34.8) / 169.8));
    expect(r[1]!.total).toBe(0); // sin monto no carga gastos
    expect(r.reduce((a, l) => a + l.total, 0)).toBe(Math.round(34.8 * 950) + Math.round(135 * 950) + 20000);
    expect(r[2]!.neto).toBe(r[2]!.total);
    expect(r[2]!.impuestos).toBe(0);
  });
  it('reparte también el IVA recuperable aparte del costo (§6.7)', () => {
    const lineas = [
      { ...base, codigoProveedor: 'A', totalOriginal: 100 },
      { ...base, codigoProveedor: 'B', totalOriginal: 0 },
      { ...base, codigoProveedor: 'C', totalOriginal: 300 },
    ];
    const r = convertirLineasAClp(lineas, 900, 40000, 76000);
    expect(r[0]).toMatchObject({ neto: 90000 + 10000, impuestos: 19000, total: 119000 });
    expect(r[1]).toMatchObject({ neto: 0, impuestos: 0, total: 0 });
    expect(r[2]).toMatchObject({ neto: 270000 + 30000, impuestos: 57000, total: 357000 });
    expect(r.reduce((a, l) => a + l.impuestos, 0)).toBe(76000);
  });
  it('margen y precio sugerido', () => {
    expect(margenPorcentaje(1500, 708)).toBe(52.8);
    expect(margenPorcentaje(0, 708)).toBeNull();
    expect(margenPorcentaje(600, 708)).toBe(-18);
    expect(precioParaMargen(708, 40)).toBe(1180); // 708 / 0,6 = 1180
    expect(precioParaMargen(487, 50)).toBe(980); // 974 → 980
    expect(precioParaMargen(100, 100)).toBe(0);
  });
});

describe('importación (C12b, docs/13)', () => {
  it('reproduce la DIN 1150127395-5 de Coqui (junio 2026)', () => {
    const imp = calcularImportacion({ fob: 4735.16, flete: 318.8, tipoCambioAduana: 894.79 });
    expect(imp.seguro).toBe(94.7); // presunto 2 %
    expect(imp.seguroPresunto).toBe(true);
    expect(calcularImportacion({ fob: 4735.16, flete: 318.8, seguro: 94.7, tipoCambioAduana: 894.79 }).seguroPresunto).toBe(true); // la DIN lo trae escrito
    expect(imp.cif).toBe(5148.66);
    expect(imp.arancelOriginal).toBe(308.92); // la DIN dice 308,93: suma por ítem, ±1 centavo
    expect(imp.ivaOriginal).toBeCloseTo(1036.94, 1);
    expect(imp.totalGiroOriginal).toBeCloseTo(1345.86, 1);
    expect(Math.abs(imp.totalGiro - 1204262)).toBeLessThanOrEqual(20); // $1.204.262 pagados a Tesorería
    expect(Math.abs(imp.arancel - 276427)).toBeLessThanOrEqual(20);
    expect(Math.abs(imp.ivaImportacion - 927835)).toBeLessThanOrEqual(20);
  });
  it('acepta seguro real y arancel 0 % con certificado de origen', () => {
    const imp = calcularImportacion({ fob: 1000, flete: 100, seguro: 5, arancelPct: 0, tipoCambioAduana: 900 });
    expect(imp).toMatchObject({ seguro: 5, seguroPresunto: false, cif: 1105, arancelPct: 0, arancelOriginal: 0, ivaOriginal: 209.95, arancel: 0, ivaImportacion: 188955 });
  });
  it('resume costo puesto en la tienda, IVA a recuperar y desembolso (docs/13 §5)', () => {
    // Junio 2026: mercancía + flete al dólar aduanero, arancel, agente y UPS netos; IVA aparte.
    const lineas = convertirLineasAClp([{ ...base, totalOriginal: 5053.96 }], 894.79, 276427 + 112294 + 122497, 927835 + 21336 + 23274);
    const r = resumenImportacion(lineas, { tipoCambio: 894.79, fob: 4735.16, flete: 318.8 }, [
      { montoNeto: 112294, iva: 21336 },
      { montoNeto: 122497, iva: 23274 },
    ]);
    expect(r.costoPuesto).toBe(5033451);
    expect(r.ivaRecuperable).toBe(972445);
    expect(r.desembolso).toBe(6005896);
    expect(r.fobClp).toBe(4236974);
    expect(r.sobreFobPct).toBe(18.8);
    expect(r.gastosNetos).toBe(234791);
    expect(r.cuadre).toEqual({ lineas: 5053.96, din: 5053.96, difiere: false });
  });
  it('avisa si las líneas no cuadran con FOB + flete de la DIN', () => {
    const r = resumenImportacion([{ neto: 0, impuestos: 0, total: 0, totalOriginal: 4000 }], { tipoCambio: 900, fob: 4735.16, flete: 318.8 }, []);
    expect(r.cuadre?.difiere).toBe(true);
    expect(resumenImportacion([], { tipoCambio: null, fob: null, flete: null }, []).cuadre).toBeNull();
  });
});

describe('lectorPorRut y fechas', () => {
  it('reconoce a Andina por RUT normalizado', () => {
    expect(lectorPorRut('91144000-8')).toBe('andina');
    expect(lectorPorRut('77862085-5')).toBeNull();
    expect(lectorPorRut(null)).toBeNull();
  });
  it('convierte fechas chilenas a ISO', () => {
    expect(fechaIsoDesdeCl('09-09-2026')).toBe('2026-09-09');
    expect(fechaIsoDesdeCl('01/02/2026')).toBe('2026-02-01');
    expect(fechaIsoDesdeCl('2026-09-09')).toBe('2026-09-09');
    expect(fechaIsoDesdeCl('1/9/2026')).toBe('2026-09-01'); // Asmodee: sin ceros
    expect(fechaIsoDesdeCl('ayer')).toBeNull();
  });
});
