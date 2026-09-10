import { describe, expect, it } from 'vitest';
import {
  calcularLinea,
  cuadrarTotales,
  fechaIsoDesdeCl,
  lectorPorRut,
  parsearNumeroCl,
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
    expect(fechaIsoDesdeCl('ayer')).toBeNull();
  });
});
