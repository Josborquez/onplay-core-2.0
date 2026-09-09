import { describe, expect, it } from 'vitest';
import { calcularSaldo, validarMovimientoManual, validarPagoMonedero } from './monedero.js';

describe('calcularSaldo', () => {
  it('es la suma con signo del libro', () => {
    expect(calcularSaldo([])).toBe(0);
    expect(calcularSaldo([{ monto: 10000 }, { monto: -3000 }, { monto: 500 }])).toBe(7500);
  });
});

describe('validarPagoMonedero — §6.2', () => {
  it('sin crédito: cabe si monto <= saldo', () => {
    expect(
      validarPagoMonedero({ monto: 5000, saldo: 5000, permiteCredito: false, limiteCredito: 0 }),
    ).toBeNull();
  });

  it('sin crédito: SALDO_INSUFICIENTE con { saldo, solicitado, falta }', () => {
    expect(
      validarPagoMonedero({ monto: 11000, saldo: 3000, permiteCredito: false, limiteCredito: 0 }),
    ).toEqual({ codigo: 'SALDO_INSUFICIENTE', saldo: 3000, solicitado: 11000, falta: 8000 });
  });

  it('sin crédito ignora limiteCredito aunque esté seteado', () => {
    expect(
      validarPagoMonedero({ monto: 1000, saldo: 0, permiteCredito: false, limiteCredito: 50000 }),
    ).toMatchObject({ codigo: 'SALDO_INSUFICIENTE' });
  });

  it('con crédito: cabe hasta saldo + limiteCredito, incluso con saldo negativo', () => {
    expect(
      validarPagoMonedero({ monto: 8000, saldo: 3000, permiteCredito: true, limiteCredito: 5000 }),
    ).toBeNull();
    expect(
      validarPagoMonedero({ monto: 3000, saldo: -1000, permiteCredito: true, limiteCredito: 5000 }),
    ).toBeNull();
  });

  it('con crédito: LIMITE_CREDITO_EXCEDIDO al pasar el tope', () => {
    expect(
      validarPagoMonedero({ monto: 9000, saldo: 3000, permiteCredito: true, limiteCredito: 5000 }),
    ).toEqual({ codigo: 'LIMITE_CREDITO_EXCEDIDO', saldo: 3000, solicitado: 9000, falta: 1000 });
  });
});

describe('validarMovimientoManual — §7.2', () => {
  it('rechaza consumo y devolucion: los genera el sistema, no una persona', () => {
    expect(validarMovimientoManual({ motivo: 'consumo', monto: -1000 })).toEqual({
      codigo: 'MOTIVO_NO_MANUAL',
    });
    expect(validarMovimientoManual({ motivo: 'devolucion', monto: 1000 })).toEqual({
      codigo: 'MOTIVO_NO_MANUAL',
    });
  });

  it('rechaza monto cero o no entero', () => {
    expect(validarMovimientoManual({ motivo: 'carga', monto: 0 })).toEqual({
      codigo: 'MONTO_INVALIDO',
    });
    expect(validarMovimientoManual({ motivo: 'carga', monto: 100.5 })).toEqual({
      codigo: 'MONTO_INVALIDO',
    });
  });

  it('carga y premio_evento deben ser positivos', () => {
    expect(validarMovimientoManual({ motivo: 'carga', monto: -100 })).toEqual({
      codigo: 'SIGNO_INVALIDO',
      esperado: 'positivo',
    });
    expect(validarMovimientoManual({ motivo: 'premio_evento', monto: 5000 })).toBeNull();
  });

  it('reverso_carga debe ser negativo y con nota', () => {
    expect(validarMovimientoManual({ motivo: 'reverso_carga', monto: 100, nota: 'x' })).toEqual({
      codigo: 'SIGNO_INVALIDO',
      esperado: 'negativo',
    });
    expect(validarMovimientoManual({ motivo: 'reverso_carga', monto: -100, nota: 'error de caja' })).toBeNull();
    expect(validarMovimientoManual({ motivo: 'reverso_carga', monto: -100 })).toEqual({
      codigo: 'NOTA_REQUERIDA',
    });
  });

  it('ajuste admite ambos signos pero exige nota', () => {
    expect(validarMovimientoManual({ motivo: 'ajuste', monto: -500, nota: 'folio V-2026-00001' })).toBeNull();
    expect(validarMovimientoManual({ motivo: 'ajuste', monto: 500, nota: '  ' })).toEqual({
      codigo: 'NOTA_REQUERIDA',
    });
  });
});
