import { describe, expect, it } from 'vitest';
import { leerNico, reconoceNico } from './nico.js';
import { detectarLector } from './index.js';
import type { PaginaTexto } from '../pdf.js';

// Celdas reales del pedido 216107 (docs/pdf/factura-216107.pdf), tal como las entrega extraerPaginasPdf.
const PAGINAS: PaginaTexto[] = [
  [
    ['Distribuidora Nico'],
    ['Avenida La Estrella 1041, Pudahuel'],
    ['www.DistribuidoraNico.cl'],
    ['PEDIDO'],
    ['Israel Borquez Muñoz', 'Número de pedido:', '216107'],
    ['77862085-5'],
    ['Fecha de pedido:', '07/09/2026'],
    ['Método de pago:', 'Pago en Efectivo'],
    ['SKU', 'Producto', 'Cantidad', 'Precio', 'Total'],
    ['239-2', 'Lata Bilz x 6 und', '1', '$3.990', '$3.990'],
    ['SKU: 239-2'],
    ['532-2', 'Score Gorila Energética 475 ml', '12', '$897', '$10.764'],
    ['SKU: 532-2'],
    ['830', 'Lata Kem Xtreme x 6u', '4', '$4.794', '$19.176'],
    ['SKU: 830'],
  ],
  [
    ['SKU', 'Producto', 'Cantidad', 'Precio', 'Total'],
    ['239-11', 'Lata Pepsi Zero x 6 u', '6', '$3.990', '$23.940'],
    ['SKU: 239-11'],
    ['852', 'Alfajor Premium x12u', '2', '$4.790', '$9.580'],
    ['SKU: 852'],
    ['11-1', 'Alfajor Game Blanco x24', '2', '$7.440', '$14.880'],
    ['SKU: 11-1'],
    ['456', 'Super 8', '1', '$7.128', '$7.128'],
    ['SKU: 456'],
    ['819-3', 'Wild Protein Chocolate-Coco 45g x5', '1', '$5.367', '$5.367'],
    ['SKU: 819-3'],
    ['239-2-1', 'Lata Pap x 6 und', '4', '$3.990', '$15.960'],
    ['SKU: 239-2-1'],
    ['Datos Facturación:'],
    ['Razon Social:', 'comercializadora y distribuidora BM limitada'],
    ['Subtotal', '$110.785'],
    ['Rut:', '77862085-5'],
    ['Giro:', 'VENTA AL POR MENOR DE JUEGOS Y JUGUETES', 'Envío', '$0'],
    ['Total', '$110.785'],
    ['*Este detalle es una orden de pedido web interno de Distribuidora Nico, no representa a un documento tributario.'],
  ],
];

describe('lector Nico — pedido 216107', () => {
  it('se reconoce por la razón social y lo elige el registro', () => {
    expect(reconoceNico(PAGINAS)).toBe(true);
    expect(detectarLector(PAGINAS)?.clave).toBe('nico');
  });

  it('lee cabecera, líneas de las dos páginas y el total; no lo confunde con las filas «SKU: …»', () => {
    const d = leerNico(PAGINAS);
    expect(d.numeroDocumento).toBe('216107');
    expect(d.fechaDocumento).toBe('2026-09-07');
    expect(d.tipoDocumento).toBe('otro');
    expect(d.proveedor).toEqual({ rut: null, nombre: 'Distribuidora Nico' });
    expect(d.lineas).toHaveLength(9);
    expect(d.totales?.total).toBe(110785);
    expect(d.totales?.neto).toBe(Math.round(110785 / 1.19));
    // Σ total de las líneas = total del pedido (3.990 + 10.764 + 19.176 + 23.940 + 9.580 + 14.880 + 7.128 + 5.367 + 15.960).
    expect(d.lineas.reduce((a, l) => a + l.total, 0)).toBe(110785);
  });

  it('cantidad = bultos de Nico; unidades por bulto desde «x 6 und», «x 6u», «x12u», «x24», «x5»', () => {
    const d = leerNico(PAGINAS);
    const por = (sku: string) => d.lineas.find((l) => l.codigoProveedor === sku)!;
    expect(por('239-2')).toMatchObject({ bultos: 1, unidadesPorBulto: 6, sueltas: 0, total: 3990 });
    expect(por('830')).toMatchObject({ bultos: 4, unidadesPorBulto: 6 });
    expect(por('239-11')).toMatchObject({ bultos: 6, unidadesPorBulto: 6 });
    expect(por('852')).toMatchObject({ bultos: 2, unidadesPorBulto: 12 });
    expect(por('11-1')).toMatchObject({ bultos: 2, unidadesPorBulto: 24 });
    expect(por('819-3')).toMatchObject({ bultos: 1, unidadesPorBulto: 5 });
    // Sin «x N»: 1 por bulto y advertencia (Score Gorila son 12 latas sueltas; Super 8 es una caja sin detalle).
    expect(por('532-2')).toMatchObject({ bultos: 12, unidadesPorBulto: 1 });
    expect(por('456')).toMatchObject({ bultos: 1, unidadesPorBulto: 1 });
    expect(d.advertencias.filter((a) => a.includes('se asumió 1'))).toHaveLength(2);
  });

  it('el neto es el total ÷ 1,19 (precios con IVA incluido) y el costo unitario sale del total', () => {
    const d = leerNico(PAGINAS);
    const kem = d.lineas.find((l) => l.codigoProveedor === '830')!;
    expect(kem.neto).toBe(Math.round(19176 / 1.19));
    expect(kem.impuestos).toBe(19176 - kem.neto);
  });
});
