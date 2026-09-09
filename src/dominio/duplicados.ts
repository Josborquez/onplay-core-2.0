// Detección de duplicados entre canales — 02-SDD §6.6.

/** minúsculas, sin tildes, sin puntuación, espacios colapsados */
export function normalizarNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿precioA y precioB difieren en menos de ±10%? */
export function preciosSimilares(precioA: number, precioB: number, tolerancia = 0.1): boolean {
  if (precioA === precioB) return true;
  const mayor = Math.max(precioA, precioB);
  if (mayor === 0) return true;
  return Math.abs(precioA - precioB) <= tolerancia * mayor;
}
