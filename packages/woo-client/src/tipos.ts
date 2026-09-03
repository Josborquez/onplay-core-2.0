// Tipos mínimos de la API WooCommerce REST v3 usados por el importador (02-SDD §6).

export interface CategoriaWoo {
  id: number;
  name: string;
  slug: string;
  parent: number;
}

export interface CategoriaDeProductoWoo {
  id: number;
  name: string;
  slug: string;
}

export interface ImagenWoo {
  src: string;
}

export interface MetaDatoWoo {
  key: string;
  value: unknown;
}

export interface ProductoWoo {
  id: number;
  name: string;
  sku: string;
  type: string; // "simple" | "variable" | ...
  status: string;
  price: string;
  regular_price: string;
  sale_price?: string; // E3 §4.3: con oferta activa NO se toca el precio
  on_sale?: boolean;
  date_modified_gmt?: string;
  images: ImagenWoo[];
  categories: CategoriaDeProductoWoo[];
  meta_data: MetaDatoWoo[];
  variations: number[];
  // E2 §6.8 — espejo de solo lectura. Woo descuenta stock_quantity solo al pasar a pagado.
  manage_stock?: boolean;
  stock_quantity?: number | null;
  stock_status?: string; // instock | outofstock | onbackorder
}

/** Usuario de wc/v3/customers (E4 §7.3). El `id` ES el externoUserId de ClienteCanal. */
export interface UsuarioWoo {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  date_created: string;
  billing?: { phone?: string; email?: string };
}

export interface AtributoVariacionWoo {
  name: string;
  option: string;
}

export interface VariacionWoo {
  id: number;
  sku: string;
  price: string;
  regular_price: string;
  sale_price?: string;
  on_sale?: boolean;
  attributes: AtributoVariacionWoo[];
  image?: ImagenWoo | null;
  manage_stock?: boolean | 'parent';
  stock_quantity?: number | null;
  stock_status?: string;
}

// ─── Etapa 3 (docs/06-SDD §7 y §8) ─────────────────────────────────────────────

/** Único cuerpo que el maestro escribe en un producto o variación (§7.2: PUT acotado). */
export interface CambiosProductoWoo {
  regular_price?: string;
  stock_quantity?: number;
}

export interface LineaPedidoWoo {
  id: number;
  product_id: number;
  variation_id: number; // 0 si el producto es simple
  sku: string;
  name: string;
  quantity: number;
  price: number | string; // unitario neto (Woo lo manda con decimales)
  subtotal: string;
  total: string;
}

export interface ReembolsoResumenWoo {
  id: number;
  reason: string;
  total: string; // negativo
}

export interface PedidoWoo {
  id: number;
  number: string;
  status: string; // pending | processing | on-hold | completed | cancelled | refunded | failed
  total: string;
  currency: string;
  customer_id: number; // 0 = invitado
  billing?: { email?: string; first_name?: string; last_name?: string };
  date_created_gmt: string;
  date_modified_gmt: string;
  date_paid_gmt?: string | null;
  refunds: ReembolsoResumenWoo[];
  line_items: LineaPedidoWoo[];
}

/** Detalle de `orders/:id/refunds`: las cantidades por línea vienen NEGATIVAS. */
export interface ReembolsoWoo {
  id: number;
  reason: string;
  amount: string;
  date_created_gmt: string;
  line_items: { id: number; product_id: number; variation_id: number; quantity: number; total: string }[];
}
