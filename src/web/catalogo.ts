// Caché local del catálogo (02-SDD §7.4): IndexedDB + índice en memoria.
// La búsqueda es SIEMPRE contra el caché primero; el servidor solo si no hay
// resultados locales y hay conexión (05-SDD V2). Delta cada 30 minutos con ?desde.
import { api } from './api.js';

export interface ProductoCache {
  id: string;
  sku: string;
  nombre: string;
  precioVenta: number;
  categoriaId: string | null;
  codigoBarras: string | null;
  cardNumber: string | null;
  activo: boolean;
  /** URL de la imagen en el canal (R-006). Puede faltar en filas cacheadas con esquema viejo. */
  imagenUrl?: string | null;
  /** E2 §7.3 (esquema 3). Faltan en filas cacheadas con esquema viejo. */
  controlaStock?: boolean;
  stockTotal?: number | null;
  stockVenta?: number | null;
  stockCanalMin?: number | null;
  estadoStock?: 'sin_control' | 'negativo' | 'quiebre' | 'bajo' | 'ok';
}

/**
 * Versión de los campos que trae `catalogo-offline`. Si cambia, el delta `?desde` no basta
 * (las filas viejas no tendrían el campo nuevo): se baja el catálogo completo una vez.
 * 1 = §5.2 original · 2 = + imagenUrl (R-006) · 3 = + stock (E2 §7.3) · 4 = stock con marcas UTC (R-014:
 * las filas cacheadas con el esquema 3 pueden tener stock viejo que el delta nunca refresca).
 */
const ESQUEMA_CATALOGO = 4;

export interface Categoria {
  id: string;
  nombre: string;
  slug: string;
  hijos: Categoria[];
}

const DB = 'onplay-mostrador';
const ALMACEN = 'productos';
const META = 'meta';
/** Cola offline de ventas F10 (§7.4): la clave ES la idempotencyKey persistida. */
export const VENTAS_PENDIENTES = 'ventasPendientes';

export function abrirDb(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const pedido = indexedDB.open(DB, 2);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(VENTAS_PENDIENTES)) {
        db.createObjectStore(VENTAS_PENDIENTES, { keyPath: 'idempotencyKey' });
      }
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
  });
}

export function tx<T>(db: IDBDatabase, almacen: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolver, rechazar) => {
    const pedido = fn(db.transaction(almacen, modo).objectStore(almacen));
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
  });
}

// Índice en memoria: con ~2.400 productos cabe holgado y busca en <100 ms.
let indice: ProductoCache[] = [];
let porBarras = new Map<string, ProductoCache>();
const suscriptores = new Set<() => void>();

function reindexar(productos: ProductoCache[]) {
  indice = productos.filter((p) => p.activo);
  porBarras = new Map(indice.filter((p) => p.codigoBarras).map((p) => [p.codigoBarras!, p]));
  suscriptores.forEach((fn) => fn());
}

export function alCambiarCatalogo(fn: () => void): () => void {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}

export function catalogoListo(): boolean {
  return indice.length > 0;
}

/** Hidrata desde IndexedDB y luego baja el delta (o todo, la primera vez). */
export async function hidratarCatalogo(): Promise<void> {
  const db = await abrirDb();
  const guardados = await tx<ProductoCache[]>(db, ALMACEN, 'readonly', (s) => s.getAll() as IDBRequest<ProductoCache[]>);
  if (guardados.length > 0) reindexar(guardados);
  await refrescarCatalogo();
}

