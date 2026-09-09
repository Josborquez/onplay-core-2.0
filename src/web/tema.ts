// Tema claro/oscuro y plegado de la barra (05-SDD §3.2, §3.3).
// Únicos usos de localStorage: preferencias de interfaz, nunca secretos (S3).
import { useEffect, useState } from 'react';

type Tema = 'claro' | 'oscuro';

function temaInicial(): Tema {
  const guardado = localStorage.getItem('onplay.tema');
  if (guardado === 'claro' || guardado === 'oscuro') return guardado;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
}

export function useTema() {
  const [tema, setTema] = useState<Tema>(temaInicial);
  useEffect(() => {
    document.documentElement.dataset.tema = tema;
  }, [tema]);
  const conmutar = () => {
    const nuevo: Tema = tema === 'claro' ? 'oscuro' : 'claro';
    localStorage.setItem('onplay.tema', nuevo);
    setTema(nuevo);
  };
  return { tema, conmutar };
}

export function useLateralPlegada() {
  const [plegada, setPlegada] = useState(() => localStorage.getItem('onplay.lateral') === 'plegada');
  const conmutar = () =>
    setPlegada((p) => {
      localStorage.setItem('onplay.lateral', p ? 'desplegada' : 'plegada');
      return !p;
    });
  return { plegada, conmutar };
}

export function useEnLinea() {
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  useEffect(() => {
    const si = () => setEnLinea(true);
    const no = () => setEnLinea(false);
    window.addEventListener('online', si);
    window.addEventListener('offline', no);
    return () => {
      window.removeEventListener('online', si);
      window.removeEventListener('offline', no);
    };
  }, []);
  return enLinea;
}
