// Registro de lectores por distribuidor — 11-SDD §6.3. Cada lector es una función pura sobre las
// celdas del PDF (src/api/compras/pdf.ts). Agregar un distribuidor = un archivo + un test con su PDF.
import type { DocumentoLeido, LectorFactura } from '@onplay/dominio';
import type { PaginaTexto } from '../pdf.js';
import { leerAndina, reconoceAndina } from './andina.js';

export interface Lector {
  clave: Exclude<LectorFactura, 'manual'>;
  nombre: string;
  reconoce: (paginas: PaginaTexto[]) => boolean;
  leer: (paginas: PaginaTexto[]) => DocumentoLeido;
}

export const LECTORES: readonly Lector[] = [
  { clave: 'andina', nombre: 'Embotelladora Andina (Coca-Cola)', reconoce: reconoceAndina, leer: leerAndina },
];

export function lectorPorClave(clave: string): Lector | null {
  return LECTORES.find((l) => l.clave === clave) ?? null;
}

/** Elige el lector que reconoce el documento; null si ninguno lo entiende (→ carga manual). */
export function detectarLector(paginas: PaginaTexto[]): Lector | null {
  return LECTORES.find((l) => l.reconoce(paginas)) ?? null;
}
