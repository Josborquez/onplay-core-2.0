import { describe, expect, it } from 'vitest';
import {
  decidirPushPrecio,
  decidirPushStock,
  devueltasPorLinea,
  explicarDeriva,
  montoDesdeWoo,
  pedidoAnulado,
  pedidoPagado,
} from './sync.js';

const base = { controlaStock: true, publicado: true, manejaStockCanal: true };

describe('decidirPushStock (06-SDD §4.1, §4.4, §7.3, §7.4)', () => {
  it('omite todo producto sin controlaStock aunque el plan parezca correcto (RS1)', () => {
    expect(decidirPushStock({ ...base, controlaStock: false, maestro: 0, canal: 4, publicadoAntes: 4 })).toEqual({
      accion: 'omitir',
      motivo: 'sin_control_stock',
    });
  });

  it('deriva 0 → escribir S_maestro', () => {
    expect(decidirPushStock({ ...base, maestro: 2, canal: 4, publicadoAntes: 4 })).toEqual({
      accion: 'escribir',
      deriva: 0,
    });
  });

  it('deriva ≠ 0 → detener con stock_derivado y la explicación de V13', () => {
    const d = decidirPushStock({ ...base, maestro: 6, canal: 3, publicadoAntes: 5 });
    expect(d.accion).toBe('detener');
    expect(d.motivo).toBe('stock_derivado');
    expect(d.deriva).toBe(-2);
    expect(d.explicacion).toMatch(/bajó 2 unidades/);
  });

  it('nunca publicado → primera_publicacion, no escribe', () => {
    expect(decidirPushStock({ ...base, maestro: 6, canal: 3, publicadoAntes: null }).motivo).toBe(
      'primera_publicacion',
    );
  });

  it('canal sin manage_stock → detener, nunca lo enciende el maestro', () => {
    expect(
      decidirPushStock({ ...base, manejaStockCanal: false, maestro: 1, canal: null, publicadoAntes: null }).motivo,
    ).toBe('canal_sin_gestion');
  });

  it('sin deriva y sin diferencia → omitir (nada que escribir)', () => {
    expect(decidirPushStock({ ...base, maestro: 4, canal: 4, publicadoAntes: 4 })).toEqual({ accion: 'omitir' });
  });

  it('explicarDeriva distingue subida y bajada y el singular', () => {
    expect(explicarDeriva(1)).toMatch(/subió 1 unidad /);
    expect(explicarDeriva(-3)).toMatch(/bajó 3 unidades/);
  });
});

describe('decidirPushPrecio (06-SDD §4.3, RS7)', () => {
  it('con sale_price activo NO se toca, ni aunque el precio difiera', () => {
    expect(
      decidirPushPrecio({ publicado: true, maestro: 5000, regularCanal: 6000, enOferta: true, precioPublicado: 6000 }),
    ).toEqual({ accion: 'detener', motivo: 'precio_en_oferta' });
  });

  it('regular_price = precioPublicado y distinto del maestro → escribir sin aviso', () => {
    expect(
      decidirPushPrecio({ publicado: true, maestro: 5000, regularCanal: 4500, enOferta: false, precioPublicado: 4500 }),
    ).toEqual({ accion: 'escribir' });
  });

  it('regular_price ≠ precioPublicado → escribir igual y avisar precio_derivado', () => {
    expect(
      decidirPushPrecio({ publicado: true, maestro: 5000, regularCanal: 4800, enOferta: false, precioPublicado: 4500 }),
    ).toEqual({ accion: 'escribir', informativa: 'precio_derivado' });
  });

  it('ya igual → omitir', () => {
    expect(
      decidirPushPrecio({ publicado: true, maestro: 5000, regularCanal: 5000, enOferta: false, precioPublicado: null }),
    ).toEqual({ accion: 'omitir' });
  });

  it('precio 0 en el maestro nunca se publica', () => {
    expect(
      decidirPushPrecio({ publicado: true, maestro: 0, regularCanal: 5000, enOferta: false, precioPublicado: null })
        .motivo,
    ).toBe('sin_precio');
  });
});

describe('ingesta (06-SDD §8)', () => {
  it('solo processing y completed cuentan como pagados (§8.4)', () => {
    expect(pedidoPagado('processing')).toBe(true);
    expect(pedidoPagado('completed')).toBe(true);
    expect(pedidoPagado('on-hold')).toBe(false);
    expect(pedidoPagado('pending')).toBe(false);
    expect(pedidoAnulado('refunded')).toBe(true);
    expect(pedidoAnulado('cancelled')).toBe(true);
  });

  it('devueltasPorLinea suma en valor absoluto y salta reembolsos sin ítems', () => {
    const m = devueltasPorLinea([
      { line_items: [{ id: 10, quantity: -1 }] },
      {
        line_items: [
          { id: 10, quantity: -1 },
          { id: 11, quantity: 0 },
        ],
      },
      { line_items: [] },
    ]);
    expect(m.get(10)).toBe(2);
    expect(m.has(11)).toBe(false);
  });

  it('montoDesdeWoo redondea a CLP entero', () => {
    expect(montoDesdeWoo('31775')).toBe(31775);
    expect(montoDesdeWoo('-99990')).toBe(-99990);
    expect(montoDesdeWoo(25201.680672)).toBe(25202);
    expect(montoDesdeWoo(undefined)).toBe(0);
  });
});
