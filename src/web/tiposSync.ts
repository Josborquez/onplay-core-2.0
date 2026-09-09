// Tipos de la Etapa 3 (docs/06-SDD §5 y §6) que usan V12, V13 y V14.

export type TipoDiscrepancia =
  | 'stock_derivado'
  | 'precio_derivado'
  | 'precio_en_oferta'
  | 'primera_publicacion'
  | 'producto_sin_mapear'
  | 'producto_desaparecido'
  | 'pedido_anulado'
  | 'pedido_sin_stock'
  | 'canal_sin_gestion';

export type EstadoDiscrepancia = 'abierta' | 'resuelta' | 'descartada';
export type TipoCorrida = 'pedidos' | 'precios' | 'stock' | 'adopcion';
export type EstadoCorrida = 'en_curso' | 'terminada' | 'abortada';

export const NOMBRE_CANAL: Record<string, string> = {
  onplay_cl: 'onplay.cl',
  onplaygames_cl: 'onplaygames.cl',
  tienda_fisica: 'Tienda física',
};

export const ETIQUETA_CORRIDA: Record<TipoCorrida, string> = {
  pedidos: 'Pedidos',
  precios: 'Precios',
  stock: 'Stock',
  adopcion: 'Adopción',
};

export interface CanalSync {
  id: string;
  nombre: string;
  tipo: string;
  activo: boolean;
  ingestaPedidos: boolean;
  pushPrecio: boolean;
  pushStock: boolean;
  ultimaIngestaEn: string | null;
  ultimoPushPrecioEn: string | null;
  ultimoPushStockEn: string | null;
  credenciales: boolean;
  ultimasCorridas: {
    tipo: TipoCorrida;
    estado: EstadoCorrida;
    simulacion: boolean;
    iniciadaEn: string;
    terminadaEn: string | null;
    leidos: number;
    escritos: number;
    detenidos: number;
    fallidos: number;
  }[];
}

export interface RespuestaCanales {
  soloLectura: boolean;
  ubicacionOnline: string;
  canales: CanalSync[];
}

export interface Contadores {
  leidos: number;
  aEscribir: number;
  escritos: number;
  omitidos: number;
  detenidos: number;
  fallidos: number;
}

export interface Corrida extends Contadores {
  id: string;
  canalId: string;
  tipo: TipoCorrida;
  estado: EstadoCorrida;
  simulacion: boolean;
  iniciadaEn: string;
  terminadaEn: string | null;
  mensaje: string | null;
  usuario: { nombre: string } | null;
  _count?: { items: number };
}

export interface ItemPlan {
  sku?: string;
  numero?: string;
  accion: string;
  motivo?: string;
  explicacion?: string;
  precio?: { maestro: number; canal: number | null; publicado: number | null };
  stock?: { maestro: number; canal: number | null; publicado: number | null };
}

export interface ResumenCorrida {
  corridaId: string;
  simulacion: boolean;
  tipo: string;
  canalId: string;
  resumen: Contadores;
  noElegibles?: number;
  omitida?: string;
  advertencia?: string;
  plan: ItemPlan[];
}

export interface ResumenCompleta {
  canalId: string;
  simulacion: boolean;
  pedidos: ResumenCorrida | { omitida: string };
  precios: ResumenCorrida | { omitida: string };
  stock: ResumenCorrida | { omitida: string };
}

export interface Discrepancia {
  id: string;
  canalId: string;
  tipo: TipoDiscrepancia;
  estado: EstadoDiscrepancia;
  valorMaestro: number | null;
  valorCanal: number | null;
  valorPublicado: number | null;
  vecesVista: number;
  vistaEn: string;
  detalle: string | null;
  creadaEn: string;
  resueltaEn: string | null;
  accionTomada: string | null;
  productoCanal: {
    id: string;
    externoId: number | null;
    externoSku: string | null;
    producto: { id: string; sku: string; nombre: string; controlaStock: boolean };
  } | null;
  pedidoCanal: { id: string; numero: string; estadoCanal: string; total: number } | null;
  pedidoCanalLinea: { id: string; descripcion: string; cantidad: number; cantidadDevuelta: number; externoSku: string | null } | null;
}

export interface RespuestaDiscrepancias {
  total: number;
  pagina: number;
  porPagina: number;
  abiertasPorTipo: Partial<Record<TipoDiscrepancia, number>>;
  titulos: Record<TipoDiscrepancia, string>;
  discrepancias: Discrepancia[];
}

export interface LineaPedido {
  id: string;
  externoItemId: number;
  externoSku: string | null;
  descripcion: string;
  cantidad: number;
  cantidadDevuelta: number;
  precioUnitario: number;
  productoId: string | null;
  producto: { id: string; sku: string; nombre: string; controlaStock: boolean } | null;
}

export interface PedidoOnline {
  id: string;
  canalId: string;
  externoId: number;
  numero: string;
  estadoCanal: string;
  total: number;
  montoReembolsado: number;
  clienteEmail: string | null;
  cliente: { id: string; nombre: string } | null;
  creadoEnCanal: string;
  ingeridoEn: string | null;
  lineas: LineaPedido[];
  discrepancias: { id: string; tipo: TipoDiscrepancia; pedidoCanalLineaId: string | null }[];
  sinMapear: number;
}

export interface RespuestaPedidos {
  total: number;
  pagina: number;
  porPagina: number;
  pedidos: PedidoOnline[];
}

export const ETIQUETA_ESTADO_PEDIDO: Record<string, string> = {
  processing: 'Pagado · en proceso',
  completed: 'Completado',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
  'on-hold': 'En espera',
  pending: 'Pendiente de pago',
  failed: 'Fallido',
};
