// Criterios de aceptación de docs/14 §9 (prompt R-036). Datos de prueba, no cifras reales.
import { describe, expect, it } from 'vitest';
import {
  calcularMargen,
  consolidarCanales,
  valorizarInventario,
  variacionPorcentaje,
  type ExistenciaAnalitica,
  type LineaAnalitica,
  type OperacionAnalitica,
} from './analisis.js';

const CANALES = ['tienda_fisica', 'onplay_cl', 'onplaygames_cl'];

function op(p: Partial<OperacionAnalitica> & { canalId: string; importeBruto: number }): OperacionAnalitica {
  return {
    id: Math.random().toString(36).slice(2),
    fuente: p.canalId === 'tienda_fisica' ? 'pos' : 'web',
    referencia: 'X-1',
    dia: '2026-09-01',
    moneda: 'CLP',
    estado: 'valida',
    reembolsos: 0,
    unidades: 1,
    unidadesDevueltas: 0,
    cargaMonedero: 0,
    ...p,
  };
}

describe('consolidarCanales', () => {
  it('criterio 1: tres operaciones sin devoluciones reparten 50/30/20 y suman el total', () => {
    const r = consolidarCanales(
      [
        op({ canalId: 'tienda_fisica', importeBruto: 100_000 }),
        op({ canalId: 'onplay_cl', importeBruto: 60_000 }),
        op({ canalId: 'onplaygames_cl', importeBruto: 40_000 }),
      ],
      CANALES,
    );
    expect(r.total.importeAjustado).toBe(200_000);
    expect(r.filas.map((f) => f.aportePorcentaje)).toEqual([50, 30, 20]);
    expect(r.filas.reduce((a, f) => a + f.importeAjustado, 0)).toBe(r.total.importeAjustado);
  });

  it('criterio 2: devolución física 10.000 y reembolso parcial web 5.000 → 185.000 exactos', () => {
    const r = consolidarCanales(
      [
        op({ canalId: 'tienda_fisica', importeBruto: 100_000, reembolsos: 10_000, unidades: 2, unidadesDevueltas: 1 }),
        op({ canalId: 'onplay_cl', importeBruto: 60_000, reembolsos: 5_000 }),
        op({ canalId: 'onplaygames_cl', importeBruto: 40_000 }),
      ],
      CANALES,
    );
    expect(r.total.importeAjustado).toBe(185_000);
    expect(r.filas[0]!.unidadesNetas).toBe(1);
    // Los porcentajes se redondean al mostrar; los importes no se tocan.
    expect(r.filas.reduce((a, f) => a + f.importeAjustado, 0)).toBe(185_000);
  });

  it('criterio 5: anuladas y canceladas no suman y se cuentan aparte; el reembolso total conserva la operación', () => {
    const r = consolidarCanales(
      [
        op({ canalId: 'tienda_fisica', importeBruto: 50_000, estado: 'anulada' }),
        op({ canalId: 'onplay_cl', importeBruto: 30_000, estado: 'cancelada' }),
        op({ canalId: 'onplay_cl', importeBruto: 20_000, reembolsos: 20_000 }),
        op({ canalId: 'onplaygames_cl', importeBruto: 10_000, estado: 'revision' }),
      ],
      CANALES,
    );
    expect(r.filas[0]!.operacionesAnuladas).toBe(1);
    expect(r.filas[0]!.operaciones).toBe(0);
    expect(r.filas[1]!.operaciones).toBe(1); // la cancelada no entra, la reembolsada total sí
    expect(r.filas[1]!.operacionesReembolsadasTotal).toBe(1);
    expect(r.filas[1]!.importeAjustado).toBe(0);
    expect(r.filas[2]!.operacionesEnRevision).toBe(1);
    expect(r.total.importeAjustado).toBe(10_000);
  });

  it('criterio 6: la carga de saldo no es venta; el producto pagado con monedero se cuenta una vez', () => {
    const r = consolidarCanales(
      [
        op({ canalId: 'tienda_fisica', importeBruto: 0, unidades: 0, cargaMonedero: 20_000 }),
        op({ canalId: 'tienda_fisica', importeBruto: 20_000 }), // pagada con saldo
      ],
      CANALES,
    );
    expect(r.total.importeAjustado).toBe(20_000);
    expect(r.filas[0]!.operaciones).toBe(1);
    expect(r.filas[0]!.cargasMonedero).toBe(20_000);
  });

  it('sin importes no calcula aporte ni ticket: «No calculable» y «—», nunca 0', () => {
    const r = consolidarCanales([], CANALES);
    expect(r.total.aportePorcentaje).toBeNull();
    expect(r.filas[0]!.ticketPromedio).toBeNull();
    expect(r.total.importeAjustado).toBe(0);
  });

  it('una operación en otra moneda queda fuera del total CLP y se informa', () => {
    const r = consolidarCanales(
      [op({ canalId: 'onplay_cl', importeBruto: 500, moneda: 'USD' }), op({ canalId: 'onplay_cl', importeBruto: 1_000 })],
      CANALES,
    );
    expect(r.filas[1]!.importeAjustado).toBe(1_000);
    expect(r.filas[1]!.operacionesOtraMoneda).toBe(1);
    expect(r.filas[1]!.operaciones).toBe(1);
  });

  it('el ticket promedio del total se recalcula: no promedia promedios', () => {
    const r = consolidarCanales(
      [
        op({ canalId: 'tienda_fisica', importeBruto: 10_000 }),
        op({ canalId: 'onplay_cl', importeBruto: 1_000 }),
        op({ canalId: 'onplay_cl', importeBruto: 1_000 }),
      ],
      CANALES,
    );
    expect(r.filas[0]!.ticketPromedio).toBe(10_000);
    expect(r.filas[1]!.ticketPromedio).toBe(1_000);
    expect(r.total.ticketPromedio).toBe(4_000); // 12.000 / 3, no (10.000 + 1.000) / 2
  });
});

