// Confirmación destructiva (rediseño 1g, R-029): reemplaza a window.confirm. Título en pregunta,
// consecuencia con números, botón con verbo (nunca «Aceptar»). Devuelve una promesa booleana.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Boton, Dialogo } from './base.js';

export interface OpcionesConfirmar {
  titulo: string;
  cuerpo: ReactNode;
  /** Verbo de la acción: «Quitar línea», «Fusionar», «Desvincular». */
  accion: string;
  tono?: 'peligro' | 'principal';
  cancelar?: string;
}

type Confirmar = (o: OpcionesConfirmar) => Promise<boolean>;

const Contexto = createContext<Confirmar | null>(null);

export function ProveedorConfirmar({ children }: { children: ReactNode }) {
  const [pendiente, setPendiente] = useState<OpcionesConfirmar | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirmar = useCallback<Confirmar>((o) => {
    resolver.current?.(false);
    setPendiente(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const cerrar = (valor: boolean) => {
    resolver.current?.(valor);
    resolver.current = null;
    setPendiente(null);
  };

  const valor = useMemo(() => confirmar, [confirmar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      <Dialogo abierto={pendiente !== null} titulo={pendiente?.titulo ?? ''} onCerrar={() => cerrar(false)} ancho={480} rol="alertdialog">
        {pendiente ? (
          <div className="flex flex-col gap-3">
            <div className="text-cuerpo leading-relaxed text-lab2">{pendiente.cuerpo}</div>
            <div className="mt-1 flex justify-end gap-2 border-t border-sep pt-4">
              <Boton ajustado onClick={() => cerrar(false)}>
                {pendiente.cancelar ?? 'Cancelar'}
              </Boton>
              <Boton ajustado variante={pendiente.tono === 'principal' ? 'principal' : 'peligro'} onClick={() => cerrar(true)}>
                {pendiente.accion}
              </Boton>
            </div>
          </div>
        ) : null}
      </Dialogo>
    </Contexto.Provider>
  );
}

export function useConfirmar(): Confirmar {
  const c = useContext(Contexto);
  if (!c) throw new Error('useConfirmar fuera de ProveedorConfirmar');
  return c;
}
