// Importador de catálogo F1 — 02-SDD §6.
// dryRun=true por defecto (regla S1): no escribe productos ni reserva correlativos.
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  PREFIJO_POR_TIPO,
  formatearSkuCorrelativo,
  normalizarNombre,
  preciosSimilares,
  skuMaestroDesdeExterno,
  type TipoProducto,
} from '@onplay/dominio';
import {
  ClienteWoo,
  type CategoriaDeProductoWoo,
  type CategoriaWoo,
  type MetaDatoWoo,
  type ProductoWoo,
} from '@onplay/woo-client';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import { mapearOnplay, mapearOnplaygames, type ResultadoMapeo } from './mapeo.js';
import {
  CLAVE_PADRE_EXTERNO,
  CLAVE_VARIANTE,
  codigoBarrasDesdeSku,
  nombreDeVariacion,
  textoDeVariante,
} from './variaciones.js';

export type CanalWoo = 'onplay_cl' | 'onplaygames_cl';

/**
 * Un error de sync ya ABIERTO con el mismo canal y detalle no se vuelve a registrar: cada
 * corrida completa repetia los mismos 11 errores conocidos y el criterio 2 de 02 §10
 * («SyncLog abiertos → 0») se volvia inalcanzable. Marcarlo resuelto lo deja reaparecer.
 */
async function registrarErrorSync(canalId: string, operacion: string, detalle: string): Promise<void> {
  const abierto = await prisma.syncLog.findFirst({
    where: { canalId, resultado: 'error', resuelto: false, detalle },
    select: { id: true },
  });
  if (abierto) return;
  await prisma.syncLog.create({ data: { canalId, operacion, resultado: 'error', detalle } });
}
export const CANALES_WOO: CanalWoo[] = ['onplay_cl', 'onplaygames_cl'];

export interface ErrorImportacion {
  externoId: number | null;
  externoSku: string | null;
  nombre: string;
  detalle: string;
}

export interface ResumenImportacion {
  canalId: CanalWoo;
  dryRun: boolean;
  procesados: number;
  creados: number;
  actualizados: number;
  omitidos: number;
  sinPrecio: number;
  sinClasificar: number;
  duplicadosMarcados: number;
  errores: ErrorImportacion[];
  duracionMs: number;
}

// ---------- extracción de meta_data (§6.2: whitelist, todo lo demás se descarta) ----------

const CLAVES_CODIGO_BARRAS = new Set(['barcode', 'ean', 'ean13', 'gtin', 'global_unique_id']);
const ATRIBUTOS_PERMITIDOS = new Set([
  // formas conocidas de §4.2
  'set_code', 'set_full_code', 'rarity', 'rarity_code', 'is_foil', 'is_alt_art',
  'color', 'card_type', 'condicion', 'idioma', 'scryfall_id', 'formato', 'sabor',
]);

interface MetaExtraida {
  cardNumber: string | null;
  codigoBarras: string | null;
  atributos: Record<string, string> | null;
}

function extraerMeta(meta: MetaDatoWoo[]): MetaExtraida {
  let cardNumber: string | null = null;
  let codigoBarras: string | null = null;
  const atributos: Record<string, string> = {};
  for (const m of meta) {
    const clave = m.key.replace(/^_/, '').toLowerCase();
    const valor =
      typeof m.value === 'string' || typeof m.value === 'number' ? String(m.value).trim() : '';
    if (!valor) continue;
    if (clave === 'card_number') cardNumber = valor;
    else if (CLAVES_CODIGO_BARRAS.has(clave)) codigoBarras = valor;
    else if (ATRIBUTOS_PERMITIDOS.has(clave)) atributos[clave] = valor;
  }
  return {
    cardNumber,
    codigoBarras,
    atributos: Object.keys(atributos).length > 0 ? atributos : null,
  };
}

// ---------- regla de precio (§6.2, crítica): price efectivo → regular_price → sin precio ----------

