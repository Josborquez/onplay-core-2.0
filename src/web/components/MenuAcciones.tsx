// Menú de acciones «⋯» (rediseño 1b, R-029): botón de 44 × 44 y desplegable con ítems de 44 px.
// Sustituye las hileras de botones chicos por fila. Cierra con Escape, clic fuera o al elegir.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icono } from './iconos.js';

export interface ItemMenu {
  etiqueta: ReactNode;
  onClick: () => void;
  tono?: 'peligro';
  deshabilitado?: boolean;
  /** I6: el motivo se muestra bajo la etiqueta cuando está deshabilitado. */
  motivo?: string;
  /** Línea separadora antes de este ítem. */
  separadorAntes?: boolean;
}

interface Props {
  items: ItemMenu[];
  etiqueta?: string;
  /** `fila`: fondo transparente (dentro de una fila) · `cabecera`: con borde, para el encabezado. */
  variante?: 'fila' | 'cabecera';
  alinear?: 'derecha' | 'izquierda';
}

export function MenuAcciones({ items, etiqueta = 'Más acciones', variante = 'fila', alinear = 'derecha' }: Props) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!abierto) return;
    const alClic = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAbierto(false);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setAbierto(false);
      }
    };
    document.addEventListener('mousedown', alClic);
    document.addEventListener('keydown', alTeclear, true);
    return () => {
      document.removeEventListener('mousedown', alClic);
      document.removeEventListener('keydown', alTeclear, true);
    };
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const primero = raiz.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    primero?.focus();
  }, [abierto]);

  if (items.length === 0) return null;

  return (
    <div ref={raiz} className="relative inline-flex">
      <button
        type="button"
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={id}
        onClick={() => setAbierto((v) => !v)}
        className={`flex h-tactil w-tactil items-center justify-center rounded-campo text-lab2 ${
          variante === 'cabecera' || abierto ? 'border border-sep bg-bg3 text-lab' : ''
        }`}
      >
        <Icono nombre="mas" />
      </button>
      {abierto ? (
        <div
          id={id}
          role="menu"
          className={`absolute top-[48px] z-20 w-[220px] rounded-tarjeta border border-sep bg-bg3 p-[6px] shadow-tarjeta ${alinear === 'derecha' ? 'right-0' : 'left-0'}`}
          onKeyDown={(e) => {
            const nodos = Array.from(raiz.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
            const i = nodos.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              nodos[(i + 1) % nodos.length]?.focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              nodos[(i - 1 + nodos.length) % nodos.length]?.focus();
            }
          }}
        >
          {items.map((item, i) => (
            <div key={i}>
              {item.separadorAntes ? <div className="mx-2 my-[6px] border-t border-sep" /> : null}
              <button
                type="button"
                role="menuitem"
                aria-disabled={item.deshabilitado || undefined}
                disabled={item.deshabilitado}
                onClick={() => {
                  if (item.deshabilitado) return;
                  setAbierto(false);
                  item.onClick();
                }}
                className={`flex min-h-tactil w-full flex-col items-start justify-center rounded px-3 text-left text-cuerpo ${
                  item.deshabilitado ? 'cursor-not-allowed opacity-50' : 'hover:bg-ac-suave focus-visible:bg-ac-suave'
                } ${item.tono === 'peligro' ? 'text-peligro' : 'text-lab'}`}
              >
                <span>{item.etiqueta}</span>
                {item.deshabilitado && item.motivo ? <span className="text-chico text-lab3">{item.motivo}</span> : null}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
