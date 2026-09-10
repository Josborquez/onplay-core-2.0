// Ancho de la pantalla para las reglas de 05-SDD §3.4 y del rediseño 1h (R-029):
// ≥1024 barra plegable · 640–1023 barra siempre plegada · <640 barra inferior y tablas como tarjetas.
import { useEffect, useState } from 'react';

export type Tramo = 'telefono' | 'tablet' | 'escritorio';

function tramoDe(ancho: number): Tramo {
  if (ancho < 640) return 'telefono';
  if (ancho < 1024) return 'tablet';
  return 'escritorio';
}

export function useAncho(): { ancho: number; tramo: Tramo } {
  const [ancho, setAncho] = useState(() => (typeof window === 'undefined' ? 1366 : window.innerWidth));
  useEffect(() => {
    let marco = 0;
    const alCambiar = () => {
      cancelAnimationFrame(marco);
      marco = requestAnimationFrame(() => setAncho(window.innerWidth));
    };
    window.addEventListener('resize', alCambiar);
    return () => {
      cancelAnimationFrame(marco);
      window.removeEventListener('resize', alCambiar);
    };
  }, []);
  return { ancho, tramo: tramoDe(ancho) };
}
