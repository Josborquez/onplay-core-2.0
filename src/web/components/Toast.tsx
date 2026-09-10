// Sistema de feedback (rediseño 1g, R-029): avisos efímeros anclados al pie de <main>.
// Éxito: role=status, 5 s, pausa al pasar el mouse. Error: role=alert, no se cierra solo.
// Progreso: se actualiza o se cierra desde quien lo abrió. Máximo 3 apilados; el cuarto reemplaza al más viejo.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icono } from './iconos.js';

export type TonoAviso = 'ok' | 'error' | 'progreso';

export interface Aviso {
  id: number;
  tono: TonoAviso;
  titulo: string;
  detalle?: ReactNode;
  accion?: { etiqueta: string; onClick: () => void };
  /** ms; por defecto 5000 en ok, nunca en error/progreso */
  duracion?: number | null;
}

type EntradaAviso = Omit<Aviso, 'id'>;

interface ContextoAvisos {
  avisos: Aviso[];
  avisar: (a: EntradaAviso) => number;
  actualizar: (id: number, cambios: Partial<EntradaAviso>) => void;
  cerrar: (id: number) => void;
}

const Contexto = createContext<ContextoAvisos | null>(null);
const MAXIMO = 3;
let siguienteId = 1;

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const cerrar = useCallback((id: number) => setAvisos((prev) => prev.filter((a) => a.id !== id)), []);
  const avisar = useCallback((a: EntradaAviso) => {
    const id = siguienteId++;
    setAvisos((prev) => [...prev.slice(Math.max(0, prev.length - (MAXIMO - 1))), { ...a, id }]);
    return id;
  }, []);
  const actualizar = useCallback((id: number, cambios: Partial<EntradaAviso>) => {
    setAvisos((prev) => prev.map((a) => (a.id === id ? { ...a, ...cambios } : a)));
  }, []);
  const valor = useMemo(() => ({ avisos, avisar, actualizar, cerrar }), [avisos, avisar, actualizar, cerrar]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAvisos() {
  const c = useContext(Contexto);
  if (!c) throw new Error('useAvisos fuera de ProveedorAvisos');
  return c;
}

function Tarjeta({ aviso, onCerrar }: { aviso: Aviso; onCerrar: () => void }) {
  const temporizador = useRef<number | null>(null);
  const duracion = aviso.duracion === undefined ? (aviso.tono === 'ok' ? 5000 : null) : aviso.duracion;

  const armar = useCallback(() => {
    if (duracion === null) return;
    if (temporizador.current) window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(onCerrar, duracion);
  }, [duracion, onCerrar]);
  const pausar = () => {
    if (temporizador.current) window.clearTimeout(temporizador.current);
  };

  useEffect(() => {
    armar();
    return pausar;
  }, [armar]);

  const icono =
    aviso.tono === 'ok' ? (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok text-sobre-ac">
        <Icono nombre="check" tamano={14} trazo={2.5} />
      </span>
    ) : aviso.tono === 'error' ? (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-peligro text-chico font-bold text-sobre-ac">!</span>
    ) : (
      <span className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-sep border-t-ac" aria-hidden="true" />
    );

  return (
    <div
      role={aviso.tono === 'error' ? 'alert' : 'status'}
      onMouseEnter={pausar}
      onMouseLeave={armar}
      className={`pointer-events-auto flex w-full items-center gap-3 rounded-tarjeta border bg-bg3 py-3 pl-4 pr-3 text-cuerpo text-lab shadow-tarjeta ${aviso.tono === 'error' ? 'border-peligro' : 'border-sep'}`}
    >
      {icono}
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">{aviso.titulo}</strong>
        {aviso.detalle ? <> {aviso.detalle}</> : null}
      </span>
      {aviso.accion ? (
        <button
          type="button"
          onClick={() => {
            aviso.accion?.onClick();
            onCerrar();
          }}
          className="h-[36px] shrink-0 whitespace-nowrap rounded px-3 font-semibold text-lab"
        >
          {aviso.accion.etiqueta}
        </button>
      ) : null}
      {aviso.tono !== 'progreso' ? (
        <button type="button" onClick={onCerrar} aria-label="Cerrar aviso" className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded text-lab2">
          <Icono nombre="cerrar" tamano={16} />
        </button>
      ) : null}
    </div>
  );
}

/** Se monta una vez, dentro del contenedor relativo de <main> (App.tsx). */
export function ListaAvisos() {
  const { avisos, cerrar } = useAvisos();
  if (avisos.length === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 z-toast flex w-[min(560px,calc(100%-32px))] -translate-x-1/2 flex-col gap-2">
      {avisos.map((a) => (
        <Tarjeta key={a.id} aviso={a} onCerrar={() => cerrar(a.id)} />
      ))}
    </div>
  );
}
