// R-036 — Análisis comercial e inventario (docs/14-SDD-analisis-comercial.md).
// Reglas PURAS: la API arma las operaciones desde las dos fuentes (POS y pedidos web) y aquí se
// consolidan. Todo en CLP entero. Nada de esto escribe: un reporte nunca crea movimientos (P5/P9).
//
// Vocabulario (docs/14 §3), porque los nombres importan para no mentir con los números:
// - «importe bruto» = importe comercial del período ANTES de reembolsos, sin cargas de monedero.
// - «importe ajustado» = bruto − reembolsos conocidos a la fecha de consulta. NO es «sin IVA».
// - `null` = desconocido. Cero es un cero medido. Nunca se rellena un desconocido con cero.

export type FuenteOperacion = 'pos' | 'web';

/** Qué pasó con la operación. Solo `valida` suma al importe comercial del canal. */
export type EstadoOperacion =
  | 'valida' // venta completada o pedido en criterio de venta (processing/completed)
  | 'anulada' // venta POS anulada
  | 'cancelada' // pedido cancelado o reembolsado por completo en el canal
  | 'revision'; // pagado y cancelado sin información suficiente del reembolso (§4)

export interface OperacionAnalitica {
  id: string;
  fuente: FuenteOperacion;
  canalId: string;
  referencia: string; // folio V-2026-00001 o número del pedido web
  /** Día en hora de Chile (YYYY-MM-DD), ya convertido por la API. */
  dia: string;
  moneda: string;
  estado: EstadoOperacion;
  /** Importe comercial antes de reembolsos, ya sin cargas de monedero. */
  importeBruto: number;
  /** Reembolsos/devoluciones conocidos de ESA operación (positivo). */
  reembolsos: number;
  unidades: number;
  unidadesDevueltas: number;
  /** Carga de saldo (SRV-000001) incluida en la operación: se informa aparte, no es venta. */
  cargaMonedero: number;
}

export interface FilaCanal {
  canalId: string;
  operaciones: number;
  operacionesReembolsadasTotal: number;
  operacionesAnuladas: number;
  operacionesEnRevision: number;
  unidadesNetas: number;
  importeBruto: number;
  reembolsos: number;
  importeAjustado: number;
  cargasMonedero: number;
  /** null cuando el denominador no es positivo: «No calculable», nunca 0 %. */
  aportePorcentaje: number | null;
  /** null sin operaciones: «—», nunca $0. */
  ticketPromedio: number | null;
  /** Operaciones en otra moneda: quedan FUERA de los importes CLP y se informan (§4). */
  operacionesOtraMoneda: number;
}

export interface ConsolidadoCanales {
  filas: FilaCanal[];
  total: FilaCanal;
}

const vacia = (canalId: string): FilaCanal => ({
  canalId,
  operaciones: 0,
  operacionesReembolsadasTotal: 0,
  operacionesAnuladas: 0,
  operacionesEnRevision: 0,
  unidadesNetas: 0,
  importeBruto: 0,
  reembolsos: 0,
  importeAjustado: 0,
  cargasMonedero: 0,
  aportePorcentaje: null,
  ticketPromedio: null,
  operacionesOtraMoneda: 0,
});

/**
 * Consolida las operaciones de todas las fuentes por canal (§5).
 * `canales` fija el orden y deja ver con 0 los canales sin ventas (que NO es «sin datos»: eso lo
 * dice la cobertura, §6). Una operación en moneda distinta de CLP no entra a los importes.
 */
