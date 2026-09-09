// Estado de las tiendas web para cualquier rol (R-024): ¿responde la tienda? ¿cuándo se leyó el
// catálogo por última vez? Lo usa la marca de la barra lateral (vendedor incluido) y la pantalla
// Tiendas web. Se consulta al entrar y cada 5 minutos; sin conexión no consulta.
import { useEffect, useState } from 'react';
import { api } from './api.js';

export interface EstadoTienda {
  id: string;
  nombre: string;
  /** null = sin claves en el servidor (no se puede comprobar). */
  enLinea: boolean | null;
  ultimoCatalogoEn: string | null;
  productos: number;
}

export interface EstadoTiendas {
  comprobadoEn: string;
  tiendas: EstadoTienda[];
}

export function useEstadoTiendas(intervaloMs = 5 * 60 * 1000): EstadoTiendas | null {
  const [estado, setEstado] = useState<EstadoTiendas | null>(null);
  useEffect(() => {
    let vivo = true;
    const leer = () => {
      if (!navigator.onLine) return;
      api<EstadoTiendas>('/canales/estado')
        .then((e) => {
          if (vivo) setEstado(e);
        })
        .catch(() => undefined);
    };
    leer();
    const t = setInterval(leer, intervaloMs);
    window.addEventListener('online', leer);
    return () => {
      vivo = false;
      clearInterval(t);
      window.removeEventListener('online', leer);
    };
  }, [intervaloMs]);
  return estado;
}
