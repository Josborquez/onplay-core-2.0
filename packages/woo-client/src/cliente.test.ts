import { describe, expect, it } from 'vitest';
import { ClienteWoo, ErrorEscrituraBloqueada, describeError } from './cliente.js';

const config = {
  url: 'https://ejemplo.test',
  ck: 'ck_x',
  cs: 'cs_x',
  soloLectura: true,
};

describe('candado SYNC_SOLO_LECTURA (02-SDD §11)', () => {
  it('bloquea POST, PUT y DELETE antes de tocar la red', async () => {
    const cliente = new ClienteWoo(config);
    await expect(cliente.solicitar('POST', 'products')).rejects.toBeInstanceOf(ErrorEscrituraBloqueada);
    await expect(cliente.solicitar('PUT', 'products/1')).rejects.toBeInstanceOf(ErrorEscrituraBloqueada);
    await expect(cliente.solicitar('DELETE', 'products/1')).rejects.toBeInstanceOf(ErrorEscrituraBloqueada);
  });

  it('el mensaje deja claro que es el candado de la Etapa 1', async () => {
    const cliente = new ClienteWoo(config);
    await expect(cliente.solicitar('POST', 'products')).rejects.toThrow(/SYNC_SOLO_LECTURA/);
  });
});

describe('describeError', () => {
  it('reconoce una respuesta HTML de un WAF', () => {
    expect(describeError(403, '<!DOCTYPE html><html>bloqueado</html>')).toMatch(/HTML/);
  });

  it('recorta cuerpos de texto normales', () => {
    expect(describeError(500, 'error interno')).toBe('HTTP 500: error interno');
  });
});

describe('E3: escritura acotada (06-SDD §7.2)', () => {
  it('actualizarProducto con el candado puesto no toca la red', async () => {
    const cliente = new ClienteWoo(config);
    await expect(cliente.actualizarProducto(1, { regular_price: '1000' })).rejects.toBeInstanceOf(
      ErrorEscrituraBloqueada,
    );
  });

  it('el PUT manda solo regular_price y stock_quantity, nunca otros campos', async () => {
    const cliente = new ClienteWoo({ ...config, soloLectura: false });
    const original = globalThis.fetch;
    let cuerpoEnviado: unknown = null;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      cuerpoEnviado = JSON.parse(String(init?.body));
      return new Response('{"id":1}', { status: 200 });
    }) as typeof fetch;
    try {
      await cliente.actualizarProducto(1, {
        regular_price: '1000',
        stock_quantity: 3,
        name: 'NO',
        sale_price: '1',
      } as never);
    } finally {
      globalThis.fetch = original;
    }
    expect(cuerpoEnviado).toEqual({ regular_price: '1000', stock_quantity: 3 });
  });
});
