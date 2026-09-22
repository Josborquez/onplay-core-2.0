// Fechas en hora de Chile, compartidas por los reportes (R-026 y R-036, docs/14 §4).
// La base guarda UTC (tz.ts); aquí se traduce a días calendario de `America/Santiago` sin tablas
// de zona: se prueban los dos desfases posibles (-03 en verano, -04 en invierno).
export const ZONA_CHILE = 'America/Santiago';

/** YYYY-MM-DD del día chileno al que pertenece un instante. */
export const fechaChile = (d: Date): string => d.toLocaleDateString('en-CA', { timeZone: ZONA_CHILE });

/** Instante UTC de las 00:00 de un día calendario chileno. */
export function inicioDiaChile(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  for (const off of [3, 4]) {
    const t = new Date(Date.UTC(y, m - 1, d, off, 0, 0, 0));
    if (fechaChile(t) === ymd && t.toLocaleTimeString('en-GB', { timeZone: ZONA_CHILE, hour12: false }).startsWith('00:00')) return t;
  }
  return new Date(Date.UTC(y, m - 1, d, 4, 0, 0, 0));
}

export function sumarDias(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

export function lunesDe(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  return sumarDias(ymd, -((t.getUTCDay() + 6) % 7));
}

export type Agrupar = 'dia' | 'semana' | 'mes';

export function periodoDe(agrupar: Agrupar, dia: string): string {
  return agrupar === 'dia' ? dia : agrupar === 'semana' ? lunesDe(dia) : dia.slice(0, 7);
}

export function etiquetaPeriodo(agrupar: Agrupar, clave: string): string {
  if (agrupar === 'mes') {
    const [y, m] = clave.split('-').map(Number) as [number, number];
    const nombre = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-CL', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    return nombre.charAt(0).toUpperCase() + nombre.slice(1);
  }
  const [y, m, d] = clave.split('-') as [string, string, string];
  return agrupar === 'semana' ? `Semana del ${d}-${m}-${y}` : `${d}-${m}-${y}`;
}

export const MAX_DIAS_RANGO = 400;
export class ErrorRango extends Error {}

/**
 * Valida el rango pedido y devuelve los límites `[inicio local, inicio del día siguiente)` en UTC.
 * Mismo tope que R-026: 400 días. Un rango invertido o con fechas inexistentes es error, no un
 * rango silenciosamente vacío.
 */
export function rangoChile(desde: string, hasta: string): { inicio: Date; fin: Date } {
  const valido = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && fechaChile(inicioDiaChile(s)) === s;
  if (!valido(desde) || !valido(hasta)) throw new ErrorRango('RANGO_INVALIDO');
  if (desde > hasta) throw new ErrorRango('RANGO_INVERTIDO');
  const inicio = inicioDiaChile(desde);
  const fin = inicioDiaChile(sumarDias(hasta, 1)); // exclusivo
  if (fin.getTime() - inicio.getTime() > MAX_DIAS_RANGO * 86_400_000) throw new ErrorRango('RANGO_DEMASIADO_GRANDE');
  return { inicio, fin };
}

/** Rango inmediatamente anterior de la misma cantidad de días (comparación de períodos, §5). */
export function periodoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const dias = Math.round((inicioDiaChile(sumarDias(hasta, 1)).getTime() - inicioDiaChile(desde).getTime()) / 86_400_000);
  return { desde: sumarDias(desde, -dias), hasta: sumarDias(desde, -1) };
}
