export { rolAlcanza, type Rol } from './roles.js';
export {
  skuMaestroDesdeExterno,
  formatearSkuCorrelativo,
  PREFIJO_POR_TIPO,
  type TipoProducto,
} from './sku.js';
export { normalizarNombre, preciosSimilares } from './duplicados.js';
export {
  validarYCalcularVenta,
  calcularArqueo,
  type MedioPago,
  type LineaEntrada,
  type PagoEntrada,
  type CalculoVenta,
  type ErrorVenta,
  type Arqueo,
  type ExtrasArqueo,
} from './venta.js';
export { normalizarRut, calcularDvRut } from './rut.js';
export {
  calcularSaldo,
  validarPagoMonedero,
  validarMovimientoManual,
  type MotivoMonedero,
  type ErrorPagoMonedero,
  type ErrorMovimientoManual,
} from './monedero.js';
export {
  nombreBusquedaCliente,
  detectarDuplicadosCliente,
  type ConfianzaDuplicado,
  type ClienteComparable,
  type DuplicadoCliente,
} from './cliente.js';
// E2 — docs/03-SDD-etapa2-inventario.md §6
export {
  validarMovimientoStock,
  firmarCantidadManual,
  aplicarMovimiento,
  estadoStock,
  avisoWeb,
  cerrarRecuento,
  MOTIVOS_MANUALES,
  MOTIVOS_CON_NOTA,
  type MotivoStock,
  type MovimientoStockEntrada,
  type ErrorMovimientoStock,
  type EstadoStock,
  type NivelAvisoWeb,
  type LineaRecuentoCierre,
  type MovimientoDeCierre,
} from './stock.js';
export {
  validarDevolucion,
  prorratearDescuento,
  formatearFolioDevolucion,
  type LineaVendida,
  type LineaADevolver,
  type VentaParaDevolver,
  type ErrorDevolucion,
  type LineaDevolucionCalculada,
  type CalculoDevolucion,
} from './devolucion.js';
// E3 — docs/06-SDD-etapa3-sincronizacion.md §4 y §8
export {
  decidirPushStock,
  decidirPushPrecio,
  explicarDeriva,
  pedidoPagado,
  pedidoAnulado,
  devueltasPorLinea,
  montoDesdeWoo,
  ESTADOS_PAGADOS,
  ESTADOS_ANULADOS,
  type AccionPush,
  type DecisionStock,
  type DecisionPrecio,
  type EntradaDecisionStock,
  type EntradaDecisionPrecio,
} from './sync.js';
