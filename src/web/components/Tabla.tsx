// Tabla del backoffice (rediseño 1b/1h, R-029): rejilla CSS con filas de 56 px, menú «⋯» de 44 px
// por fila, resumen arriba y pie (paginación) dentro de la misma tarjeta. Cada columna declara
// prioridad: 1 siempre · 2 se oculta bajo 1024 · 3 se oculta bajo 900. Bajo 640 la fila es una
// tarjeta con las mismas tres zonas: título, cifras y ⋯. Nunca scroll horizontal.
// Carga en fondo: el contenido anterior queda al 55 % con una línea de progreso, nunca «Cargando…».
import type { ReactNode } from 'react';
import { useAncho } from '../pantalla.js';
import { MenuAcciones, type ItemMenu } from './MenuAcciones.js';
import { Vacio } from './base.js';

export interface Columna<T> {
  clave: string;
  titulo: ReactNode;
  /** Pista de la rejilla: `minmax(0,1fr)`, `96px`… Por defecto `minmax(0,1fr)`. */
  ancho?: string;
  alinear?: 'izquierda' | 'derecha';
  prioridad?: 1 | 2 | 3;
  render: (fila: T) => ReactNode;
  /** En modo tarjeta: `titulo` va arriba, `cifra` va en la línea de cifras con su rótulo, `oculto` no se muestra. */
  enTarjeta?: 'titulo' | 'cifra' | 'oculto';
}

interface Props<T> {
  columnas: Columna<T>[];
  filas: T[];
  clave: (fila: T) => string;
  menu?: (fila: T) => ItemMenu[];
  /** Barra superior: conteo + criterio (aria-live). */
  resumen?: ReactNode;
  resumenDerecha?: ReactNode;
  pie?: ReactNode;
  cargando?: boolean;
  vacio?: ReactNode;
  /** Filas atenuadas (p. ej. anuladas). */
  atenuada?: (fila: T) => boolean;
  /** Fuerza el modo tarjeta aunque haya ancho. */
  tarjetas?: boolean;
}

export function Tabla<T>({ columnas, filas, clave, menu, resumen, resumenDerecha, pie, cargando, vacio, atenuada, tarjetas }: Props<T>) {
  const { ancho } = useAncho();
  const modoTarjeta = tarjetas || ancho < 640;
  const visibles = columnas.filter((c) => {
    const p = c.prioridad ?? 1;
    if (p === 3 && ancho < 900) return false;
    if (p === 2 && ancho < 1024) return false;
    return true;
  });
  const pistas = `${visibles.map((c) => c.ancho ?? 'minmax(0,1fr)').join(' ')}${menu ? ' 44px' : ''}`;
  const vacia = filas.length === 0 && !cargando;

  return (
    <div className="relative flex flex-col overflow-visible rounded-tarjeta bg-bg shadow-tarjeta" aria-busy={cargando || undefined}>
      {cargando ? (
        <div aria-hidden="true" className="absolute left-0 right-0 top-0 h-[2px] overflow-hidden rounded-t-tarjeta bg-ac-suave">
          <span className="barra-progreso absolute left-0 top-0 h-full w-1/3 bg-ac" />
        </div>
      ) : null}
      {resumen || resumenDerecha ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sep px-4 py-3 text-chico text-lab2">
          <span aria-live="polite">{resumen}</span>
          {resumenDerecha ? <span className="text-lab3">{resumenDerecha}</span> : null}
        </div>
      ) : null}
      <div className={`flex flex-col transition-opacity ${cargando && filas.length > 0 ? 'opacity-55' : ''}`}>
        {vacia ? (
          <div className="px-4">{vacio ?? <Vacio mensaje="Nada que mostrar con estos filtros." />}</div>
        ) : modoTarjeta ? (
          <div className="flex flex-col gap-2 p-3">
            {filas.map((f) => {
              const titulo = columnas.filter((c) => c.enTarjeta === 'titulo' || (c.enTarjeta === undefined && c === columnas[0]));
              const cifras = columnas.filter((c) => c.enTarjeta === 'cifra' || (c.enTarjeta === undefined && c !== columnas[0]));
              return (
                <article
                  key={clave(f)}
                  className={`grid grid-cols-[minmax(0,1fr)_44px] items-start gap-2 rounded-tarjeta border border-sep bg-bg py-3 pl-4 pr-2 ${atenuada?.(f) ? 'opacity-70' : ''}`}
                >
                  <div className="flex min-w-0 flex-col gap-2">
                    {titulo.map((c) => (
                      <div key={c.clave} className="min-w-0">
                        {c.render(f)}
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-cuerpo">
                      {cifras.map((c) => (
                        <span key={c.clave} className="num">
                          <span className="text-chico text-lab3">{c.titulo} </span>
                          {c.render(f)}
                        </span>
                      ))}
                    </div>
                  </div>
                  {menu ? <MenuAcciones items={menu(f)} /> : <span />}
                </article>
              );
            })}
          </div>
        ) : (
          <>
            <div className="grid h-[36px] items-center gap-4 pl-4 pr-2 text-chico text-lab3" style={{ gridTemplateColumns: pistas }}>
              {visibles.map((c) => (
                <span key={c.clave} className={c.alinear === 'derecha' ? 'text-right' : ''}>
                  {c.titulo}
                </span>
              ))}
              {menu ? <span /> : null}
            </div>
            {filas.map((f) => (
              <div
                key={clave(f)}
                className={`grid min-h-fila items-center gap-4 border-t border-sep py-[6px] pl-4 pr-2 ${atenuada?.(f) ? 'opacity-70' : ''}`}
                style={{ gridTemplateColumns: pistas }}
              >
                {visibles.map((c) => (
                  <div key={c.clave} className={`min-w-0 ${c.alinear === 'derecha' ? 'text-right' : ''}`}>
                    {c.render(f)}
                  </div>
                ))}
                {menu ? <MenuAcciones items={menu(f)} /> : null}
              </div>
            ))}
          </>
        )}
      </div>
      {pie ? <div className="border-t border-sep px-4 py-2">{pie}</div> : null}
    </div>
  );
}

/** Celda de dos líneas: principal + secundaria en mono (código · tipo · precio). */
export function CeldaDoble({ principal, secundaria, mono = true, clase = '' }: { principal: ReactNode; secundaria?: ReactNode; mono?: boolean; clase?: string }) {
  return (
    <span className={`flex min-w-0 flex-col gap-[2px] ${clase}`}>
      <span className="truncate text-cuerpo text-lab">{principal}</span>
      {secundaria ? <span className={`truncate text-chico text-lab3 ${mono ? 'font-mono' : ''}`}>{secundaria}</span> : null}
    </span>
  );
}
