// Piezas compartidas del backoffice (Fase 6): select con estilo de Campo,
// paginación por página (contratos §5.3/§5.4) y aplanado del árbol de categorías.
import { useId, type ReactNode } from 'react';
import type { Categoria } from '../../catalogo.js';
import { Boton } from '../../components/base.js';

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

export function Paginacion({ pagina, porPagina, total, onPagina }: PropsPaginacion) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between">
      <div className="w-[128px]">
        <Boton deshabilitado={pagina <= 1} onClick={() => onPagina(pagina - 1)}>
          Anterior
        </Boton>
      </div>
      <span className="text-chico text-lab3">
        Página {pagina} de {paginas}
      </span>
      <div className="w-[128px]">
        <Boton deshabilitado={pagina >= paginas} onClick={() => onPagina(pagina + 1)}>
          Siguiente
        </Boton>
      </div>
    </div>
  );
}

/** Encabezado común de las pantallas del backoffice. */
export function Encabezado({ titulo, extra }: { titulo: string; extra?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-tit text-lab">{titulo}</h1>
      {extra}
    </div>
  );
}
