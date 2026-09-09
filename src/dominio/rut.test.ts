import { describe, expect, it } from 'vitest';
import { calcularDvRut, normalizarRut } from './rut.js';

describe('calcularDvRut', () => {
  it('calcula dígitos conocidos', () => {
    expect(calcularDvRut('12345678')).toBe('5');
    expect(calcularDvRut('11111111')).toBe('1');
    expect(calcularDvRut('20347878')).toBe('K'); // resto 10 → K
    expect(calcularDvRut('14')).toBe('0'); // suma 11, resto 11 → 0
  });
});

describe('normalizarRut', () => {
  it('normaliza a "12345678-5" sin puntos, con guion', () => {
    expect(normalizarRut('12.345.678-5')).toBe('12345678-5');
    expect(normalizarRut('12345678-5')).toBe('12345678-5');
    expect(normalizarRut('123456785')).toBe('12345678-5');
  });

  it('sube el dígito K a mayúscula', () => {
    expect(normalizarRut('20.347.878-k')).toBe('20347878-K');
  });

  it('quita ceros a la izquierda del cuerpo', () => {
    expect(normalizarRut('07654321-6')).toBe(normalizarRut('7654321-6'));
  });

  it('rechaza dígito verificador incorrecto', () => {
    expect(normalizarRut('12.345.678-9')).toBeNull();
    expect(normalizarRut('11111111-2')).toBeNull();
  });

  it('rechaza basura', () => {
    expect(normalizarRut('')).toBeNull();
    expect(normalizarRut('abc')).toBeNull();
    expect(normalizarRut('123-4')).toBeNull(); // cuerpo demasiado corto
  });
});
