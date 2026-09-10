// Flujo por pasos (rediseño 1d, R-029): barra de 3 px por paso, hecho = relleno --lab con check,
// actual = --ac, pendiente = --sep. Cada paso puede llevar un detalle («· nico-f00482.pdf»).
import { Icono } from './iconos.js';

export interface Paso {
  etiqueta: string;
  detalle?: string;
}

export function Pasos({ pasos, actual, onIr }: { pasos: Paso[]; actual: number; onIr?: (indice: number) => void }) {
  return (
    <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${pasos.length}, minmax(0, 1fr))` }}>
      {pasos.map((p, i) => {
        const hecho = i < actual;
        const esActual = i === actual;
        const contenido = (
          <>
            <span className={`h-[3px] rounded-[2px] ${hecho ? 'bg-lab' : esActual ? 'bg-ac' : 'bg-sep'}`} />
            <span className={`flex min-w-0 items-center gap-2 text-chico ${esActual ? 'font-semibold text-lab' : hecho ? 'text-lab2' : 'text-lab3'}`}>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-rot ${
                  hecho ? 'bg-lab text-bg' : esActual ? 'border-[1.5px] border-ac text-ac' : 'border-[1.5px] border-sep'
                }`}
              >
                {hecho ? <Icono nombre="check" tamano={12} trazo={3} /> : <span className="num">{i + 1}</span>}
              </span>
              <span className="truncate">
                {p.etiqueta}
                {p.detalle ? <span className="font-normal text-lab3"> · {p.detalle}</span> : null}
              </span>
            </span>
          </>
        );
        return (
          <li key={p.etiqueta} aria-current={esActual ? 'step' : undefined} className="flex min-w-0 flex-col gap-2">
            {onIr && hecho ? (
              <button type="button" onClick={() => onIr(i)} className="flex min-w-0 flex-col gap-2 text-left">
                {contenido}
              </button>
            ) : (
              contenido
            )}
          </li>
        );
      })}
    </ol>
  );
}
