import { describe, expect, it } from 'vitest';
import { calcularArqueo, validarYCalcularVenta, type LineaEntrada, type PagoEntrada } from './venta.js';

const linea = (o: Partial<LineaEntrada> = {}): LineaEntrada => ({
  productoId: 'p1',
  cantidad: 2,
  precioUnitario: 2600,
  descuentoLinea: 0,
  ...o,
});

const pago = (monto: number, o: Partial<PagoEntrada> = {}): PagoEntrada => ({
  medio: 'efectivo',
  monto,
  ...o,
});

describe('validarYCalcularVenta (§5.4)', () => {
  it('ejemplo del contrato: 2×2600 + 1×2000, pago mixto efectivo+debito', () => {
    const r = validarYCalcularVenta(
      [linea(), linea({ productoId: null, descripcion: 'Varios', cantidad: 1, precioUnitario: 2000 })],
      0,
      [pago(3200, { montoRecibido: 5000 }), pago(4000, { medio: 'debito', referencia: 'OP-889231' })],
    );
    expect(r).toEqual({ ok: true, subtotal: 7200, totalLineas: 7200, total: 7200, totalesLinea: [5200, 2000] });
  });

  it('totalLinea resta descuentoLinea; total resta descuento global', () => {
    const r = validarYCalcularVenta(
      [linea({ descuentoLinea: 200 })], // 5200 - 200 = 5000
      500,
      [pago(4500)],
    );
    expect(r).toMatchObject({ ok: true, subtotal: 5200, totalLineas: 5000, total: 4500 });
  });

  it('sin líneas → SIN_LINEAS', () => {
    expect(validarYCalcularVenta([], 0, [])).toMatchObject({ ok: false, codigo: 'SIN_LINEAS' });
  });

  it('cantidad 0 o precio negativo → LINEA_INVALIDA', () => {
    expect(validarYCalcularVenta([linea({ cantidad: 0 })], 0, [])).toMatchObject({ ok: false, codigo: 'LINEA_INVALIDA' });
    expect(validarYCalcularVenta([linea({ precioUnitario: -1 })], 0, [])).toMatchObject({ ok: false, codigo: 'LINEA_INVALIDA' });
  });

  it('productoId null sin descripcion → DESCRIPCION_REQUERIDA', () => {
    expect(validarYCalcularVenta([linea({ productoId: null, descripcion: '  ' })], 0, [])).toMatchObject({
      ok: false,
      codigo: 'DESCRIPCION_REQUERIDA',
    });
  });

  it('descuentoLinea fuera de [0, cantidad×precio] → DESCUENTO_LINEA_INVALIDO', () => {
    expect(validarYCalcularVenta([linea({ descuentoLinea: 5201 })], 0, [])).toMatchObject({
      ok: false,
      codigo: 'DESCUENTO_LINEA_INVALIDO',
    });
    expect(validarYCalcularVenta([linea({ descuentoLinea: -1 })], 0, [])).toMatchObject({
      ok: false,
      codigo: 'DESCUENTO_LINEA_INVALIDO',
    });
    // tope exacto es válido: deja la línea en 0
    expect(validarYCalcularVenta([linea({ descuentoLinea: 5200 })], 0, [])).toMatchObject({ ok: true, total: 0 });
  });

  it('descuento global fuera de [0, totalLineas] → DESCUENTO_INVALIDO', () => {
    expect(validarYCalcularVenta([linea()], 5201, [])).toMatchObject({ ok: false, codigo: 'DESCUENTO_INVALIDO' });
    expect(validarYCalcularVenta([linea()], -1, [])).toMatchObject({ ok: false, codigo: 'DESCUENTO_INVALIDO' });
  });

  it('pagos que no suman el total → PAGOS_NO_CUADRAN con diferencia en el detalle', () => {
    const r = validarYCalcularVenta([linea()], 0, [pago(5000)]);
    expect(r).toMatchObject({ ok: false, codigo: 'PAGOS_NO_CUADRAN' });
    expect((r as { detalle: string }).detalle).toContain('-200');
  });

  it('efectivo con montoRecibido menor al imputado → MONTO_RECIBIDO_INSUFICIENTE', () => {
    expect(validarYCalcularVenta([linea()], 0, [pago(5200, { montoRecibido: 5000 })])).toMatchObject({
      ok: false,
      codigo: 'MONTO_RECIBIDO_INSUFICIENTE',
    });
    // montoRecibido >= monto es válido; el vuelto no forma parte del cálculo
    expect(validarYCalcularVenta([linea()], 0, [pago(5200, { montoRecibido: 6000 })])).toMatchObject({ ok: true });
  });

  it('montoRecibido no aplica a medios distintos de efectivo', () => {
    expect(validarYCalcularVenta([linea()], 0, [pago(5200, { medio: 'debito' })])).toMatchObject({ ok: true });
  });
});

describe('calcularArqueo (§5.3)', () => {
  it('montoEsperado incluye montoApertura', () => {
    const r = calcularArqueo(20000, 3200, 23200);
    expect(r).toEqual({ montoEsperado: 23200, diferencia: 0 });
  });

  it('faltante y sobrante con signo', () => {
    expect(calcularArqueo(20000, 3200, 23000).diferencia).toBe(-200);
    expect(calcularArqueo(20000, 3200, 23500).diferencia).toBe(300);
  });

  it('sin ventas en efectivo, esperado = apertura', () => {
    expect(calcularArqueo(20000, 0, 20000)).toEqual({ montoEsperado: 20000, diferencia: 0 });
  });

  // E2 §6.7: devoluciones en efectivo restan; ingresos suman; retiros restan (criterios 12 y 13).
  it('E2: devoluciones en efectivo y movimientos de caja', () => {
    expect(calcularArqueo(20000, 3200, 23200, { devolucionesEfectivo: 0, ingresosCaja: 0, retirosCaja: 0 })).toEqual({
      montoEsperado: 23200,
      diferencia: 0,
    });
    expect(calcularArqueo(20000, 3200, 21200, { devolucionesEfectivo: 2000 }).montoEsperado).toBe(21200);
    expect(calcularArqueo(20000, 3200, 0, { ingresosCaja: 5000, retirosCaja: 20000 }).montoEsperado).toBe(8200);
    expect(calcularArqueo(20000, 3200, 8000, { ingresosCaja: 5000, retirosCaja: 20000 }).diferencia).toBe(-200);
  });
});