export function consolidarCanales(operaciones: OperacionAnalitica[], canales: string[]): ConsolidadoCanales {
  const filas = new Map<string, FilaCanal>(canales.map((c) => [c, vacia(c)]));
  for (const op of operaciones) {
    const fila = filas.get(op.canalId) ?? vacia(op.canalId);
    filas.set(op.canalId, fila);
    if (op.estado === 'anulada') {
      fila.operacionesAnuladas += 1;
      continue;
    }
    if (op.estado === 'cancelada') continue;
    if (op.estado === 'revision') fila.operacionesEnRevision += 1;
    if (op.moneda !== 'CLP') {
      fila.operacionesOtraMoneda += 1;
      continue;
    }
    fila.cargasMonedero += op.cargaMonedero;
    // Una operación que solo carga saldo no es una venta comercial (§4).
    if (op.importeBruto === 0 && op.unidades === 0) continue;
    fila.operaciones += 1;
    fila.importeBruto += op.importeBruto;
    fila.reembolsos += op.reembolsos;
    fila.unidadesNetas += op.unidades - op.unidadesDevueltas;
    if (op.reembolsos >= op.importeBruto && op.importeBruto > 0) fila.operacionesReembolsadasTotal += 1;
  }

  const lista = [...filas.values()];
  for (const f of lista) f.importeAjustado = f.importeBruto - f.reembolsos;
  const total = lista.reduce<FilaCanal>((a, f) => {
    a.operaciones += f.operaciones;
    a.operacionesReembolsadasTotal += f.operacionesReembolsadasTotal;
    a.operacionesAnuladas += f.operacionesAnuladas;
    a.operacionesEnRevision += f.operacionesEnRevision;
    a.unidadesNetas += f.unidadesNetas;
    a.importeBruto += f.importeBruto;
    a.reembolsos += f.reembolsos;
    a.importeAjustado += f.importeAjustado;
    a.cargasMonedero += f.cargasMonedero;
    a.operacionesOtraMoneda += f.operacionesOtraMoneda;
    return a;
  }, vacia('total'));

  for (const f of [...lista, total]) {
    f.aportePorcentaje = total.importeAjustado > 0 ? (f.importeAjustado / total.importeAjustado) * 100 : null;
    f.ticketPromedio = f.operaciones > 0 ? Math.round(f.importeAjustado / f.operaciones) : null;
  }
  return { filas: lista, total };
}

/** Línea comercial ya atribuida a un canal y a una categoría (§5, matriz canal × categoría). */
export interface LineaAnalitica {
  canalId: string;
  /** null → se agrupa como «Sin clasificar» sin perder el importe. */
  categoriaId: string | null;
  categoria: string | null;
  juego: string | null;
  tipo: string | null;
  productoId: string | null;
  sku: string | null;
  descripcion: string;
  unidades: number;
  unidadesDevueltas: number;
  /** Importe comercial de la línea, ya neto de la parte devuelta. */
  importe: number;
  /** Costo unitario congelado o imputado; null = desconocido (no es cero). */
  costoUnitario: number | null;
  /** true si el costo salió de una captura del momento de la venta; false = estimado a costo de hoy. */
  costoCongelado: boolean;
}

export interface Margen {
  /** Ingreso de las líneas CON costo conocido: única base comparable (§6). */
  ingresoBase: number;
  costo: number;
  margen: number;
  /** null cuando no hay ingreso base: el margen total no es calculable. */
  margenPorcentaje: number | null;
  lineasConCosto: number;
  lineasTotales: number;
  /** Ingreso de TODAS las líneas, con y sin costo: para mostrar cobertura por importe. */
  ingresoTotal: number;
  coberturaLineas: number | null; // 0..100
  coberturaImporte: number | null; // 0..100
  /** Costo de unidades devueltas que NO se repusieron: pérdida que no debe desaparecer (§6.4). */
  costoPerdidoSinReposicion: number;
}

/**
 * Margen estimado sobre importes CON impuestos, antes de comisiones y gastos (§6).
 * Solo entran al margen las líneas con costo conocido; el resto se informa como cobertura.
 * `unidadesSinReposicion` (por índice de línea) son devoluciones dañadas: su costo se pierde.
 */
export function calcularMargen(lineas: LineaAnalitica[], unidadesSinReposicion: number[] = []): Margen {
  let ingresoBase = 0;
  let costo = 0;
  let ingresoTotal = 0;
  let lineasConCosto = 0;
  let costoPerdidoSinReposicion = 0;
  lineas.forEach((l, i) => {
    ingresoTotal += l.importe;
    if (l.costoUnitario === null) return;
    lineasConCosto += 1;
    ingresoBase += l.importe;
    const unidadesNetas = l.unidades - l.unidadesDevueltas;
    costo += l.costoUnitario * unidadesNetas;
    const perdidas = unidadesSinReposicion[i] ?? 0;
    costoPerdidoSinReposicion += l.costoUnitario * perdidas;
  });
  const margen = ingresoBase - costo - costoPerdidoSinReposicion;
  return {
    ingresoBase,
    costo,
    margen,
    margenPorcentaje: ingresoBase > 0 ? (margen / ingresoBase) * 100 : null,
    lineasConCosto,
    lineasTotales: lineas.length,
    ingresoTotal,
    coberturaLineas: lineas.length > 0 ? (lineasConCosto / lineas.length) * 100 : null,
    coberturaImporte: ingresoTotal > 0 ? (ingresoBase / ingresoTotal) * 100 : null,
    costoPerdidoSinReposicion,
  };
}