function linea(p: Partial<LineaAnalitica> & { importe: number }): LineaAnalitica {
  return {
    canalId: 'tienda_fisica',
    categoriaId: null,
    categoria: null,
    juego: null,
    tipo: null,
    productoId: 'p1',
    sku: 'SNK-000001',
    descripcion: 'Producto',
    unidades: 1,
    unidadesDevueltas: 0,
    costoUnitario: null,
    costoCongelado: false,
    ...p,
  };
}

describe('calcularMargen', () => {
  it('solo las líneas con costo entran al margen; el resto es cobertura', () => {
    const m = calcularMargen([
      linea({ importe: 1_500, costoUnitario: 1_000, costoCongelado: true }),
      linea({ importe: 500 }), // sin costo conocido
    ]);
    expect(m.ingresoBase).toBe(1_500);
    expect(m.costo).toBe(1_000);
    expect(m.margen).toBe(500);
    expect(m.margenPorcentaje).toBeCloseTo(33.33, 1);
    expect(m.ingresoTotal).toBe(2_000);
    expect(m.coberturaLineas).toBe(50);
    expect(m.coberturaImporte).toBe(75);
  });

  it('sin ninguna línea con costo, el margen no es calculable', () => {
    const m = calcularMargen([linea({ importe: 900 })]);
    expect(m.margenPorcentaje).toBeNull();
    expect(m.ingresoBase).toBe(0);
    expect(m.coberturaLineas).toBe(0);
  });

  it('criterio 10: la devolución sin reposición conserva el costo perdido; con reposición no', () => {
    const l = [linea({ importe: 1_500, unidades: 2, unidadesDevueltas: 1, costoUnitario: 1_000, costoCongelado: true })];
    const conReposicion = calcularMargen(l);
    expect(conReposicion.costo).toBe(1_000); // solo la unidad que quedó vendida
    const dañada = calcularMargen(l, [1]);
    expect(dañada.costoPerdidoSinReposicion).toBe(1_000);
    expect(dañada.margen).toBe(conReposicion.margen - 1_000);
  });

  it('un costo cero registrado no es lo mismo que desconocido', () => {
    const m = calcularMargen([linea({ importe: 1_000, costoUnitario: 0, costoCongelado: true })]);
    expect(m.lineasConCosto).toBe(1);
    expect(m.margen).toBe(1_000);
    expect(m.coberturaLineas).toBe(100);
  });
});

