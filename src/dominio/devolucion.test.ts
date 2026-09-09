import { describe, expect, it } from 'vitest';
import { formatearFolioDevolucion, prorratearDescuento, validarDevolucion, type VentaParaDevolver } from './devolucion.js';

// Venta: 3 × $2.600 (línea A = $7.800) + 1 × $5.000 (línea B) = subtotal $12.800, descuento global $800.
const venta: VentaParaDevolver = {
  estado: 'completada',
  subtotal: 12800,
  descuento: 800,
  lineas: [
    { ventaLineaId: 'A', cantidad: 3, precioUnitario: 2600, descuentoLinea: 0, totalLinea: 7800, yaDevuelta: 0 },
    { ventaLineaId: 'B', cantidad: 1, precioUnitario: 5000, descuentoLinea: 0, totalLinea: 5000, yaDevuelta: 0 },
  ],
};

describe('validarDevolucion — §6.6', () => {
  it('devolución parcial prorratea el descuento global (criterio 11)', () => {
    // Línea A pagó 7800 − round(7800 × 800/12800 = 487,5) = 7800 − 488 = 7312 → 1 de 3 = 2437
    const r = validarDevolucion(venta, [{ ventaLineaId: 'A', cantidad: 1, reponeStock: true }]);
    expect(r).toEqual({
      lineas: [{ ventaLineaId: 'A', cantidad: 1, reponeStock: true, montoLinea: 2437 }],
      monto: 2437,
    });
  });

  it('devolución total devuelve exactamente lo pagado (subtotal − descuento)', () => {
    const r = validarDevolucion(venta, [
      { ventaLineaId: 'A', cantidad: 3, reponeStock: true },
      { ventaLineaId: 'B', cantidad: 1, reponeStock: false },
    ]);
    expect('monto' in r && r.monto).toBe(12000);
  });

  it('respeta lo ya devuelto: 1 de 3 ya devuelta, pedir 3 → CANTIDAD_EXCEDE_VENTA (criterio 11)', () => {
    const conPrevia: VentaParaDevolver = {
      ...venta,
      lineas: [{ ...venta.lineas[0]!, yaDevuelta: 1 }, venta.lineas[1]!],
    };
    expect(validarDevolucion(conPrevia, [{ ventaLineaId: 'A', cantidad: 3, reponeStock: true }])).toEqual({
      codigo: 'CANTIDAD_EXCEDE_VENTA',
      detalle: 'Se vendieron 3, ya se devolvieron 1; quedan 2.',
      ventaLineaId: 'A',
      vendida: 3,
      yaDevuelta: 1,
      solicitada: 3,
    });
    expect(validarDevolucion(conPrevia, [{ ventaLineaId: 'A', cantidad: 2, reponeStock: true }])).toMatchObject({ monto: 4875 });
  });

  it('venta anulada, sin líneas, línea ajena y cantidad inválida', () => {
    expect(validarDevolucion({ ...venta, estado: 'anulada' }, [{ ventaLineaId: 'A', cantidad: 1, reponeStock: true }])).toMatchObject({ codigo: 'VENTA_ANULADA' });
    expect(validarDevolucion(venta, [])).toMatchObject({ codigo: 'SIN_LINEAS' });
    expect(validarDevolucion(venta, [{ ventaLineaId: 'Z', cantidad: 1, reponeStock: true }])).toMatchObject({ codigo: 'LINEA_NO_ENCONTRADA', ventaLineaId: 'Z' });
    expect(validarDevolucion(venta, [{ ventaLineaId: 'A', cantidad: 0, reponeStock: true }])).toMatchObject({ codigo: 'CANTIDAD_INVALIDA' });
    expect(validarDevolucion(venta, [{ ventaLineaId: 'A', cantidad: 1.5, reponeStock: true }])).toMatchObject({ codigo: 'CANTIDAD_INVALIDA' });
  });

  it('sin descuento global, monto = cantidad × precio', () => {
    const sinDesc = { ...venta, descuento: 0 };
    expect(validarDevolucion(sinDesc, [{ ventaLineaId: 'A', cantidad: 2, reponeStock: true }])).toMatchObject({ monto: 5200 });
  });
});

describe('prorratearDescuento', () => {
  it('la suma de las partes es exactamente el descuento (resto mayor)', () => {
    const r = prorratearDescuento(venta);
    expect(r.get('A')! + r.get('B')!).toBe(800);
    expect(r.get('A')).toBe(488); // 487,5 → gana el resto por aparecer primero
    expect(r.get('B')).toBe(312);
  });
  it('sin descuento todo es 0', () => {
    const r = prorratearDescuento({ ...venta, descuento: 0 });
    expect([...r.values()]).toEqual([0, 0]);
  });
});

describe('formatearFolioDevolucion', () => {
  it('D-año-#####', () => {
    expect(formatearFolioDevolucion(2026, 1)).toBe('D-2026-00001');
    expect(formatearFolioDevolucion(2026, 12345)).toBe('D-2026-12345');
  });
});
