import { describe, expect, it } from 'vitest';
import {
  aplicarMovimiento,
  avisoWeb,
  cerrarRecuento,
  estadoStock,
  firmarCantidadManual,
  validarMovimientoStock,
} from './stock.js';

describe('validarMovimientoStock — §6.1 / M3', () => {
  it('acepta venta negativa sin nota', () => {
    expect(validarMovimientoStock({ cantidad: -2, motivo: 'venta' })).toBeNull();
  });

  it('rechaza cantidad 0 y no entera', () => {
    expect(validarMovimientoStock({ cantidad: 0, motivo: 'ajuste', nota: 'x' })).toMatchObject({
      codigo: 'CANTIDAD_INVALIDA',
    });
    expect(validarMovimientoStock({ cantidad: 1.5, motivo: 'compra', nota: 'x' })).toMatchObject({
      codigo: 'CANTIDAD_INVALIDA',
    });
  });

  it('exige nota en ajuste, merma, compra y traslado', () => {
    for (const motivo of ['ajuste', 'merma', 'compra', 'traslado'] as const) {
      const cantidad = motivo === 'merma' ? -1 : 1;
      expect(validarMovimientoStock({ cantidad, motivo })).toMatchObject({ codigo: 'NOTA_REQUERIDA' });
      expect(validarMovimientoStock({ cantidad, motivo, nota: '   ' })).toMatchObject({ codigo: 'NOTA_REQUERIDA' });
      expect(validarMovimientoStock({ cantidad, motivo, nota: 'ok' })).toBeNull();
    }
  });

  it('merma siempre resta, compra siempre suma', () => {
    expect(validarMovimientoStock({ cantidad: 3, motivo: 'merma', nota: 'roto' })).toMatchObject({ codigo: 'SIGNO_INVALIDO' });
    expect(validarMovimientoStock({ cantidad: -3, motivo: 'compra', nota: 'llegó' })).toMatchObject({ codigo: 'SIGNO_INVALIDO' });
  });
});

describe('firmarCantidadManual — §6.5', () => {
  it('firma según motivo', () => {
    expect(firmarCantidadManual('merma', 4)).toEqual({ cantidad: -4 });
    expect(firmarCantidadManual('merma', -4)).toEqual({ cantidad: -4 });
    expect(firmarCantidadManual('compra', 4)).toEqual({ cantidad: 4 });
    expect(firmarCantidadManual('ajuste', -2)).toEqual({ cantidad: -2 });
    expect(firmarCantidadManual('ajuste', 2)).toEqual({ cantidad: 2 });
  });

  it('rechaza motivos que genera el sistema', () => {
    for (const motivo of ['venta', 'venta_online', 'devolucion', 'recuento_inicial', 'traslado'] as const) {
      expect(firmarCantidadManual(motivo, 1)).toMatchObject({ codigo: 'MOTIVO_NO_MANUAL' });
    }
  });
});

describe('aplicarMovimiento', () => {
  it('suma con signo y detecta negativo (M2)', () => {
    expect(aplicarMovimiento(1, -1)).toEqual({ cantidadAnterior: 1, cantidadNueva: 0, quedaNegativo: false });
    expect(aplicarMovimiento(0, -1)).toEqual({ cantidadAnterior: 0, cantidadNueva: -1, quedaNegativo: true });
    expect(aplicarMovimiento(-1, 5)).toEqual({ cantidadAnterior: -1, cantidadNueva: 4, quedaNegativo: false });
  });
});

