// Accesos rápidos por categoría (05-SDD V2, ajustado por R-005/R-006): las pestañas son las
// categorías RAÍZ reales del catálogo que tienen productos en el caché local, no una lista
// fija. Dentro, las subcategorías con productos aparecen como filtros; si la selección tiene
// más de TOPE productos y subcategorías, primero se elige una (regla original de «Cartas»).
// Los productos se ven en grilla (tarjetas) o en lista con miniatura; la preferencia se
// recuerda en localStorage (solo interfaz, S3). Todo resuelto contra el caché (offline).
import { useEffect, useMemo, useState } from 'react';
import {
  alCambiarCatalogo,
  categorias,
  contarProductos,
  idsDelSubarbol,
  productosDeCategorias,
  type Categoria,
  type ProductoCache,
} from '../catalogo.js';
import { clp } from '../utils/formato.js';
import { ConmutadorVista, EtiquetaStock, Segmentado, type Vista } from './base.js';

/** Sin virtualización en la Etapa 1: la grilla se topa en 60 (05-SDD §rendimiento). */
const TOPE = 60;

const CLAVE_VISTA = 'onplay.accesos-vista';

function vistaGuardada(): Vista {
  try {
    return localStorage.getItem(CLAVE_VISTA) === 'lista' ? 'lista' : 'grilla';
  } catch {
    return 'grilla';
  }
}

export function AccesoRapido({ onAgregar }: { onAgregar: (p: ProductoCache) => void }) {
  const [raices, setRaices] = useState<Categoria[]>([]);
  const [raizId, setRaizId] = useState<string | null>(null);
  const [subcategoria, setSubcategoria] = useState<Categoria | null>(null);
  const [vista, setVista] = useState<Vista>(vistaGuardada);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    void categorias().then(setRaices).catch(() => {});
    return alCambiarCatalogo(() => setVersion((v) => v + 1));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_VISTA, vista);
    } catch {
      /* sin almacenamiento: la preferencia dura la sesión */
    }
  }, [vista]);

  // Pestañas: solo raíces con al menos un producto en el caché (el árbol trae también
  // categorías vacías como Eventos o Sin clasificar, que no sirven para vender).
  const pestanas = useMemo(() => {
    void version;
    return raices
      .map((r) => ({ cat: r, total: contarProductos(idsDelSubarbol(r)) }))
      .filter((x) => x.total > 0);
  }, [raices, version]);

  const raiz = useMemo(
    () => pestanas.find((x) => x.cat.id === raizId) ?? null,
    [pestanas, raizId],
  );

  useEffect(() => setSubcategoria(null), [raizId]);

  const hijos = useMemo(() => {
    void version;
    if (!raiz) return [];
    return raiz.cat.hijos
      .map((h) => ({ cat: h, total: contarProductos(idsDelSubarbol(h)) }))
      .filter((x) => x.total > 0);
  }, [raiz, version]);

  // Con más de TOPE productos y subcategorías, hay que elegir una primero (05-SDD: «Cartas»
  // no despliega la categoría completa). Con pocas, la grilla sale de inmediato.
  const exigeSubcategoria = !!raiz && raiz.total > TOPE && hijos.length > 0;
  const seleccion = subcategoria
    ? hijos.find((h) => h.cat.id === subcategoria.id) ?? null
    : exigeSubcategoria
      ? null
      : raiz;

  const productos = useMemo(() => {
    void version;
    if (!seleccion) return [];
    return productosDeCategorias(idsDelSubarbol(seleccion.cat), TOPE);
  }, [seleccion, version]);

  const recortada = !!seleccion && seleccion.total > TOPE;

  return (
    <div className="no-imprimir">
      <div className="flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto">
          <Segmentado<string>
            opciones={pestanas.map((x) => ({ valor: x.cat.id, etiqueta: x.cat.nombre }))}
            valor={raizId}
            onChange={setRaizId}
          />
        </div>
        {raiz ? <ConmutadorVista vista={vista} onChange={setVista} /> : null}
      </div>

      {raiz && hijos.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!exigeSubcategoria ? (
            <FiltroSub
              activo={!subcategoria}
              etiqueta={`Todo · ${raiz.total}`}
              onClick={() => setSubcategoria(null)}
            />
          ) : null}
          {hijos.map((h) => (
            <FiltroSub
              key={h.cat.id}
              activo={subcategoria?.id === h.cat.id}
              etiqueta={`${h.cat.nombre} · ${h.total}`}
              onClick={() => setSubcategoria(h.cat)}
            />
          ))}
        </div>
      ) : null}

      {raiz && exigeSubcategoria && !subcategoria ? (
        <p className="mt-3 text-chico text-lab3">
          Elige una subcategoría. Usa el buscador para encontrar un producto puntual.
        </p>
      ) : null}

      {seleccion && productos.length > 0 ? (
        <>
          {recortada ? (
            <p className="mt-3 text-chico text-lab3">
              Se muestran {productos.length} de {seleccion.total} en orden alfabético. Usa el buscador
              para encontrar un producto puntual.
            </p>
          ) : null}
          {vista === 'grilla' ? (
            <div className="mt-3 grid max-h-[45vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
              {productos.map((p) => (
                <TarjetaProducto key={p.id} producto={p} onAgregar={onAgregar} />
              ))}
            </div>
          ) : (
            <ul className="mt-3 max-h-[45vh] divide-y divide-sep overflow-y-auto rounded-tarjeta border border-sep bg-bg">
              {productos.map((p) => (
                <FilaProducto key={p.id} producto={p} onAgregar={onAgregar} />
              ))}
            </ul>
          )}
        </>
      ) : seleccion ? (
        <p className="mt-3 text-chico text-lab3">No hay productos en esta categoría todavía.</p>
      ) : null}

      {raices.length > 0 && pestanas.length === 0 ? (
        <p className="mt-1 text-chico text-lab3">El catálogo local aún no tiene productos por categoría.</p>
      ) : null}
    </div>
  );
}

