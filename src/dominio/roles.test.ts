import { describe, expect, it } from 'vitest';
import { rolAlcanza } from './roles.js';

describe('rolAlcanza', () => {
  it('un rol se alcanza a sí mismo', () => {
    expect(rolAlcanza('vendedor', 'vendedor')).toBe(true);
    expect(rolAlcanza('encargado', 'encargado')).toBe(true);
    expect(rolAlcanza('admin', 'admin')).toBe(true);
  });

  it('el superior alcanza al inferior', () => {
    expect(rolAlcanza('encargado', 'vendedor')).toBe(true);
    expect(rolAlcanza('admin', 'vendedor')).toBe(true);
    expect(rolAlcanza('admin', 'encargado')).toBe(true);
  });

  it('el inferior NO alcanza al superior', () => {
    expect(rolAlcanza('vendedor', 'encargado')).toBe(false);
    expect(rolAlcanza('vendedor', 'admin')).toBe(false);
    expect(rolAlcanza('encargado', 'admin')).toBe(false);
  });
});
