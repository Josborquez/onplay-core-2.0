import { describe, expect, it } from 'vitest';
import { codigoBarrasDesdeSku, nombreDeVariacion, textoDeVariante } from './variaciones.js';

const PADRE = 'Katana Sleeves Standard Size (100)';

describe('nombreDeVariacion (R-001: no repetir el nombre del padre)', () => {
  it('opción que repite el padre como prefijo → padre — resto', () => {
    expect(nombreDeVariacion(PADRE, [`${PADRE} - Red`])).toBe(`${PADRE} — Red`);
    expect(nombreDeVariacion(PADRE, [`${PADRE} – Autumn Moon`])).toBe(`${PADRE} — Autumn Moon`);
    expect(nombreDeVariacion(PADRE, [`${PADRE}: Blue`])).toBe(`${PADRE} — Blue`);
  });

  it('ignora mayúsculas y espacios dobles al comparar el prefijo', () => {
    expect(nombreDeVariacion(PADRE, ['katana  sleeves standard size (100) - Green'])).toBe(
      `${PADRE} — Green`,
    );
  });

  it('opción que contiene el padre entero (nombre completo) → la opción sola', () => {
    const op = 'Protectores Ultimate Guard: Katana Sleeves Standard Size (100) Black';
    expect(nombreDeVariacion(PADRE, [op])).toBe(op);
  });

  it('comillas tipográficas vs rectas en el prefijo (caso «Guild Summit»)', () => {
    const padre = 'Ultimate Guard Boulder 100+ Magic: The Gathering "Guild Summit"';
    const op = 'Ultimate Guard Boulder 100+ Magic: The Gathering «Guild Summit» – Simic';
    expect(nombreDeVariacion(padre, [op])).toBe(`${padre} — Simic`);
  });

  it('opción larga que comparte la mitad de las palabras del padre → la opción sola (caso Cortex)', () => {
    const padre = 'Protectores Ultimate Guard: Cortex Sleeves Matte Standard Size (100pzs)';
    const op = 'Cortex Sleeves Matte Standard Size (100) - Transparent';
    expect(nombreDeVariacion(padre, [op])).toBe(op);
    const op2 = 'Protectores Ultimate Guard: Katana Sleeves Standard Size Black';
    expect(nombreDeVariacion(PADRE, [op2])).toBe(op2);
  });

  it('opción larga pero de otro producto no se confunde con nombre completo', () => {
    expect(nombreDeVariacion('Dados D20', ['Edición coleccionista con estuche de madera'])).toBe(
      'Dados D20 — Edición coleccionista con estuche de madera',
    );
  });

  it('opción corta normal → padre — opción (comportamiento original)', () => {
    expect(nombreDeVariacion('Dados D20', ['Rojo'])).toBe('Dados D20 — Rojo');
  });

  it('varias opciones se unen con " / " (comportamiento original)', () => {
    expect(nombreDeVariacion('Polera OnPlay', ['Negra', 'M'])).toBe('Polera OnPlay — Negra / M');
    expect(nombreDeVariacion(PADRE, [`${PADRE} - Red`, '100 unidades'])).toBe(
      `${PADRE} — Red / 100 unidades`,
    );
  });

  it('sin opciones → nombre del padre', () => {
    expect(nombreDeVariacion(PADRE, [])).toBe(PADRE);
    expect(nombreDeVariacion(PADRE, ['', '  '])).toBe(PADRE);
  });

  it('opción idéntica al padre → nombre del padre (no queda "padre — padre")', () => {
    expect(nombreDeVariacion(PADRE, [PADRE])).toBe(PADRE);
  });
});

describe('textoDeVariante', () => {
  it('devuelve solo el resto tras el padre', () => {
    expect(textoDeVariante(PADRE, `${PADRE} - Red`)).toBe('Red');
  });
  it('devuelve la opción tal cual si no repite el padre', () => {
    expect(textoDeVariante(PADRE, 'Rojo')).toBe('Rojo');
  });
});

describe('codigoBarrasDesdeSku (R-002: el SKU de la variación es el EAN)', () => {
  it('acepta EAN-13, EAN-8, UPC-A y GTIN-14', () => {
    expect(codigoBarrasDesdeSku('4260250073780')).toBe('4260250073780');
    expect(codigoBarrasDesdeSku('12345678')).toBe('12345678');
    expect(codigoBarrasDesdeSku('012345678905')).toBe('012345678905');
    expect(codigoBarrasDesdeSku('10123456789012')).toBe('10123456789012');
    expect(codigoBarrasDesdeSku(' 4260250073780 ')).toBe('4260250073780');
  });

  it('rechaza SKUs que no son códigos de barras', () => {
    expect(codigoBarrasDesdeSku('OP11-001-NM-EN')).toBeNull();
    expect(codigoBarrasDesdeSku('2897-V2898')).toBeNull();
    expect(codigoBarrasDesdeSku('1234')).toBeNull(); // muy corto
    expect(codigoBarrasDesdeSku('123456789')).toBeNull(); // 9 dígitos no es ningún formato
    expect(codigoBarrasDesdeSku('')).toBeNull();
    expect(codigoBarrasDesdeSku(null)).toBeNull();
    expect(codigoBarrasDesdeSku(undefined)).toBeNull();
  });
});
