// Reglas puras de clientes — 07-SDD §5.1 (nombreBusqueda) y §6.6 (duplicados).
import { normalizarNombre } from './duplicados.js';

/**
 * nombreBusqueda: minúsculas, sin tildes, sin puntuación, espacios colapsados.
 * Habilita la búsqueda por prefijo LIKE 'ped%' que el fulltext no cubre.
 */
export function nombreBusquedaCliente(nombre: string): string {
  return normalizarNombre(nombre);
}

export type ConfianzaDuplicado = 'alta' | 'media' | 'baja';

export interface ClienteComparable {
  id: string;
  rut?: string | null;
  email?: string | null;
  telefono?: string | null;
  nombreBusqueda: string;
}

export interface DuplicadoCliente {
  clienteId: string;
  campo: 'rut' | 'email' | 'telefono' | 'nombre';
  confianza: ConfianzaDuplicado;
}

/**
 * Detección al crear un cliente — §6.6.
 * rut idéntico → alta (no se crea el duplicado); email → alta;
 * telefono → media (se propone); nombre normalizado → baja (solo panel).
 * Devuelve a lo sumo una coincidencia por cliente existente (la de mayor confianza).
 */
export function detectarDuplicadosCliente(
  candidato: {
    rut?: string | null;
    email?: string | null;
    telefono?: string | null;
    nombre: string;
  },
  existentes: ReadonlyArray<ClienteComparable>,
): DuplicadoCliente[] {
  const email = candidato.email?.trim().toLowerCase() || null;
  const telefono = candidato.telefono?.replace(/[\s\-().+]/g, '') || null;
  const nombreNorm = normalizarNombre(candidato.nombre);
  const resultado: DuplicadoCliente[] = [];

  for (const e of existentes) {
    if (candidato.rut && e.rut && candidato.rut === e.rut) {
      resultado.push({ clienteId: e.id, campo: 'rut', confianza: 'alta' });
      continue;
    }
    if (email && e.email && email === e.email.trim().toLowerCase()) {
      resultado.push({ clienteId: e.id, campo: 'email', confianza: 'alta' });
      continue;
    }
    if (telefono && e.telefono && telefono === e.telefono.replace(/[\s\-().+]/g, '')) {
      resultado.push({ clienteId: e.id, campo: 'telefono', confianza: 'media' });
      continue;
    }
    if (nombreNorm && nombreNorm === e.nombreBusqueda) {
      resultado.push({ clienteId: e.id, campo: 'nombre', confianza: 'baja' });
    }
  }
  return resultado;
}
