import type {
  CambiosProductoWoo,
  CategoriaWoo,
  PedidoWoo,
  ProductoWoo,
  ReembolsoWoo,
  UsuarioWoo,
  VariacionWoo,
} from './tipos.js';

export interface ConfigClienteWoo {
  url: string; // p.ej. https://onplaygames.cl
  ck: string;
  cs: string;
  /**
   * Candado de la Etapa 1 (02-SDD §11): mientras esté activo, cualquier
   * intento de POST/PUT/DELETE lanza una excepción ANTES de tocar la red.
   * Desactivarlo es una decisión de E3.
   */
  soloLectura: boolean;
  timeoutMs?: number;
}

export class ErrorEscrituraBloqueada extends Error {
  constructor(metodo: string, ruta: string) {
    super(
      `SYNC_SOLO_LECTURA: intento de ${metodo} ${ruta} bloqueado. ` +
        `La Etapa 1 es estrictamente de lectura (02-SDD §2, regla S1/S2).`,
    );
    this.name = 'ErrorEscrituraBloqueada';
  }
}

/**
 * Describe un error de la API de forma útil. Hostinger responde con HTML de un
 * WAF de LiteSpeed cuando algo va mal; eso no es JSON y hay que decirlo
 * (convención heredada del Binder OP, SDD general §5.2).
 */
export function describeError(status: number, cuerpo: string): string {
  const recorte = cuerpo.slice(0, 200).trim();
  if (recorte.startsWith('<')) {
    return `HTTP ${status}: respuesta HTML (posible WAF/LiteSpeed), no JSON`;
  }
  return `HTTP ${status}: ${recorte}`;
}

export class ClienteWoo {
  constructor(private readonly config: ConfigClienteWoo) {}

