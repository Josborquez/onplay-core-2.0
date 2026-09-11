// Tipos de la Etapa 6 (docs/11-SDD §5 y §7) que usa la pantalla de Compras.

export type LectorFactura = 'manual' | 'andina' | 'nico' | 'nico_factura' | 'coqui' | 'devir' | 'asmodee';
export type Moneda = 'CLP' | 'USD';
export type EstadoCompra = 'borrador' | 'recibida' | 'anulada';
export type TipoDocumentoCompra = 'factura' | 'boleta' | 'guia' | 'otro';

export const ETIQUETA_TIPO_DOC: Record<TipoDocumentoCompra, string> = {
  factura: 'Factura',
  boleta: 'Boleta',
  guia: 'Guía',
  otro: 'Otro',
};

export const ETIQUETA_ESTADO_COMPRA: Record<EstadoCompra, { texto: string; tono: 'alerta' | 'ok' | 'neutro' }> = {
  borrador: { texto: 'borrador', tono: 'alerta' },
  recibida: { texto: 'recibida', tono: 'ok' },
  anulada: { texto: 'anulada', tono: 'neutro' },
};

export interface Proveedor {
  id: string;
  nombre: string;
  rut: string | null;
  lector: LectorFactura;
  activo: boolean;
  notas: string | null;
  compras?: number;
  productosVinculados?: number;
}

export interface OpcionLector {
  clave: LectorFactura;
  nombre: string;
}

export interface ProductoCompra {
  id: string;
  sku: string;
  nombre: string;
  controlaStock: boolean;
  costoReferencia: number | null;
  precioVenta: number;
  tipo: string;
}

export interface LineaCompra {
  id: string;
  orden: number;
  codigoProveedor: string | null;
  descripcion: string;
  productoId: string | null;
  producto: ProductoCompra | null;
  bultos: number;
  unidadesPorBulto: number;
  sueltas: number;
  cantidad: number;
  neto: number;
  impuestos: number;
  total: number;
  costoUnitario: number;
  totalOriginal?: number | null;
  movimientoId: string | null;
  stockVigente?: number | null;
}

export interface CompraResumen {
  id: string;
  proveedor: { id: string; nombre: string };
  tipoDocumento: TipoDocumentoCompra;
  numeroDocumento: string;
  fechaDocumento: string;
  estado: EstadoCompra;
  origen: string;
  total: number;
  usuario: { nombre: string };
  totalLineas: number;
  sinVincular: number;
  unidades: number;
  creadoEn: string;
}

/** C12b — importación (11-SDD §6.7). */
export type TipoGastoImportacion = 'agente' | 'courier' | 'seguro' | 'otro';

export const ETIQUETA_TIPO_GASTO: Record<TipoGastoImportacion, string> = {
  agente: 'Agente de aduanas',
  courier: 'Courier (UPS, DHL…)',
  seguro: 'Seguro (póliza real)',
  otro: 'Otro',
};

export interface CompraGasto {
  id: string;
  tipo: TipoGastoImportacion;
  descripcion: string;
  montoNeto: number;
  iva: number;
  documento: string | null;
  fecha: string | null;
}

export interface ResumenImportacion {
  costoPuesto: number;
  ivaRecuperable: number;
  desembolso: number;
  fobClp: number | null;
  sobreFobPct: number | null;
  gastosNetos: number;
  ivaGastos: number;
  cuadre: { lineas: number; din: number; difiere: boolean } | null;
}

export interface ItemDin {
  numero: number;
  codigo: string;
  cif: number;
  arancel: number | null;
  iva: number | null;
  cantidad: number | null;
  fobUnitario: number | null;
}

export interface DinLeida {
  numero: string | null;
  fechaAceptacion: string | null;
  tipoCambio: number | null;
  fob: number | null;
  flete: number | null;
  seguro: number | null;
  cif: number | null;
  arancelPct: number | null;
  arancelOriginal: number | null;
  ivaOriginal: number | null;
  totalGiroOriginal: number | null;
  totalGiro: number | null;
  despachador: string | null;
  consignante: string | null;
  items: ItemDin[];
  advertencias: string[];
}

export interface CalculoImportacion {
  seguro: number;
  seguroPresunto: boolean;
  cif: number;
  arancelPct: number;
  arancelOriginal: number;
  ivaOriginal: number;
  totalGiroOriginal: number;
  arancel: number;
  ivaImportacion: number;
  totalGiro: number;
}

export interface CompraDetalle {
  id: string;
  proveedor: { id: string; nombre: string; rut: string | null; lector: LectorFactura };
  ubicacion: { id: string; codigo: string; nombre: string };
  tipoDocumento: TipoDocumentoCompra;
  numeroDocumento: string;
  fechaDocumento: string;
  estado: EstadoCompra;
  origen: string;
  lector: LectorFactura;
  archivoNombre: string | null;
  moneda: Moneda;
  tipoCambio: number | null;
  gastosExtra: number;
  totalOriginal: number | null;
  neto: number;
  impuestos: number;
  total: number;
  advertencias: string[] | null;
  nota: string | null;
  usuario: { nombre: string };
  recibidaPor: { nombre: string } | null;
  recibidaEn: string | null;
  creadoEn: string;
  lineas: LineaCompra[];
  // C12b (solo con sentido si moneda ≠ CLP)
  fob: number | null;
  flete: number | null;
  seguro: number | null;
  cif: number | null;
  arancelPct: number | null;
  tipoCambioAduana: number | null;
  arancel: number | null;
  ivaImportacion: number | null;
  dinNumero: string | null;
  dinFecha: string | null;
  gastos: CompraGasto[];
  resumenImportacion: ResumenImportacion | null;
}

/** Lo que devuelve POST /compras/leer: una propuesta que la persona revisa antes de guardar. */
export interface LineaPropuesta {
  orden: number;
  codigoProveedor: string | null;
  descripcion: string;
  bultos: number;
  unidadesPorBulto: number;
  sueltas: number;
  cantidad: number;
  neto: number;
  impuestos: number;
  total: number;
  costoUnitario: number;
  totalOriginal?: number | null;
  productoId: string | null;
  producto: ProductoCompra | null;
  aprendida: boolean;
}

export interface Lectura {
  lector: LectorFactura;
  lectorNombre: string;
  archivoNombre: string | null;
  proveedor: Proveedor | null;
  proveedorSugerido: { nombre: string; rut: string | null; lector: LectorFactura } | null;
  tipoDocumento: TipoDocumentoCompra;
  numeroDocumento: string | null;
  fechaDocumento: string | null;
  moneda: Moneda;
  tipoCambio: number | null;
  gastosExtra: number;
  totalOriginal: number | null;
  requiereTipoCambio: boolean;
  lineas: LineaPropuesta[];
  totales: { neto: number; impuestos: number; total: number; sumaLineas: { neto: number; impuestos: number; total: number } };
  advertencias: string[];
  yaCargada: { id: string; estado: EstadoCompra } | null;
  sinVincular: number;
}

export interface ResultadoBusquedaProducto {
  id: string;
  sku: string;
  nombre: string;
  precioVenta: number;
  controlaStock?: boolean;
}