/* ---------- vistas ---------- */

/** Tarjeta al estilo del POS de referencia: pie con precio + botón «+». */
function TarjetaProducto({ producto: p, onAgregar }: { producto: ProductoCache; onAgregar: (p: ProductoCache) => void }) {
  return (
    // El botón es el objetivo accesible (teclado); el resto de la tarjeta también agrega.
    <div
      onClick={() => onAgregar(p)}
      className="flex min-h-fila cursor-pointer flex-col overflow-hidden rounded-tarjeta border border-sep bg-bg transition-all active:scale-[0.97]"
    >
      <p className="flex-1 p-2 text-left text-cuerpo font-medium leading-tight text-lab line-clamp-2">
        {p.nombre}
      </p>
      <div className="mt-auto flex items-center justify-between gap-1 px-2 pb-2">
        <span className="flex flex-col">
          <span className="num font-black text-cuerpo leading-none text-lab">{clp(p.precioVenta)}</span>
          <EtiquetaStock p={p} />
        </span>
        <BotonMas producto={p} onAgregar={onAgregar} />
      </div>
    </div>
  );
}

/** Fila con miniatura: imagen 40 px (o marcador si no hay / no carga), nombre, SKU y precio. */
function FilaProducto({ producto: p, onAgregar }: { producto: ProductoCache; onAgregar: (p: ProductoCache) => void }) {
  return (
    <li
      onClick={() => onAgregar(p)}
      className="flex min-h-fila cursor-pointer items-center gap-3 px-2 py-1 transition-colors active:bg-bg3"
    >
      <Miniatura src={p.imagenUrl ?? null} alt={p.nombre} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-cuerpo font-medium leading-tight text-lab">{p.nombre}</p>
        <p className="num text-chico text-lab3">
          {p.sku}
          <EtiquetaStock p={p} clase="ml-2" />
        </p>
      </div>
      <span className="num shrink-0 font-black text-cuerpo leading-none text-lab">{clp(p.precioVenta)}</span>
      <BotonMas producto={p} onAgregar={onAgregar} />
    </li>
  );
}

function Miniatura({ src, alt }: { src: string | null; alt: string }) {
  const [rota, setRota] = useState(false);
  useEffect(() => setRota(false), [src]);
  if (!src || rota) {
    return (
      <div
        aria-hidden="true"
        className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded border border-sep bg-bg2 text-lab3"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setRota(true)}
      className="h-[40px] w-[40px] shrink-0 rounded border border-sep bg-bg2 object-cover"
    />
  );
}

function BotonMas({ producto: p, onAgregar }: { producto: ProductoCache; onAgregar: (p: ProductoCache) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAgregar(p);
      }}
      aria-label={`Agregar ${p.nombre}`}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-ac-relleno text-sobre-ac transition-all active:scale-90"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 12h14" />
        <path d="M12 5v14" />
      </svg>
    </button>
  );
}

/* ---------- controles ---------- */

function FiltroSub({ activo, etiqueta, onClick }: { activo: boolean; etiqueta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={`h-[36px] rounded border px-3 text-chico transition-colors ${
        activo ? 'border-ac bg-ac-relleno font-semibold text-sobre-ac' : 'border-sep bg-bg text-lab2'
      }`}
    >
      {etiqueta}
    </button>
  );
}