function ex(p: Partial<ExistenciaAnalitica> & { cantidad: number }): ExistenciaAnalitica {
  return {
    productoId: 'p1',
    sku: 'ACC-000001',
    nombre: 'Funda',
    ubicacionId: 'mostrador',
    ubicacion: 'Mostrador',
    categoria: 'Accesorios',
    juego: null,
    activo: true,
    controlaStock: true,
    costoReferencia: 1_000,
    precioVenta: 1_500,
    ...p,
  };
}

describe('valorizarInventario', () => {
  it('criterio 7: 10 en mostrador y 5 en bodega, costo 1.000 y precio 1.500 → 15.000 y 22.500', () => {
    const { resumen } = valorizarInventario([
      ex({ cantidad: 10 }),
      ex({ cantidad: 5, ubicacionId: 'bodega', ubicacion: 'Bodega' }),
    ]);
    expect(resumen.valorCostoPositivo).toBe(15_000);
    expect(resumen.valorPrecioPositivo).toBe(22_500);
    expect(resumen.diferenciaPotencial).toBe(7_500);
    expect(resumen.unidadesPositivas).toBe(15);
    expect(resumen.skusConExistencia).toBe(1);
    expect(resumen.coberturaUnidades).toBe(100);
  });

  it('criterio 8: sin costo, costo cero, sin control, inactivo y negativo se separan', () => {
    const { filas, resumen } = valorizarInventario([
      ex({ cantidad: 4, productoId: 'sinCosto', sku: 'ACC-2', costoReferencia: null }),
      ex({ cantidad: 3, productoId: 'cero', sku: 'ACC-3', costoReferencia: 0 }),
      ex({ cantidad: 2, productoId: 'suelto', sku: 'ACC-4', controlaStock: false }),
      ex({ cantidad: 1, productoId: 'inactivo', sku: 'ACC-5', activo: false }),
      ex({ cantidad: -2, productoId: 'negativo', sku: 'ACC-6' }),
    ]);
    expect(filas.map((f) => f.calidad)).toEqual(['sin_costo', 'completa', 'sin_control', 'completa', 'negativo']);
    expect(resumen.unidadesSinCosto).toBe(4);
    expect(resumen.skusSinCosto).toBe(1);
    expect(resumen.unidadesNegativas).toBe(-2);
    expect(resumen.valorCostoNegativo).toBe(-2_000); // se muestra, no se esconde
    // El inactivo con stock sigue siendo patrimonio: entra al valor.
    expect(resumen.valorCostoPositivo).toBe(0 * 3 + 1_000 * 1 + 1_000 * 2);
    expect(resumen.saldoAlgebraico).toBe(4 + 3 + 2 + 1 - 2);
  });

  it('el valor sin costo no se rellena con cero y la diferencia solo usa filas con ambos datos', () => {
    const { filas, resumen } = valorizarInventario([
      ex({ cantidad: 2, costoReferencia: null }),
      ex({ cantidad: 2, productoId: 'p2', sku: 'ACC-9', precioVenta: null }),
    ]);
    expect(filas[0]!.valorCosto).toBeNull();
    expect(filas[1]!.valorPrecio).toBeNull();
    expect(resumen.diferenciaPotencial).toBe(0);
    expect(resumen.coberturaUnidades).toBe(50);
  });
});

describe('variacionPorcentaje', () => {
  it('sin base anterior positiva no es calculable', () => {
    expect(variacionPorcentaje(100, 0)).toBeNull();
    expect(variacionPorcentaje(150, 100)).toBe(50);
  });
});