/** Existencia de un producto en una ubicación, tal como la entrega `StockActual` (§7). */
export interface ExistenciaAnalitica {
  productoId: string;
  sku: string;
  nombre: string;
  ubicacionId: string;
  ubicacion: string;
  categoria: string | null;
  juego: string | null;
  activo: boolean;
  controlaStock: boolean;
  cantidad: number;
  costoReferencia: number | null;
  precioVenta: number | null;
}

export interface FilaInventario extends ExistenciaAnalitica {
  /** null si falta el costo: se muestran unidades y SKU sin valorizar, no un cero. */
  valorCosto: number | null;
  valorPrecio: number | null;
  diferenciaPotencial: number | null;
  calidad: 'completa' | 'sin_costo' | 'sin_precio' | 'negativo' | 'sin_control';
}

export interface ResumenInventario {
  valorCostoPositivo: number;
  valorPrecioPositivo: number;
  diferenciaPotencial: number;
  unidadesPositivas: number;
  skusConExistencia: number;
  unidadesSinCosto: number;
  skusSinCosto: number;
  unidadesNegativas: number;
  valorCostoNegativo: number;
  /** Suma algebraica del libro (positivos + negativos): concilia con `MovimientoStock`. */
  saldoAlgebraico: number;
  coberturaUnidades: number | null; // 0..100, unidades positivas con costo conocido
  coberturaSkus: number | null;
  skusSinControl: number;
}

/**
 * Valoriza existencias (§7). El negativo es una inconsistencia por resolver (pedido web pagado,
 * R-016): se muestra aparte y NUNCA se esconde con Math.max(0, cantidad).
 */
export function valorizarInventario(existencias: ExistenciaAnalitica[]): {
  filas: FilaInventario[];
  resumen: ResumenInventario;
} {
  const filas: FilaInventario[] = existencias.map((e) => {
    const valorCosto = e.costoReferencia === null ? null : e.cantidad * e.costoReferencia;
    const valorPrecio = e.precioVenta === null ? null : e.cantidad * e.precioVenta;
    const calidad: FilaInventario['calidad'] = !e.controlaStock
      ? 'sin_control'
      : e.cantidad < 0
        ? 'negativo'
        : e.costoReferencia === null
          ? 'sin_costo'
          : e.precioVenta === null
            ? 'sin_precio'
            : 'completa';
    return {
      ...e,
      valorCosto,
      valorPrecio,
      // Solo se compara costo con precio cuando se conocen AMBOS (§7).
      diferenciaPotencial: valorCosto === null || valorPrecio === null ? null : valorPrecio - valorCosto,
      calidad,
    };
  });

  const positivas = filas.filter((f) => f.cantidad > 0);
  const negativas = filas.filter((f) => f.cantidad < 0);
  const conCosto = positivas.filter((f) => f.costoReferencia !== null);
  const unidadesPositivas = positivas.reduce((a, f) => a + f.cantidad, 0);
  const unidadesConCosto = conCosto.reduce((a, f) => a + f.cantidad, 0);
  const skus = new Set(positivas.map((f) => f.productoId));
  const skusConCosto = new Set(conCosto.map((f) => f.productoId));
  const conAmbos = positivas.filter((f) => f.valorCosto !== null && f.valorPrecio !== null);

  return {
    filas,
    resumen: {
      valorCostoPositivo: conCosto.reduce((a, f) => a + (f.valorCosto ?? 0), 0),
      valorPrecioPositivo: positivas.reduce((a, f) => a + (f.valorPrecio ?? 0), 0),
      diferenciaPotencial: conAmbos.reduce((a, f) => a + (f.diferenciaPotencial ?? 0), 0),
      unidadesPositivas,
      skusConExistencia: skus.size,
      unidadesSinCosto: unidadesPositivas - unidadesConCosto,
      skusSinCosto: [...skus].filter((id) => !skusConCosto.has(id)).length,
      unidadesNegativas: negativas.reduce((a, f) => a + f.cantidad, 0),
      valorCostoNegativo: negativas.reduce((a, f) => a + (f.valorCosto ?? 0), 0),
      saldoAlgebraico: filas.reduce((a, f) => a + f.cantidad, 0),
      coberturaUnidades: unidadesPositivas > 0 ? (unidadesConCosto / unidadesPositivas) * 100 : null,
      coberturaSkus: skus.size > 0 ? (skusConCosto.size / skus.size) * 100 : null,
      skusSinControl: new Set(filas.filter((f) => !f.controlaStock).map((f) => f.productoId)).size,
    },
  };
}

/** Variación contra el período anterior. null cuando la base no es positiva (§5). */
export function variacionPorcentaje(actual: number, anterior: number): number | null {
  return anterior > 0 ? ((actual - anterior) / anterior) * 100 : null;
}
