// Barra de acciones fija al pie de una pantalla larga (rediseño 1d/1e, R-029): resumen a la
// izquierda (cifras con rótulo) y a la derecha la acción principal con las secundarias.
// Va al final de una página con `flex min-h-full flex-col`; se pega al borde inferior de <main>.
import type { ReactNode } from 'react';

export function PieAcciones({ resumen, children }: { resumen?: ReactNode; children: ReactNode }) {
  return (
    <footer className="sticky bottom-0 z-10 mt-auto flex min-h-[80px] flex-wrap items-center justify-between gap-4 border-t border-sep bg-barra-solida px-4 py-3 sm:px-8">
      <div className="flex min-w-0 flex-wrap items-baseline gap-5">{resumen}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </footer>
  );
}

/** Cifra con rótulo para el resumen del pie o las tarjetas de cabecera. */
export function Cifra({ rotulo, children, chico }: { rotulo: string; children: ReactNode; chico?: ReactNode }) {
  return (
    <span className="flex flex-col">
      <span className="text-rot font-semibold uppercase tracking-[.06em] text-lab3">{rotulo}</span>
      <span className="num text-[20px] font-semibold leading-tight text-lab">
        {children}
        {chico ? <span className="text-chico font-normal text-lab2"> {chico}</span> : null}
      </span>
    </span>
  );
}