function parsearPrecio(price: string, regularPrice: string): number | null {
  for (const crudo of [price, regularPrice]) {
    const n = Number(crudo);
    if (crudo !== '' && Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

// ---------- expansión: un producto WooCommerce → 1..N ítems importables ----------

interface ItemImportable {
  externoId: number;
  externoSku: string | null;
  nombre: string;
  precio: number;
  sinPrecio: boolean;
  imagenUrl: string | null;
  mapeo: ResultadoMapeo;
  meta: MetaExtraida;
  /** E2 §6.8: espejo de solo lectura del stock del canal. null = el canal no lo informa. */
  stockCanal: number | null;
  manejaStockCanal: boolean;
}

/** Espejo del stock del canal (E2 §6.8). Una variación con manage_stock = 'parent' hereda del padre. */
function espejoStock(
  p: { manage_stock?: boolean; stock_quantity?: number | null; stock_status?: string },
  v?: { manage_stock?: boolean | 'parent'; stock_quantity?: number | null; stock_status?: string },
): { stockCanal: number | null; manejaStockCanal: boolean } {
  const fuente = v && v.manage_stock !== 'parent' && v.manage_stock !== undefined ? v : p;
  const maneja = fuente.manage_stock === true;
  if (maneja && typeof fuente.stock_quantity === 'number') return { stockCanal: fuente.stock_quantity, manejaStockCanal: true };
  // Sin gestión de cantidad, Woo solo dice instock/outofstock: se refleja como 0 o null.
  const estado = v?.stock_status ?? p.stock_status;
  return { stockCanal: estado === 'outofstock' ? 0 : null, manejaStockCanal: false };
}

async function construirItems(
  p: ProductoWoo,
  cliente: ClienteWoo,
  mapear: (cats: CategoriaDeProductoWoo[]) => ResultadoMapeo,
): Promise<ItemImportable[]> {
  const mapeo = mapear(p.categories ?? []);
  const meta = extraerMeta(p.meta_data ?? []);
  const imagenPadre = p.images?.[0]?.src ?? null;

  // §6.2 regla 3: variables → un producto POR VARIACIÓN, con la categoría y tipo del padre.
  if (p.type === 'variable') {
    const variaciones = await cliente.listarVariaciones(p.id);
    return variaciones.map((v) => {
      const precio = parsearPrecio(v.price, v.regular_price);
      const opciones = (v.attributes ?? []).map((a) => a.option).filter(Boolean);
      const externoSku = v.sku || `${p.sku || String(p.id)}-V${v.id}`;
      // R-003: cada variación recuerda a su padre y su variante limpia (E2/E3 lo necesitan).
      const atributos: Record<string, string> = {
        ...(meta.atributos ?? {}),
        [CLAVE_PADRE_EXTERNO]: String(p.id),
      };
      const variante = opciones.map((o) => textoDeVariante(p.name, o)).join(' / ');
      if (variante) atributos[CLAVE_VARIANTE] = variante;
      return {
        externoId: v.id,
        externoSku,
        nombre: nombreDeVariacion(p.name, opciones), // R-001: sin repetir el padre
        precio: precio ?? 0,
        sinPrecio: precio === null,
        imagenUrl: v.image?.src ?? imagenPadre,
        mapeo,
        meta: {
          ...meta,
          // R-002: el SKU de la variación suele ser el EAN del fabricante.
          codigoBarras: meta.codigoBarras ?? codigoBarrasDesdeSku(v.sku),
          atributos,
        },
        ...espejoStock(p, v),
      };
    });
  }

  const precio = parsearPrecio(p.price, p.regular_price);
  return [
    {
      externoId: p.id,
      externoSku: p.sku || null,
      nombre: p.name,
      precio: precio ?? 0,
      sinPrecio: precio === null,
      imagenUrl: imagenPadre,
      mapeo,
      meta: { ...meta, codigoBarras: meta.codigoBarras ?? codigoBarrasDesdeSku(p.sku) },
      ...espejoStock(p),
    },
  ];
}

// ---------- reserva de correlativos SKU (§6.4) ----------
// En dryRun se simula con contadores en memoria sembrados desde la base:
// una simulación NUNCA debe consumir folios reales.

export class ReservadorSku {
  private contadores = new Map<string, number>();

  constructor(private readonly dryRun: boolean) {}

  async reservar(tipo: TipoProducto): Promise<string> {
    const anio = new Date().getFullYear();
    const prefijo = PREFIJO_POR_TIPO[tipo];
    const clave = tipo === 'evento' ? `sku_${prefijo}_${anio}` : `sku_${prefijo}`;

    let numero: number;
    if (this.dryRun) {
      if (!this.contadores.has(clave)) {
        const fila = await prisma.correlativo.findUnique({ where: { clave } });
        this.contadores.set(clave, fila?.ultimo ?? 0);
      }
      numero = (this.contadores.get(clave) ?? 0) + 1;
      this.contadores.set(clave, numero);
    } else {
      await prisma.correlativo.upsert({
        where: { clave },
        create: { clave, anio, ultimo: 0 },
        update: {},
      });
      const fila = await prisma.correlativo.update({
        where: { clave },
        data: { ultimo: { increment: 1 } },
      });
      numero = fila.ultimo;
    }
    return formatearSkuCorrelativo(tipo, numero, anio);
  }
}

// ---------- upsert de un ítem ----------

/** Hash de los campos que la sincronización mantiene (§6.5): si no cambió, se omite. */
function hashDeSync(item: ItemImportable): string {
  return createHash('sha1')
    .update(
      JSON.stringify([
        item.nombre,
        item.precio,
        item.imagenUrl,
        // R-002/R-003: entran al hash para que una corrida completa los rellene
        // en productos ya importados (solo se completan si faltan, nunca se pisan).
        item.meta.codigoBarras,
        item.meta.atributos?.[CLAVE_PADRE_EXTERNO] ?? null,
        item.meta.atributos?.[CLAVE_VARIANTE] ?? null,
        // E2 §6.8 (criterio 10): un cambio SOLO de stock en Woo también refresca el espejo.
        item.stockCanal,
        item.manejaStockCanal,
      ]),
    )
    .digest('hex');
}

/**
 * Datos que una actualización COMPLETA si faltan, sin pisar correcciones manuales (§6.5):
 * `codigoBarras` solo si está vacío; en `atributos` solo las claves de variación ausentes.
 */
function completarFaltantes(
  actual: { codigoBarras: string | null; atributos: Prisma.JsonValue },
  item: ItemImportable,
): { codigoBarras?: string; atributos?: Prisma.InputJsonValue } {
  const data: { codigoBarras?: string; atributos?: Prisma.InputJsonValue } = {};
  if (!actual.codigoBarras && item.meta.codigoBarras) data.codigoBarras = item.meta.codigoBarras;

  const existentes =
    actual.atributos && typeof actual.atributos === 'object' && !Array.isArray(actual.atributos)
      ? (actual.atributos as Record<string, unknown>)
      : {};
  const nuevos: Record<string, unknown> = { ...existentes };
  let cambio = false;
  for (const clave of [CLAVE_PADRE_EXTERNO, CLAVE_VARIANTE]) {
    const valor = item.meta.atributos?.[clave];
    if (valor && !(clave in existentes)) {
      nuevos[clave] = valor;
      cambio = true;
    }
  }
  if (cambio) data.atributos = nuevos as Prisma.InputJsonValue;
  return data;
}

interface ContextoImportacion {
  canalId: CanalWoo;
  dryRun: boolean;
  categoriaPorSlug: Map<string, string>;
  reservador: ReservadorSku;
  /** SKUs generados en esta corrida (necesario en dryRun, donde no se persiste nada). */
  skusVistos: Set<string>;
  /** SKUs EXTERNOS vistos en esta corrida: detecta SKUs duplicados en el origen. */
  externoSkusVistos: Set<string>;
}

async function procesarItem(
  item: ItemImportable,
  ctx: ContextoImportacion,
): Promise<'creado' | 'actualizado' | 'omitido'> {
  const { canalId, dryRun } = ctx;
  const hash = hashDeSync(item);

  // SKU externo repetido DENTRO de la corrida = SKUs duplicados en el origen.
  // No se fusionan silenciosamente: error para revisión manual (mismo criterio que §6.4).
  if (item.externoSku && ctx.externoSkusVistos.has(item.externoSku)) {
    throw new Error(
      `externoSku duplicado en el origen: "${item.externoSku}" ya lo usa otro producto de esta corrida`,
    );
  }
  if (item.externoSku) ctx.externoSkusVistos.add(item.externoSku);

  // Prioridad de búsqueda: externoId, luego externoSku (re-corridas y productos re-creados en Woo).
  let pc = await prisma.productoCanal.findUnique({
    where: { canalId_externoId: { canalId, externoId: item.externoId } },
  });
  if (!pc && item.externoSku) {
    pc = await prisma.productoCanal.findUnique({
      where: { canalId_externoSku: { canalId, externoSku: item.externoSku } },
    });
  }

  if (pc) {
    if (pc.hashUltimoSync === hash) return 'omitido';
    // §6.5: solo nombre, precio, imagen y publicado. No tocar tipo/categoría/atributos
    // (evita revertir correcciones manuales). Excepción acotada (R-002/R-003): se COMPLETAN
    // codigoBarras y las claves de variación cuando faltan; nunca se sobrescriben.
    if (!dryRun) {
      const actual = await prisma.producto.findUniqueOrThrow({
        where: { id: pc.productoId },
        select: { codigoBarras: true, atributos: true },
      });
      await prisma.$transaction([
        prisma.producto.update({
          where: { id: pc.productoId },
          data: {
            nombre: item.nombre,
            precioVenta: item.precio,
            imagenUrl: item.imagenUrl,
            ...completarFaltantes(actual, item),
          },
        }),
        prisma.productoCanal.update({
          where: { id: pc.id },
          data: {
            externoId: item.externoId,
            externoSku: item.externoSku,
            publicado: true,
            sincronizadoEn: new Date(),
            hashUltimoSync: hash,
            stockCanal: item.stockCanal,
            manejaStockCanal: item.manejaStockCanal,
            stockCanalEn: new Date(),
          },
        }),
      ]);
    }
    return 'actualizado';
  }

  // Producto nuevo: SKU maestro directo (§6.4 formas OP/MTG) o correlativo por tipo.
  const sku =
    skuMaestroDesdeExterno(item.externoSku) ?? (await ctx.reservador.reservar(item.mapeo.tipo));
  if (ctx.skusVistos.has(sku)) {
    throw new Error(`SKU maestro duplicado en la corrida: ${sku} (externo ${item.externoId})`);
  }
  const existente = await prisma.producto.findUnique({ where: { sku }, select: { id: true } });
  if (existente) {
    // §6.4: no se sobrescribe; error y el producto queda sin importar.
    throw new Error(
      `SKU maestro duplicado: ${sku} ya existe (producto ${existente.id}); externo ${item.externoId}`,
    );
  }
  ctx.skusVistos.add(sku);

  if (!dryRun) {
    const categoriaId =
      ctx.categoriaPorSlug.get(item.mapeo.categoriaSlug) ??
      ctx.categoriaPorSlug.get('sin-clasificar') ??
      null;
    await prisma.producto.create({
      data: {
        sku,
        nombre: item.nombre,
        tipo: item.mapeo.tipo,
        juego: item.mapeo.juego,
        categoriaId,
        precioVenta: item.precio,
        controlaStock: false, // siempre en E1 (§6.2)
        activo: item.mapeo.activo && !item.sinPrecio, // §6.2 regla 4 y eventos §6.3
        imagenUrl: item.imagenUrl,
        codigoBarras: item.meta.codigoBarras,
        cardNumber: item.meta.cardNumber,
        atributos: item.meta.atributos ?? undefined,
        canales: {
          create: {
            canalId,
            externoId: item.externoId,
            externoSku: item.externoSku,
            publicado: true,
            sincronizadoEn: new Date(),
            hashUltimoSync: hash,
            stockCanal: item.stockCanal,
            manejaStockCanal: item.manejaStockCanal,
            stockCanalEn: new Date(),
          },
        },
      },
    });
  }
  return 'creado';
}

// ---------- detección de duplicados entre canales (§6.6, parte del importador) ----------

export async function marcarDuplicados(): Promise<number> {
  const productos = await prisma.producto.findMany({
    where: { activo: true },
    select: {
      id: true,
      nombre: true,
      precioVenta: true,
      posibleDuplicado: true,
      canales: { select: { canalId: true } },
    },
  });

  const porNombre = new Map<string, typeof productos>();
  for (const p of productos) {
    const clave = normalizarNombre(p.nombre);
    if (!clave) continue;
    const grupo = porNombre.get(clave);
    if (grupo) grupo.push(p);
    else porNombre.set(clave, [p]);
  }

  const aMarcar = new Set<string>();
  for (const grupo of porNombre.values()) {
    for (let i = 0; i < grupo.length; i++) {
      for (let j = i + 1; j < grupo.length; j++) {
        const a = grupo[i]!;
        const b = grupo[j]!;
        const canalesA = new Set(a.canales.map((c) => c.canalId));
        const canalDistinto = b.canales.some((c) => !canalesA.has(c.canalId));
        if (canalDistinto && preciosSimilares(a.precioVenta, b.precioVenta)) {
          aMarcar.add(a.id);
          aMarcar.add(b.id);
        }
      }
    }
  }

  const yaMarcados = new Set(productos.filter((p) => p.posibleDuplicado).map((p) => p.id));
  const nuevos = [...aMarcar].filter((id) => !yaMarcados.has(id));
  if (nuevos.length > 0) {
    await prisma.producto.updateMany({
      where: { id: { in: nuevos } },
      data: { posibleDuplicado: true },
    });
  }
  return nuevos.length;
}

// ---------- corrida completa ----------

export async function importarCanal(
  canalId: CanalWoo,
  opciones: { dryRun: boolean },
): Promise<ResumenImportacion> {
  const inicio = Date.now();
  const { dryRun } = opciones;
  const cfg = entorno.canales[canalId];
  if (!cfg.url || !cfg.ck || !cfg.cs) {
    throw new Error(`Canal ${canalId} sin credenciales configuradas (WOO_*).`);
  }

  const cliente = new ClienteWoo({
    url: cfg.url,
    ck: cfg.ck,
    cs: cfg.cs,
    soloLectura: entorno.syncSoloLectura,
  });

  const categorias = await prisma.categoria.findMany({ select: { id: true, slug: true } });
  const ctx: ContextoImportacion = {
    canalId,
    dryRun,
    categoriaPorSlug: new Map(categorias.map((c) => [c.slug, c.id])),
    reservador: new ReservadorSku(dryRun),
    skusVistos: new Set(),
    externoSkusVistos: new Set(),
  };

  // El árbol del canal solo hace falta en onplay.cl (ascendencia de one-piece-tcg, §6.3).
  let arbol = new Map<number, CategoriaWoo>();
  if (canalId === 'onplay_cl') {
    arbol = new Map((await cliente.listarCategorias()).map((c) => [c.id, c]));
  }
  const mapear = (cats: CategoriaDeProductoWoo[]): ResultadoMapeo =>
    canalId === 'onplay_cl' ? mapearOnplay(cats, arbol) : mapearOnplaygames(cats);

  const resumen: ResumenImportacion = {
    canalId,
    dryRun,
    procesados: 0,
    creados: 0,
    actualizados: 0,
    omitidos: 0,
    sinPrecio: 0,
    sinClasificar: 0,
    duplicadosMarcados: 0,
    errores: [],
    duracionMs: 0,
  };

  const registrarError = async (error: ErrorImportacion) => {
    resumen.errores.push(error);
    if (!dryRun) {
      await registrarErrorSync(
        canalId,
        'importar',
        `${error.detalle} — externoId=${error.externoId ?? '?'} sku=${error.externoSku ?? '?'} "${error.nombre}"`,
      );
    }
  };

  for await (const lote of cliente.paginarProductos()) {
    for (const productoWoo of lote) {
      let items: ItemImportable[];
      try {
        items = await construirItems(productoWoo, cliente, mapear);
      } catch (e) {
        // Un error por producto no aborta la corrida (§6.5).
        await registrarError({
          externoId: productoWoo.id,
          externoSku: productoWoo.sku || null,
          nombre: productoWoo.name,
          detalle: `fallo al expandir: ${(e as Error).message}`,
        });
        continue;
      }

      for (const item of items) {
        resumen.procesados += 1;
        if (item.mapeo.categoriaSlug === 'sin-clasificar') resumen.sinClasificar += 1;
        try {
          const resultado = await procesarItem(item, ctx);
          if (resultado === 'creado') resumen.creados += 1;
          else if (resultado === 'actualizado') resumen.actualizados += 1;
          else resumen.omitidos += 1;

          // §6.2 regla 4: sin precio → entra con precio 0 e inactivo, y queda registrado.
          if (item.sinPrecio) {
            resumen.sinPrecio += 1;
            await registrarError({
              externoId: item.externoId,
              externoSku: item.externoSku,
              nombre: item.nombre,
              detalle: 'sin precio: precioVenta=0, activo=false, revisar manualmente',
            });
          }
        } catch (e) {
          await registrarError({
            externoId: item.externoId,
            externoSku: item.externoSku,
            nombre: item.nombre,
            detalle: (e as Error).message,
          });
        }
      }
    }
  }

  if (!dryRun) {
    resumen.duplicadosMarcados = await marcarDuplicados();
  }
  resumen.duracionMs = Date.now() - inicio;

  if (!dryRun) {
    const { errores, ...cifras } = resumen;
    await prisma.syncLog.create({
      data: {
        canalId,
        operacion: 'importar',
        resultado: errores.length > 0 ? 'ok_con_errores' : 'ok',
        detalle: JSON.stringify({ ...cifras, errores: errores.length }),
      },
    });
  }

  return resumen;
}

// ---------- sincronización incremental (§6.5) ----------
// Cada 30 minutos desde el cron. Solo toca nombre, precioVenta, imagenUrl y
// publicado (procesarItem ya respeta eso para productos existentes). Un producto
// que dejó de estar publicado se marca ProductoCanal.publicado = false — nunca
// se borra (Principio P9).

export interface ResumenIncremental {
  canalId: CanalWoo;
  desde: string;
  hasta: string;
  procesados: number;
  creados: number;
  actualizados: number;
  omitidos: number;
  despublicados: number;
  errores: number;
  duracionMs: number;
}

/** Marca de agua: el `hasta` de la última corrida incremental ok; si no hay,
 *  el último `sincronizadoEn` del canal (la importación inicial). */
async function marcaDeAgua(canalId: CanalWoo): Promise<string | null> {
  const ultima = await prisma.syncLog.findFirst({
    where: { canalId, operacion: 'incremental', resultado: { in: ['ok', 'ok_con_errores'] } },
    orderBy: { creadoEn: 'desc' },
  });
  if (ultima?.detalle) {
    try {
      const hasta = (JSON.parse(ultima.detalle) as { hasta?: string }).hasta;
      if (hasta) return hasta;
    } catch {
      // detalle ilegible: cae al plan B
    }
  }
  const max = await prisma.productoCanal.aggregate({
    where: { canalId },
    _max: { sincronizadoEn: true },
  });
  return max._max.sincronizadoEn?.toISOString() ?? null;
}

export async function sincronizarIncremental(canalId: CanalWoo): Promise<ResumenIncremental> {
  const inicio = Date.now();
  const hasta = new Date(inicio).toISOString();
  const cfg = entorno.canales[canalId];
  if (!cfg.url || !cfg.ck || !cfg.cs) {
    throw new Error(`Canal ${canalId} sin credenciales configuradas (WOO_*).`);
  }
  const desde = await marcaDeAgua(canalId);
  if (!desde) {
    throw new Error(`Canal ${canalId} sin importación inicial: corre /sync/${canalId}/importar primero.`);
  }

  const cliente = new ClienteWoo({
    url: cfg.url,
    ck: cfg.ck,
    cs: cfg.cs,
    soloLectura: entorno.syncSoloLectura,
  });

  const categorias = await prisma.categoria.findMany({ select: { id: true, slug: true } });
  const ctx: ContextoImportacion = {
    canalId,
    dryRun: false,
    categoriaPorSlug: new Map(categorias.map((c) => [c.slug, c.id])),
    reservador: new ReservadorSku(false),
    skusVistos: new Set(),
    externoSkusVistos: new Set(),
  };
  let arbol = new Map<number, CategoriaWoo>();
  if (canalId === 'onplay_cl') {
    arbol = new Map((await cliente.listarCategorias()).map((c) => [c.id, c]));
  }
  const mapear = (cats: CategoriaDeProductoWoo[]): ResultadoMapeo =>
    canalId === 'onplay_cl' ? mapearOnplay(cats, arbol) : mapearOnplaygames(cats);

  const resumen: ResumenIncremental = {
    canalId,
    desde,
    hasta,
    procesados: 0,
    creados: 0,
    actualizados: 0,
    omitidos: 0,
    despublicados: 0,
    errores: 0,
    duracionMs: 0,
  };

  const registrarError = async (detalle: string) => {
    resumen.errores += 1;
    await registrarErrorSync(canalId, 'incremental', detalle);
  };

  for await (const lote of cliente.paginarProductosModificados(desde)) {
    for (const productoWoo of lote) {
      try {
        // Dejó de estar publicado: publicado=false en sus vínculos, nada más (§6.5, P9).
        if (productoWoo.status !== 'publish') {
          const ids = [productoWoo.id];
          if (productoWoo.type === 'variable') {
            ids.push(...(productoWoo.variations ?? []));
          }
          const r = await prisma.productoCanal.updateMany({
            where: { canalId, externoId: { in: ids }, publicado: true },
            data: { publicado: false, sincronizadoEn: new Date() },
          });
          resumen.despublicados += r.count;
          continue;
        }

        const items = await construirItems(productoWoo, cliente, mapear);
        for (const item of items) {
          resumen.procesados += 1;
          try {
            const resultado = await procesarItem(item, ctx);
            if (resultado === 'creado') resumen.creados += 1;
            else if (resultado === 'actualizado') resumen.actualizados += 1;
            else resumen.omitidos += 1;
          } catch (e) {
            // Un error por producto no aborta la corrida (§6.5).
            await registrarError(
              `${(e as Error).message} — externoId=${item.externoId} sku=${item.externoSku ?? '?'} "${item.nombre}"`,
            );
          }
        }
      } catch (e) {
        await registrarError(
          `fallo al expandir: ${(e as Error).message} — externoId=${productoWoo.id} "${productoWoo.name}"`,
        );
      }
    }
  }

  // Un cambio de precio puede crear (o resolver a futuro) pares nuevos: se re-marca.
  await marcarDuplicados();
  resumen.duracionMs = Date.now() - inicio;

  await prisma.syncLog.create({
    data: {
      canalId,
      operacion: 'incremental',
      resultado: resumen.errores > 0 ? 'ok_con_errores' : 'ok',
      detalle: JSON.stringify(resumen),
    },
  });
  return resumen;
}
