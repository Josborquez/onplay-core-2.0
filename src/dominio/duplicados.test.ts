import { describe, expect, it } from 'vitest';
import { normalizarNombre, preciosSimilares } from './duplicados.js';

describe('normalizarNombre (§6.6)', () => {
  it('minúsculas, sin tildes, sin puntuación, espacios colapsados', () => {
    expect(normalizarNombre('Sobre  OP-11: ¡Edición Limitada!')).toBe('sobre op 11 edicion limitada');
    expect(normalizarNombre('Pokémon TCG')).toBe('pokemon tcg');
  });
});

describe('preciosSimilares (§6.6, ±10%)', () => {
  it('dentro de la tolerancia', () => {
    expect(preciosSimilares(10000, 10000)).toBe(true);
    expect(preciosSimilares(10000, 10900)).toBe(true);
    expect(preciosSimilares(10900, 10000)).toBe(true);
  });

  it('fuera de la tolerancia', () => {
    expect(preciosSimilares(10000, 11200)).toBe(false);
    expect(preciosSimilares(10000, 500)).toBe(false);
  });
});
