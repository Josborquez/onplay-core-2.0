import { describe, expect, it } from 'vitest';
import type { CategoriaWoo } from '@onplay/woo-client';
import { mapearOnplay, mapearOnplaygames } from './mapeo.js';

const cat = (id: number, slug: string) => ({ id, name: slug, slug });

describe('mapearOnplay (§6.3: siempre single)', () => {
  const arbol = new Map<number, CategoriaWoo>([
    [1, { id: 1, name: 'One Piece TCG', slug: 'one-piece-tcg', parent: 0 }],
    [2, { id: 2, name: 'OP-11', slug: 'op-11', parent: 1 }],
    [3, { id: 3, name: 'Leaders', slug: 'leaders-op-11', parent: 2 }],
  ]);

  it('termina en -magic-the-gathering → Cartas Magic', () => {
    const r = mapearOnplay([cat(9, 'mom-magic-the-gathering')], arbol);
    expect(r).toEqual({ categoriaSlug: 'cartas-magic', tipo: 'single', juego: 'magic', activo: true });
  });

  it('desciende de one-piece-tcg (nieto) → Cartas One Piece', () => {
    const r = mapearOnplay([cat(3, 'leaders-op-11')], arbol);
    expect(r).toEqual({
      categoriaSlug: 'cartas-one-piece',
      tipo: 'single',
      juego: 'one_piece',
      activo: true,
    });
  });

  it('sin coincidencia → Sin clasificar, pero tipo single', () => {
    const r = mapearOnplay([cat(99, 'uncategorized')], arbol);
    expect(r.categoriaSlug).toBe('sin-clasificar');
    expect(r.tipo).toBe('single');
  });
});

describe('mapearOnplaygames (§6.3: tabla explícita, gana la primera)', () => {
  it('slugs de Magic → Sellado/magic', () => {
    expect(mapearOnplaygames([cat(1, 'duskmourn')]).juego).toBe('magic');
    expect(mapearOnplaygames([cat(2, 'mtg-final-fantasy')]).tipo).toBe('sellado');
  });

  it('one-piece-tcg en onplaygames es SELLADO, no single', () => {
    const r = mapearOnplaygames([cat(3, 'one-piece-tcg')]);
    expect(r.tipo).toBe('sellado');
    expect(r.juego).toBe('one_piece');
  });

  it('accesorios: sleeves → Accesorios/accesorio', () => {
    const r = mapearOnplaygames([cat(4, 'sleeves')]);
    expect(r).toEqual({ categoriaSlug: 'accesorios', tipo: 'accesorio', juego: null, activo: true });
  });

  it('eventos entran INACTIVOS (E5 los tomará)', () => {
    const r = mapearOnplaygames([cat(5, 'eventos-tcg')]);
    expect(r.tipo).toBe('evento');
    expect(r.activo).toBe(false);
  });

  it('juego-de-cartas se ignora si hay otra categoría', () => {
    const r = mapearOnplaygames([cat(6, 'juego-de-cartas'), cat(7, 'pokemon')]);
    expect(r.juego).toBe('pokemon');
  });

  it('juego-de-cartas como única categoría → Sellado', () => {
    const r = mapearOnplaygames([cat(6, 'juego-de-cartas')]);
    expect(r).toEqual({ categoriaSlug: 'sellado', tipo: 'sellado', juego: null, activo: true });
  });

  it('sin coincidencia → Sin clasificar/indeterminado', () => {
    const r = mapearOnplaygames([cat(8, 'algo-raro')]);
    expect(r.categoriaSlug).toBe('sin-clasificar');
    expect(r.tipo).toBe('indeterminado');
  });
});
