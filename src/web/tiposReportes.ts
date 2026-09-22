// Tipos de R-036 (docs/14): análisis comercial por canal e inventario valorizado.
// Regla que atraviesa todo el módulo: `null` significa DESCONOCIDO o NO CALCULABLE.
// Nunca se muestra 0 en su lugar.

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
  /** null → «No calculable» (el denominador no es positivo). */
  aportePorcentaje: number | null;
  /** null → «—» (no hubo operaciones). */
  ticketPromedio: number | null;
  operacionesOtraMoneda: number;
}

export interface Consolidado {
  filas: FilaCanal[];
  total: FilaCanal;
}

export interface CanalResumen {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface PuntoEvolucion {
  periodo: string;
  canalId: string;
  importeAjustado: number;
  operaciones: number;
}

export interface FilaCategoria {
  canalId: string;
  categoriaId: string | null;
  categoria: string;
  unidadesNetas: number;
  importe: number;
  porcentaje: number | null;
}

export interface Margen {
  ingresoBase: number;
  costo: number;
  margen: number;
  /** null → el margen no es calculable (ninguna línea con costo conocido). */
  margenPorcentaje: number | null;
  lineasConCosto: number;
  lineasTotales: number;
  ingresoTotal: number;
  coberturaLineas: number | null;
  coberturaImporte: number | null;
  costoPerdidoSinReposicion: number;
  /** true = costo de HOY imputado a líneas sin costo congelado; se dice en pantalla. */
  estimadoACostoActual: boolean;
}

export interface CoberturaCanal {
  canalId: string;
  nombre: string;
  activo: boolean;
  primeraFecha: string | null;
  ultimaFecha: string | null;
  ultimaIngestaEn: string | null;
  operacionesEnPeriodo: number;
  /** true → «Sin datos suficientes», jamás «$0 vendido». */
  sinDatos: boolean;
  erroresAbiertos: number;
}

export interface ReporteCanales {
  desde: string;
  hasta: string;
  agrupar: Agrupar;
  consultadoEn: string;
  criterio: string;
  consolidado: Consolidado;
  canales: CanalResumen[];
  evolucion: PuntoEvolucion[];
  categorias: FilaCategoria[];
  margen: Margen;
  /** Importe de pedidos web que no está en ninguna línea (envío, cargos): se informa aparte. */
  noAtribuible: number;
  desglose: { impuestos: number | null; envio: number | null; descuentos: number | null };
  cobertura: CoberturaCanal[];
  filtrado: boolean;
  anterior?: { desde: string; hasta: string; consolidado: Consolidado };
}

export type Agrupar = 'dia' | 'semana' | 'mes';

export type CalidadFila = 'completa' | 'sin_costo' | 'sin_precio' | 'negativo' | 'sin_control';

export interface FilaInventario {
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
  /** null = costo desconocido (no es cero). */
  costoReferencia: number | null;
  precioVenta: number | null;
  valorCosto: number | null;
  valorPrecio: number | null;
  diferenciaPotencial: number | null;
  calidad: CalidadFila;
}

export interface ResumenInventario {
  valorCostoPositivo: number;
  valorPrecioPositivo: number;
  diferenciaPotencial: number;
  unidadesPositivas: number;
  skusConExistencia: number;
  unidadesSinCosto: number;
  skusSinCosto: number;
  /** Negativo: es una inconsistencia por resolver, no un activo. */
  unidadesNegativas: number;
  valorCostoNegativo: number;
  saldoAlgebraico: number;
  coberturaUnidades: number | null;
  coberturaSkus: number | null;
  skusSinControl: number;
}

export interface ReporteInventario {
  cortadoEn: string;
  medida: string;
  filas: FilaInventario[];
  resumen: ResumenInventario;
  sinControl: { productos: number; skus: string[] };
  ubicaciones: { id: string; nombre: string; activa: boolean }[];
}

export type MarcaInventario = 'sin_costo' | 'negativos' | 'inactivos' | 'bajo_stock' | 'sin_control';

export interface CalidadDatos {
  consultadoEn: string;
  criterio: string;
  cobertura: CoberturaCanal[];
  margen: { coberturaLineas: number | null; coberturaImporte: number | null; lineasConCosto: number; lineasTotales: number };
  inventario: {
    coberturaUnidades: number | null;
    coberturaSkus: number | null;
    skusSinCosto: number;
    unidadesNegativas: number;
    skusSinControl: number;
  };
  noAtribuible: number;
  operacionesEnRevision: number;
  operacionesOtraMoneda: number;
  /** Lo que falta cargar para cerrar cobertura: se enumera, no se da por hecho. */
  pendientes: string[];
}

/** `48,3 %` · null → el texto que corresponda («No calculable», «—»). */
export function pct(v: number | null, sinDato = 'No calculable'): string {
  return v === null ? sinDato : `${v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

export const ETIQUETA_CALIDAD: Record<CalidadFila, { texto: string; tono: 'neutro' | 'ok' | 'alerta' | 'peligro' }> = {
  completa: { texto: 'Con costo y precio', tono: 'ok' },
  sin_costo: { texto: 'Sin costo', tono: 'alerta' },
  sin_precio: { texto: 'Sin precio', tono: 'alerta' },
  negativo: { texto: 'Negativo', tono: 'peligro' },
  sin_control: { texto: 'Sin control', tono: 'neutro' },
};