describe('estadoStock — §6.2', () => {
  it('sin_control cuando no controla, aunque haya cantidades', () => {
    expect(estadoStock({ controlaStock: false, stockMinimo: 0, porUbicacion: [0] })).toBe('sin_control');
  });

  it('negativo gana a todo', () => {
    expect(estadoStock({ controlaStock: true, stockMinimo: 5, porUbicacion: [-1, 10] })).toBe('negativo');
  });

  it('quiebre, bajo y ok', () => {
    expect(estadoStock({ controlaStock: true, stockMinimo: 0, porUbicacion: [0, 0] })).toBe('quiebre');
    expect(estadoStock({ controlaStock: true, stockMinimo: 3, porUbicacion: [1, 2] })).toBe('bajo');
    expect(estadoStock({ controlaStock: true, stockMinimo: 3, porUbicacion: [2, 2] })).toBe('ok');
    expect(estadoStock({ controlaStock: true, stockMinimo: 0, porUbicacion: [1] })).toBe('ok'); // mínimo 0 = sin alerta de bajo
  });
});

describe('avisoWeb — §6.9 prioridad entre canales', () => {
  const canalCon = (stockCanal: number | null, maneja: boolean | null = true) => ({ manejaStockCanal: maneja, stockCanal });

  it('reservado: el canal marca 0 (pedido pagado) y hay stock propio', () => {
    expect(avisoWeb({ controlaStock: true, stockPropioVenta: 1, canales: [canalCon(0)] })).toBe('reservado');
    expect(avisoWeb({ controlaStock: true, stockPropioVenta: 3, canales: [canalCon(-2)] })).toBe('reservado');
  });

  it('ultimo: el canal marca exactamente 1', () => {
    expect(avisoWeb({ controlaStock: true, stockPropioVenta: 1, canales: [canalCon(1)] })).toBe('ultimo');
  });

  it('sin conflicto: stock propio 0 con canal 0 no es reservado (no hay unidad que disputar)', () => {
    expect(avisoWeb({ controlaStock: true, stockPropioVenta: 0, canales: [canalCon(0)] })).toBeNull();
  });

  it('ignora canales que no manejan stock o sin dato, y productos sin control', () => {
    expect(avisoWeb({ controlaStock: true, stockPropioVenta: 1, canales: [canalCon(0, false)] })).toBeNull();
    expect(avisoWeb({ controlaStock: true, stockPropioVenta: 1, canales: [canalCon(null)] })).toBeNull();
    expect(avisoWeb({ controlaStock: false, stockPropioVenta: 1, canales: [canalCon(0)] })).toBeNull();
  });

  it('con dos canales, reservado gana a ultimo', () => {
    expect(avisoWeb({ controlaStock: true, stockPropioVenta: 1, canales: [canalCon(1), canalCon(0)] })).toBe('reservado');
  });
});

describe('cerrarRecuento — §6.4', () => {
  it('genera movimientos solo con diferencia, enciende control en lo contado, ignora lo no contado (criterio 7)', () => {
    const r = cerrarRecuento([
      { productoId: 'a', cantidadContada: 5, stockActual: 0, controlaStock: false }, // nuevo: recuento_inicial +5
      { productoId: 'b', cantidadContada: 2, stockActual: 2, controlaStock: false }, // cuadra: sin movimiento, se enciende
      { productoId: 'c', cantidadContada: 1, stockActual: 3, controlaStock: true }, // ya controlaba: ajuste −2
      { productoId: 'd', cantidadContada: null, stockActual: 9, controlaStock: false }, // no contado
      { productoId: 'e', cantidadContada: null, stockActual: 0, controlaStock: true },
    ]);
    expect(r.movimientos).toEqual([
      { productoId: 'a', cantidad: 5, motivo: 'recuento_inicial' },
      { productoId: 'c', cantidad: -2, motivo: 'ajuste' },
    ]);
    expect(r.encender).toEqual(['a', 'b']);
    expect(r.contadas).toBe(3);
    expect(r.conDiferencia).toBe(2);
    expect(r.sumaAbs).toBe(7);
  });

  it('recuento vacío no hace nada', () => {
    expect(cerrarRecuento([])).toEqual({ movimientos: [], encender: [], contadas: 0, conDiferencia: 0, sumaAbs: 0 });
  });
});
