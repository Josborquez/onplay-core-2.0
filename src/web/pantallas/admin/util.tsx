// Piezas compartidas del backoffice (Fase 6): select con estilo de Campo,
// paginación por página (contratos §5.3/§5.4) y aplanado del árbol de categorías.
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Categoria } from '../../catalogo.js';
import { Boton } from '../../components/base.js';
import { Icono } from '../../components/iconos.js';

export interface OpcionCategoria {
  id: string;
  etiqueta: string;
  /** Slug de la categoría raíz del subárbol: de él se deriva el tipo (V6). */
  raizSlug: string;
}

export function aplanarCategorias(arbol: Categoria[]): OpcionCategoria[] {
  const planas: OpcionCategoria[] = [];
  const visitar = (c: Categoria, raizSlug: string, nivel: number) => {
    planas.push({ id: c.id, etiqueta: `${'\u2003'.repeat(nivel)}${c.nombre}`, raizSlug });
    c.hijos.forEach((h) => visitar(h, raizSlug, nivel + 1));
  };
  arbol.forEach((r) => visitar(r, r.slug, 0));
  return planas;
}

interface PropsSelecto {
  etiqueta: string;
  valor: string;
  onValor: (v: string) => void;
  opciones: { valor: string; etiqueta: string }[];
  /** Texto de la opción vacía; sin él, no hay opción vacía. */
  vacia?: string;
  error?: string;
}

export function Selecto({ etiqueta, valor, onValor, opciones, vacia, error }: PropsSelecto) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-chico text-lab2">
        {etiqueta}
      </label>
      <select
        id={id}
        value={valor}
        onChange={(e) => onValor(e.target.value)}
        aria-invalid={!!error}
        className={`h-tactil w-full rounded-campo border bg-bg px-2 text-cuerpo text-lab outline-none ${error ? 'border-peligro' : 'border-sep'}`}
      >
        {vacia !== undefined ? <option value="">{vacia}</option> : null}
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1 text-chico text-peligro">{error}</p> : null}
    </div>
  );
}

interface PropsPaginacion {
  pagina: number;
  porPagina: number;
  total: number;
  onPagina: (p: number) => void;
}

export function Paginacion({ pagina, porPagina, total, onPagina, sustantivo }: PropsPaginacion & { sustantivo?: string }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  return (
    <div className="flex items-center justify-between gap-3">
      <Boton ajustado deshabilitado={pagina <= 1} onClick={() => onPagina(pagina - 1)}>
        Anterior
      </Boton>
      <span className="num text-chico text-lab3">
        Página {pagina} de {paginas}
        {sustantivo ? ` · ${total} ${sustantivo}` : ''}
      </span>
      <Boton ajustado deshabilitado={pagina >= paginas} onClick={() => onPagina(pagina + 1)}>
        Siguiente
      </Boton>
    </div>
  );
}

export interface Miga {
  a: string;
  etiqueta: string;
}

/**
 * Encabezado del backoffice (rediseño 1b, R-029): migas opcionales («‹ Compras / F-00482»), título con
 * insignia al lado, subtítulo con el resumen, y a la derecha las acciones (1 principal + 1 secundaria
 * + menú «⋯»). `extra` se mantiene por compatibilidad con las pantallas viejas.
 */
export function Encabezado({
  titulo,
  subtitulo,
  migas,
  insignia,
  acciones,
  extra,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  migas?: Miga[];
  insignia?: ReactNode;
  acciones?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <header className="mb-4 flex min-h-tactil flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-[2px]">
        {migas && migas.length > 0 ? (
          <nav aria-label="Ruta" className="flex items-center gap-[6px] text-chico text-lab3">
            {migas.map((m, i) => (
              <span key={m.a} className="flex items-center gap-[6px]">
                <Link to={m.a} className="flex items-center gap-1 text-lab2 hover:underline">
                  {i === 0 ? <Icono nombre="chevronIzquierda" tamano={14} /> : null}
                  {m.etiqueta}
                </Link>
                <span>/</span>
              </span>
            ))}
            <span className="truncate">{titulo}</span>
          </nav>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-tit text-lab">{titulo}</h1>
          {insignia}
        </div>
        {subtitulo ? <span className="text-chico text-lab3">{subtitulo}</span> : null}
      </div>
      {acciones ? <div className="flex flex-wrap items-center gap-2">{acciones}</div> : extra}
    </header>
  );
}

/** Campo de filtro fluido (rediseño 1b): crece hasta `flex`, nunca `w-[px]`. */
export function Filtro({ children, ancho = '0 1 200px', minimo = 160 }: { children: ReactNode; ancho?: string; minimo?: number }) {
  return (
    <div style={{ flex: ancho, minWidth: minimo }} className="max-w-full">
      {children}
    </div>
  );
}

/** Zona de filtros: fila fluida alineada abajo. */
export function Filtros({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>;
}

/** Buscador de una pantalla de backoffice: campo con lupa. */
export function CampoBuscar({ id, valor, onValor, placeholder, etiqueta = 'Buscar' }: { id: string; valor: string; onValor: (v: string) => void; placeholder: string; etiqueta?: string }) {
  return (
    <div>
      <label className="mb-1 block text-chico text-lab2" htmlFor={id}>
        {etiqueta}
      </label>
      <div className="flex h-tactil items-center gap-2 rounded-campo border border-sep bg-bg px-3">
        <Icono nombre="buscar" tamano={18} clase="text-lab3" />
        <input id={id} type="search" value={valor} onChange={(e) => onValor(e.target.value)} placeholder={placeholder} className="w-full bg-transparent text-lab outline-none" />
      </div>
    </div>
  );
}

/** Tarjeta de cifra de cabecera (rediseño 1e): rótulo, valor grande y detalle. */
export function TarjetaCifra({ rotulo, valor, detalle, grande }: { rotulo: string; valor: ReactNode; detalle?: ReactNode; grande?: boolean }) {
  return (
    <div className="flex flex-col gap-[2px] rounded-tarjeta bg-bg px-4 py-3 shadow-tarjeta">
      <span className="text-rot font-semibold uppercase tracking-[.06em] text-lab3">{rotulo}</span>
      <span className={`num font-semibold leading-tight text-lab ${grande ? 'text-[20px]' : 'text-cuerpo'}`}>{valor}</span>
      {detalle ? <span className="text-chico text-lab3">{detalle}</span> : null}
    </div>
  );
}

/** Sección plegable en una tarjeta (rediseño 1c/1i): fila de 56 px con chevron, título y resumen. */
export function SeccionPlegable({ titulo, resumen, accion, abierta, onToggle, children }: { titulo: string; resumen?: ReactNode; accion?: ReactNode; abierta: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="rounded-tarjeta bg-bg shadow-tarjeta">
      <div className="flex min-h-fila items-center justify-between gap-3 px-4">
        <button type="button" onClick={onToggle} aria-expanded={abierta} className="flex min-h-fila min-w-0 flex-1 items-center gap-3 text-left">
          <Icono nombre={abierta ? 'chevronAbajo' : 'chevronDerecha'} tamano={16} clase="text-lab3" />
          <span className="font-semibold text-lab">{titulo}</span>
          {resumen ? <span className="truncate text-chico text-lab3">{resumen}</span> : null}
        </button>
        {accion}
      </div>
      {abierta ? <div className="border-t border-sep px-4 py-3">{children}</div> : null}
    </div>
  );
}
