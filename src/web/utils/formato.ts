// Único punto de formato (05-SDD §4.5). Ningún componente formatea dinero por su cuenta.

/** `$11.000` — es-CL, sin decimales. Negativo con signo explícito: `−$1.240`. */
export function clp(monto: number): string {
  const abs = Math.abs(monto).toLocaleString('es-CL');
  return monto < 0 ? `−$${abs}` : `$${abs}`;
}

const ZONA = 'America/Santiago';

/** `25-08-2026` */
export function fecha(d: Date | string): string {
  const f = new Date(d);
  return f
    .toLocaleDateString('es-CL', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' })
    .replace(/\//g, '-');
}

/** `14:32` — 24 h. */
export function hora(d: Date | string): string {
  return new Date(d).toLocaleTimeString('es-CL', {
    timeZone: ZONA,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