  /** Única puerta a la red. El candado de solo lectura se verifica aquí, primero. */
  async solicitar<T>(
    metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
    ruta: string,
    query: Record<string, string> = {},
    cuerpo?: unknown,
  ): Promise<T> {
    if (this.config.soloLectura && metodo !== 'GET') {
      throw new ErrorEscrituraBloqueada(metodo, ruta);
    }
    const url = new URL(`/wp-json/wc/v3/${ruta}`, this.config.url);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    url.searchParams.set('consumer_key', this.config.ck);
    url.searchParams.set('consumer_secret', this.config.cs);

    const res = await fetch(url, {
      method: metodo,
      headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 30000),
    });
    const texto = await res.text();
    if (!res.ok) throw new Error(describeError(res.status, texto));
    try {
      return JSON.parse(texto) as T;
    } catch {
      throw new Error(describeError(res.status, texto));
    }
  }

  /** Productos publicados, paginados de 100 en 100 (02-SDD §6.1). */
  async *paginarProductos(porPagina = 100): AsyncGenerator<ProductoWoo[]> {
    let pagina = 1;
    for (;;) {
      const lote = await this.solicitar<ProductoWoo[]>('GET', 'products', {
        status: 'publish',
        per_page: String(porPagina),
        page: String(pagina),
        orderby: 'id',
        order: 'asc',
      });
      if (lote.length === 0) return;
      yield lote;
      if (lote.length < porPagina) return;
      pagina += 1;
    }
  }

  /**
   * Productos modificados desde una fecha (02-SDD §6.5). `dates_are_gmt=true` es
   * OBLIGATORIO: sin él WooCommerce interpreta la fecha en la zona del sitio y,
   * con Chile en UTC−4/−3, cada corrida perdería o reprocesaría 3–4 horas.
   * Sin filtro de status: un producto pasado a borrador también "se modificó"
   * y hay que despublicarlo acá (ProductoCanal.publicado = false).
   */
  async *paginarProductosModificados(desdeIsoUtc: string, porPagina = 100): AsyncGenerator<ProductoWoo[]> {
    let pagina = 1;
    for (;;) {
      const lote = await this.solicitar<ProductoWoo[]>('GET', 'products', {
        status: 'any',
        modified_after: desdeIsoUtc,
        dates_are_gmt: 'true',
        per_page: String(porPagina),
        page: String(pagina),
        orderby: 'id',
        order: 'asc',
      });
      if (lote.length === 0) return;
      yield lote;
      if (lote.length < porPagina) return;
      pagina += 1;
    }
  }

  /**
   * Usuarios del canal por `wc/v3/customers` (E4 §7.3) — NUNCA `wp/v2/users`:
   * las mismas claves ck_/cs_ de solo lectura autentican aquí y el `id` que
   * devuelve es exactamente el `externoUserId` que espera ClienteCanal.
   */
  async *paginarClientes(porPagina = 100): AsyncGenerator<UsuarioWoo[]> {
    let pagina = 1;
    for (;;) {
      const lote = await this.solicitar<UsuarioWoo[]>('GET', 'customers', {
        per_page: String(porPagina),
        page: String(pagina),
        orderby: 'id',
        order: 'asc',
      });
      if (lote.length === 0) return;
      yield lote;
      if (lote.length < porPagina) return;
      pagina += 1;
    }
  }

  async listarVariaciones(productoId: number): Promise<VariacionWoo[]> {
    return this.solicitar<VariacionWoo[]>('GET', `products/${productoId}/variations`, {
      per_page: '100',
    });
  }

  /** Árbol completo de categorías del canal (para resolver ascendencia en el mapeo). */
  async listarCategorias(): Promise<CategoriaWoo[]> {
    const todas: CategoriaWoo[] = [];
    let pagina = 1;
    for (;;) {
      const lote = await this.solicitar<CategoriaWoo[]>('GET', 'products/categories', {
        per_page: '100',
        page: String(pagina),
      });
      todas.push(...lote);
      if (lote.length < 100) return todas;
      pagina += 1;
    }
  }

  // ─── Etapa 3 (docs/06-SDD §7 y §8) ───────────────────────────────────────────

  /**
   * Pedidos por estado modificados desde una marca (§8.1). `dates_are_gmt=true`
   * obligatorio (§6.4). `status` acepta lista separada por coma.
   */
  async *paginarPedidos(
    status: string,
    modificadosDesdeIsoUtc: string | null,
    porPagina = 100,
  ): AsyncGenerator<PedidoWoo[]> {
    let pagina = 1;
    for (;;) {
      const lote = await this.solicitar<PedidoWoo[]>('GET', 'orders', {
        status,
        ...(modificadosDesdeIsoUtc ? { modified_after: modificadosDesdeIsoUtc, dates_are_gmt: 'true' } : {}),
        per_page: String(porPagina),
        page: String(pagina),
        orderby: 'id',
        order: 'asc',
      });
      if (lote.length === 0) return;
      yield lote;
      if (lote.length < porPagina) return;
      pagina += 1;
    }
  }

  /** Reembolsos de un pedido con cantidades por línea (negativas) — §8.3. */
  async listarReembolsos(pedidoId: number): Promise<ReembolsoWoo[]> {
    return this.solicitar<ReembolsoWoo[]>('GET', `orders/${pedidoId}/refunds`, { per_page: '100' });
  }

  /**
   * Lectura de S_canal por listado (§7.5): hasta 100 ids por llamada con `include`,
   * nunca un GET por producto. Las variaciones van por `listarVariaciones(padre)`.
   */
  async listarProductosPorIds(ids: number[]): Promise<ProductoWoo[]> {
    if (ids.length === 0) return [];
    const todos: ProductoWoo[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const trozo = ids.slice(i, i + 100);
      todos.push(
        ...(await this.solicitar<ProductoWoo[]>('GET', 'products', {
          include: trozo.join(','),
          status: 'any',
          per_page: '100',
        })),
      );
    }
    return todos;
  }

  async obtenerProducto(id: number): Promise<ProductoWoo> {
    return this.solicitar<ProductoWoo>('GET', `products/${id}`);
  }

  async obtenerVariacion(padreId: number, id: number): Promise<VariacionWoo> {
    return this.solicitar<VariacionWoo>('GET', `products/${padreId}/variations/${id}`);
  }

  /**
   * PUT acotado (§7.2): solo `regular_price` y/o `stock_quantity`. El tipo del
   * parámetro impide mandar name, categories, images, meta_data o sale_price.
   * Pasa por el candado SYNC_SOLO_LECTURA como toda escritura.
   */
  async actualizarProducto(id: number, cambios: CambiosProductoWoo): Promise<ProductoWoo> {
    return this.solicitar<ProductoWoo>('PUT', `products/${id}`, {}, acotar(cambios));
  }

  async actualizarVariacion(padreId: number, id: number, cambios: CambiosProductoWoo): Promise<VariacionWoo> {
    return this.solicitar<VariacionWoo>('PUT', `products/${padreId}/variations/${id}`, {}, acotar(cambios));
  }
}

/** Deja pasar únicamente los dos campos permitidos, aunque el llamador mande más. */
function acotar(cambios: CambiosProductoWoo): CambiosProductoWoo {
  const salida: CambiosProductoWoo = {};
  if (cambios.regular_price !== undefined) salida.regular_price = cambios.regular_price;
  if (cambios.stock_quantity !== undefined) salida.stock_quantity = cambios.stock_quantity;
  return salida;
}
