// Juego de iconos propio (rediseño UX 2026-09, R-029): SVG inline de 20 px, trazo 1.5, hereda el
// color del texto. Reemplaza los caracteres Unicode de la barra y los botones. Sin librería.
import type { ReactNode } from 'react';

export type NombreIcono =
  | 'mostrador'
  | 'misVentas'
  | 'inventario'
  | 'compras'
  | 'ventas'
  | 'clientes'
  | 'tiendas'
  | 'administracion'
  | 'plegar'
  | 'desplegar'
  | 'luna'
  | 'sol'
  | 'salir'
  | 'mas'
  | 'masVertical'
  | 'buscar'
  | 'chevronAbajo'
  | 'chevronArriba'
  | 'chevronDerecha'
  | 'chevronIzquierda'
  | 'check'
  | 'alerta'
  | 'info'
  | 'cerrar'
  | 'plus'
  | 'archivo';

const TRAZOS: Record<NombreIcono, ReactNode> = {
  mostrador: (
    <>
      <rect x="3" y="9" width="18" height="11" rx="2" />
      <path d="M7 9V5h10v4M3 14h18M8 17h3" />
    </>
  ),
  misVentas: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  inventario: (
    <>
      <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </>
  ),
  compras: (
    <>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  ventas: (
    <>
      <path d="M3 17l5-5 4 4 8-8" />
      <path d="M14 8h6v6" />
    </>
  ),
  clientes: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="16.5" cy="9" r="2.6" />
      <path d="M15.5 14.2c2.8.2 5 2.1 5 4.8" />
    </>
  ),
  tiendas: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  administracion: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  plegar: <path d="M20 12H6M12 6l-6 6 6 6M4 5v14" />,
  desplegar: <path d="M4 12h14M12 6l6 6-6 6M20 5v14" />,
  luna: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  sol: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  salir: <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9" />,
  mas: (
    <>
      <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  masVertical: (
    <>
      <circle cx="12" cy="5" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  buscar: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  chevronAbajo: <path d="M6 9l6 6 6-6" />,
  chevronArriba: <path d="M6 15l6-6 6 6" />,
  chevronDerecha: <path d="M9 6l6 6-6 6" />,
  chevronIzquierda: <path d="M15 6l-6 6 6 6" />,
  check: <path d="M5 12l5 5L20 7" />,
  alerta: (
    <>
      <path d="M12 3L2 21h20z" />
      <path d="M12 10v5M12 18h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
  cerrar: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  archivo: (
    <>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
};

export function Icono({ nombre, tamano = 20, trazo = 1.5, clase = '' }: { nombre: NombreIcono; tamano?: number; trazo?: number; clase?: string }) {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={trazo}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${clase}`}
    >
      {TRAZOS[nombre]}
    </svg>
  );
}
