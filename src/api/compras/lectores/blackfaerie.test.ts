import { describe, expect, it } from 'vitest';
import { leerBlackfaerie, reconoceBlackfaerie } from './blackfaerie.js';
import { detectarLector } from './index.js';
import { PAGINAS_2940 } from './blackfaerie.fixture.js';

describe('lector Black Faerie — factura 2940', () => {
  it('se reconoce por RUT o nombre y lo elige el registro', () => {
    expect(reconoceBlackfaerie(PAGINAS_2940)).toBe(true);
    expect(detectarLector(PAGINAS_2940)?.clave).toBe('blackfaerie');
  });

  it('lee número, fecha, las 53 líneas de las 4 páginas y los totales del pie', () => {
    const d = leerBlackfaerie(PAGINAS_2940);
    expect(d.numeroDocumento).toBe('2940');
    expect(d.fechaDocumento).toBe('2026-09-15');
    expect(d.tipoDocumento).toBe('factura');
    expect(d.moneda).toBe('CLP');
    expect(d.proveedor.rut).toBe('76648466-2');
    expect(d.lineas).toHaveLength(53);
    expect(d.totales).toEqual({ neto: 1413613, impuestos: 268587, total: 1682200 });
    expect(d.advertencias).toEqual([]);
  });

  it('el importe trae IVA: total = importe, neto = importe ÷ 1,19 y las sumas cuadran con el pie', () => {
    const d = leerBlackfaerie(PAGINAS_2940);
    expect(d.lineas.reduce((a, l) => a + l.total, 0)).toBe(1682200);
    expect(d.lineas.reduce((a, l) => a + l.neto, 0)).toBe(1413613);
    const caja = d.lineas[0]!;
    expect(caja).toMatchObject({
      codigoProveedor: '1-BX-3200',
      descripcion: '3200 COUNT STORAGE BOX (FULL LID)',
      bultos: 10,
      unidadesPorBulto: 1,
      sueltas: 0,
      total: 61200,
      neto: 51429, // 61.200 / 1,19 (el unitario impreso 5.143 es el neto redondeado)
      impuestos: 9771,
    });
    expect(d.lineas.find((l) => l.codigoProveedor === 'AP-SNAP')?.bultos).toBe(100);
  });

  it('une la descripción que sigue en la fila siguiente, también entre páginas', () => {
    const d = leerBlackfaerie(PAGINAS_2940);
    const porCodigo = (c: string) => d.lineas.find((l) => l.codigoProveedor === c)?.descripcion;
    expect(porCodigo('AT-13023')).toBe('TOPLOADING PERFECT FIT SLEEVES STANDARD SIZE (100)');
    expect(porCodigo('AT-15048')).toBe('SLEEVES STANDARD SIZE MATTE DUAL (100) - LAGOON');
    expect(porCodigo('AT-15057')).toBe('SLEEVES STANDARD SIZE MATTE DUAL (100) - WISDOM');
    expect(porCodigo('AT-11139')).toBe('SLEEVES JAPANESE SIZE MATTE (60) - PINK DIAMOND');
    // Ninguna descripción arrastra el pie de página ni el timbre.
    expect(d.lineas.every((l) => !/p[áa]gina|timbre|ventas@/i.test(l.descripcion))).toBe(true);
  });

  it('avisa si el total del pie no cuadra con los importes', () => {
    const alterado = PAGINAS_2940.map((p) => p.map((f) => (f[0] === 'Total' ? ['Total', '$', '1.700.000'] : f)));
    const d = leerBlackfaerie(alterado);
    expect(d.advertencias.some((a) => a.includes('no cuadra'))).toBe(true);
    expect(d.lineas.reduce((a, l) => a + l.total, 0)).toBe(1682200);
  });
});
