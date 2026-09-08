// SKU maestro — 02-SDD §6.4 y SDD general §7.1.
// La reserva del correlativo en base de datos es responsabilidad del llamador;
// aquí solo viven las reglas puras (testeables).

export type TipoProducto =
  | 'single'
  | 'sellado'
  | 'accesorio'
  | 'snack'
  | 'juego_mesa'
  | 'juguete'
  | 'evento'
  | 'indeterminado'
  | 'servicio';

export const PREFIJO_POR_TIPO: Record<TipoProducto, string> = {
  sellado: 'SLD',
  accesorio: 'ACC',
  snack: 'SNK',
  juego_mesa: 'JDM',
  juguete: 'JGT',
  evento: 'EVT',
  servicio: 'SRV',
  indeterminado: 'IND',
  // Un single sin SKU externo reconocible no tiene identificador natural:
  // cae al correlativo de indeterminados (§6.2, "Productos sin tipo determinable").
  single: 'IND',
};

// R-010: el número de coleccionista puede llevar sufijo (promos «240p», showcase «116s»,
// variantes «2013a», «259?» del Binder OP) y The List se publica como PLST-{SET}-{NUM}.
// R-018: la recarga desde ManaBox (2026-09-07) publica algunos foils con sufijo «-F» al final
// (HOB-5-NM-EN-F); se conserva en el SKU maestro para no chocar con la versión normal.
const PATRON_MTG = /^(?:(PLST)-)?([A-Z0-9]{2,5})-(\d+)([a-z?★]?)-(NM|LP|MP|HP|DMG)-([A-Z]{2})(-F)?$/;

/**
 * SKU maestro derivable directamente del SKU externo (casos 1 y 2 de §6.4).
 * Devuelve null si no hay forma reconocible: el llamador debe reservar correlativo.
 */
export function skuMaestroDesdeExterno(externoSku: string | null | undefined): string | null {
  if (!externoSku) return null;
  if (externoSku.startsWith('OP-')) return `OPT-${externoSku.slice(3)}`;
  const mtg = externoSku.match(PATRON_MTG);
  if (mtg) {
    const [, lista, set, num, sufijo, cond, idioma, foil] = mtg;
    return `MTG-${lista ? 'PLST-' : ''}${set}-${num!.padStart(3, '0')}${sufijo ?? ''}-${cond}-${idioma}${foil ?? ''}`;
  }
  return null;
}

/** Caso 3 de §6.4: prefijo por tipo + correlativo. EVT lleva el año (§7.1). */
export function formatearSkuCorrelativo(tipo: TipoProducto, numero: number, anio?: number): string {
  const prefijo = PREFIJO_POR_TIPO[tipo];
  if (prefijo === 'EVT') {
    const a = anio ?? new Date().getUTCFullYear();
    return `EVT-${a}-${String(numero).padStart(4, '0')}`;
  }
  return `${prefijo}-${String(numero).padStart(6, '0')}`;
}
