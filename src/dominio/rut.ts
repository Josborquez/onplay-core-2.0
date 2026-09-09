// RUT chileno — 07-SDD §6.5.
// Opcional, pero si se escribe se valida con módulo 11 y se normaliza a
// "12345678-9": sin puntos, con guion, dígito verificador en mayúscula.

/** Dígito verificador por módulo 11: '0'-'9' o 'K'. */
export function calcularDvRut(cuerpo: string): string {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

/**
 * Valida y normaliza un RUT. Acepta puntos, espacios, guion opcional y dv en
 * minúscula. Devuelve "12345678-9" o null si el RUT no es válido.
 */
export function normalizarRut(entrada: string): string | null {
  const limpio = entrada.replace(/[.\s-]/g, '').toUpperCase();
  if (!/^\d{7,8}[\dK]$/.test(limpio)) return null;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  if (calcularDvRut(cuerpo) !== dv) return null;
  return `${Number(cuerpo)}-${dv}`;
}
