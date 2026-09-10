// Registro de lectores por distribuidor — 11-SDD §6.3. Cada lector es una función pura sobre las
// celdas del PDF (src/api/compras/pdf.ts). Agregar un distribuidor = un archivo + un test con su PDF.
import type { DocumentoLeido, LectorFactura } from '@onplay/dominio';
import type { PaginaTexto } from '../pdf.js';
import { leerAndina, reconoceAndina } from './andina.js';
import { leerNico, reconoceNico } from './nico.js';
import { leerNicoFactura, reconoceNicoFactura } from './nico_factura.js';
import { leerCoqui, reconoceCoqui } from './coqui.js';
import { leerDevir, reconoceDevir } from './devir.js';

export interface Lector {
  clave: Exclude<LectorFactura, 'manual'>;
  nombre: string;
  /** Lectores del MISMO proveedor (Nico manda pedido web y factura): cualquiera de ellos ubica al proveedor. */
  familia: Exclude<LectorFactura, 'manual'>[];
  reconoce: (paginas: PaginaTexto[]) => boolean;
  leer: (paginas: PaginaTexto[]) => DocumentoLeido;
}

export const LECTORES: readonly Lector[] = [
  { clave: 'andina', nombre: 'Embotelladora Andina (Coca-Cola)', familia: ['andina'], reconoce: reconoceAndina, leer: leerAndina },
  // La factura de Nico también menciona distribuidoranico.cl: va ANTES que el pedido web.
  { clave: 'nico_factura', nombre: 'Distribuidora Nico (factura)', familia: ['nico_factura', 'nico'], reconoce: reconoceNicoFactura, leer: leerNicoFactura },
  { clave: 'nico', nombre: 'Distribuidora Nico (pedido web)', familia: ['nico', 'nico_factura'], reconoce: reconoceNico, leer: leerNico },
  { clave: 'coqui', nombre: 'Coqui Hobby (Sales Order en USD)', familia: ['coqui'], reconoce: reconoceCoqui, leer: leerCoqui },
  { clave: 'devir', nombre: 'Devir Chile (factura)', familia: ['devir'], reconoce: reconoceDevir, leer: leerDevir },
];

export function lectorPorClave(clave: string): Lector | null {
  return LECTORES.find((l) => l.clave === clave) ?? null;
}

/** Elige el lector que reconoce el documento; null si ninguno lo entiende (→ carga manual). */
export function detectarLector(paginas: PaginaTexto[]): Lector | null {
  return LECTORES.find((l) => l.reconoce(paginas)) ?? null;
}