export async function refrescarCatalogo(): Promise<void> {
  const db = await abrirDb();
  const esquema = await tx<number | undefined>(db, META, 'readonly', (s) => s.get('esquema') as IDBRequest<number | undefined>);
  const desdeGuardado = await tx<string | undefined>(db, META, 'readonly', (s) => s.get('desde') as IDBRequest<string | undefined>);
  // Esquema distinto → descarga completa (una vez), luego se vuelve al delta.
  const desde = esquema === ESQUEMA_CATALOGO ? desdeGuardado : undefined;
  try {
    const q = desde ? `?desde=${encodeURIComponent(desde)}` : '';
    const r = await api<{ generadoEn: string; productos: ProductoCache[] }>(`/productos/catalogo-offline${q}`);
    if (r.productos.length > 0) {
      const escritura = db.transaction([ALMACEN, META], 'readwrite');
      const almacen = escritura.objectStore(ALMACEN);
      for (const p of r.productos) almacen.put(p);
      escritura.objectStore(META).put(r.generadoEn, 'desde');
      escritura.objectStore(META).put(ESQUEMA_CATALOGO, 'esquema');
      await new Promise((res, rej) => {
        escritura.oncomplete = res;
        escritura.onerror = () => rej(escritura.error);
      });
      const todos = await tx<ProductoCache[]>(db, ALMACEN, 'readonly', (s) => s.getAll() as IDBRequest<ProductoCache[]>);
      reindexar(todos);
    } else {
      const escritura = db.transaction(META, 'readwrite');
      escritura.objectStore(META).put(r.generadoEn, 'desde');
      escritura.objectStore(META).put(ESQUEMA_CATALOGO, 'esquema');
    }
  } catch {
    // Sin conexión: se sigue con lo que haya en el caché.
  }
}

export function iniciarRefrescoPeriodico(): () => void {
  const id = setInterval(() => void refrescarCatalogo(), 30 * 60 * 1000);
  return () => clearInterval(id);
}

const normalizar = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Producto del caché por id (E2: el cobro offline revisa el espejo del canal, §6.9). */
export function productoPorId(id: string): ProductoCache | undefined {
  return indice.find((p) => p.id === id);
}

/** Coincidencia exacta de código de barras: se agrega sin mostrar la lista (05-SDD V2). */
export function porCodigoBarras(texto: string): ProductoCache | undefined {
  return porBarras.get(texto.trim());
}

/** Nombre, código, número de carta y código de barras — los cuatro de F4. Tope 20. */
export function buscarLocal(consulta: string): ProductoCache[] {
  const q = normalizar(consulta.trim());
  if (q.length < 2) return [];
  const exactos = indice.filter(
    (p) => p.sku.toLowerCase() === q || p.cardNumber?.toLowerCase() === q || p.codigoBarras === consulta.trim(),
  );
  const terminos = q.split(/\s+/);
  const parciales = indice.filter((p) => {
    if (exactos.includes(p)) return false;
    const pajar = normalizar(`${p.nombre} ${p.sku} ${p.cardNumber ?? ''} ${p.codigoBarras ?? ''}`);
    return terminos.every((t) => pajar.includes(t));
  });
  return [...exactos, ...parciales].slice(0, 20);
}

export function productosDeCategorias(ids: Set<string>, tope = 60): ProductoCache[] {
  return indice
    .filter((p) => p.categoriaId && ids.has(p.categoriaId))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, tope);
}

/** Cantidad de productos activos del caché dentro de un conjunto de categorías. */
export function contarProductos(ids: Set<string>): number {
  let n = 0;
  for (const p of indice) if (p.categoriaId && ids.has(p.categoriaId)) n += 1;
  return n;
}

let arbolCategorias: Categoria[] | null = null;

/**
 * Árbol de categorías. Se pide al servidor y se guarda en IndexedDB (`meta.categorias`)
 * para que los accesos rápidos funcionen sin conexión (P8, R-005).
 */
export async function categorias(): Promise<Categoria[]> {
  if (arbolCategorias) return arbolCategorias;
  try {
    const r = await api<{ categorias: Categoria[] }>('/categorias');
    arbolCategorias = r.categorias;
    try {
      const db = await abrirDb();
      await tx(db, META, 'readwrite', (s) => s.put(arbolCategorias, 'categorias'));
    } catch {
      /* sin IndexedDB se sigue con el árbol en memoria */
    }
    return arbolCategorias;
  } catch (e) {
    const db = await abrirDb();
    const guardado = await tx<Categoria[] | undefined>(db, META, 'readonly', (s) => s.get('categorias') as IDBRequest<Categoria[] | undefined>);
    if (!guardado) throw e;
    arbolCategorias = guardado;
    return guardado;
  }
}

/** Ids de una categoría raíz (por slug) y todas sus descendientes. */
export function idsDelSubarbol(raiz: Categoria): Set<string> {
  const ids = new Set<string>();
  const visitar = (c: Categoria) => {
    ids.add(c.id);
    c.hijos.forEach(visitar);
  };
  visitar(raiz);
  return ids;
}
