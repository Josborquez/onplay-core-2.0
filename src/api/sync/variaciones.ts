// Reglas puras del importador para productos variables y códigos de barras.
// Nacen de la revisión visual del 2026-09-02 (docs/08-bitacora-revision.md, R-001 a R-003).

/** Clave dentro de `Producto.atributos` que guarda el id del producto padre en el canal. */
export const CLAVE_PADRE_EXTERNO = 'padreExternoId';
/** Clave dentro de `Producto.atributos` con el texto limpio de la variante (ej. "Red"). */
export const CLAVE_VARIANTE = 'variante';

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[«»“”„]/g, '"') // el origen mezcla comillas tipográficas y rectas
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palabras significativas de un texto: sin puntuación, en minúsculas, mínimo 2 caracteres. */
function palabras(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w.length >= 2);
}

/** Fracción de las palabras del padre que aparecen en la opción (0..1). */
function solapamiento(nombrePadre: string, opcion: string): number {
  const delPadre = palabras(nombrePadre);
  if (delPadre.length === 0) return 0;
  const enOpcion = new Set(palabras(opcion));
  const comunes = delPadre.filter((w) => enOpcion.has(w)).length;
  return comunes / delPadre.length;
}

/**
 * ¿La opción es un nombre completo por sí sola? Sí cuando contiene el nombre del padre
 * entero, o cuando tiene al menos 4 palabras y comparte la mitad o más de las del padre
 * (ej. padre "Protectores UG: Cortex Sleeves (100pzs)" y opción "Cortex Sleeves (100) - Red").
 */
function esNombreCompleto(nombrePadre: string, opcion: string): boolean {
  if (normalizar(opcion).includes(normalizar(nombrePadre))) return true;
  return palabras(opcion).length >= 4 && solapamiento(nombrePadre, opcion) >= 0.5;
}

/** Quita separadores sobrantes al inicio de un texto ("- Red", ": Red", "– Red"). */
function sinSeparadorInicial(texto: string): string {
  return texto.replace(/^[\s\-–—:·|,]+/, '').trim();
}

/**
 * Texto limpio de la variante: si la opción repite el nombre del padre como prefijo
 * ("Katana Sleeves (100) - Red" con padre "Katana Sleeves (100)"), se queda solo con "Red".
 * Si no lo repite, devuelve la opción tal cual.
 */
export function textoDeVariante(nombrePadre: string, opcion: string): string {
  // Se colapsan los espacios ANTES de cortar: normalizar() no cambia el largo del texto
  // (solo minúsculas y guiones), así que el corte por largo del padre queda alineado.
  const opcionLimpia = opcion.replace(/\s+/g, ' ').trim();
  const padre = normalizar(nombrePadre);
  const op = normalizar(opcionLimpia);
  if (padre && op.startsWith(padre)) {
    const resto = sinSeparadorInicial(opcionLimpia.slice(padre.length));
    return resto || opcionLimpia;
  }
  return opcionLimpia;
}

/**
 * Nombre del producto que representa una variación (§6.2 regla 3), sin repetir el padre.
 * - Sin opciones → nombre del padre.
 * - Opción que repite el padre como prefijo → `padre — resto`.
 * - Opción que es un nombre completo por sí sola (contiene el padre entero, o tiene 4+
 *   palabras y comparte la mitad de las del padre) → la opción sola.
 * - Cualquier otra → `padre — opción`.
 */
export function nombreDeVariacion(nombrePadre: string, opciones: string[]): string {
  const padre = nombrePadre.trim();
  const limpias = opciones.map((o) => o.trim()).filter(Boolean);
  if (limpias.length === 0) return padre;

  const partes = limpias.map((o) => {
    const variante = textoDeVariante(padre, o);
    if (variante !== o) return { texto: variante, completo: false };
    // La opción no empieza por el padre pero es un nombre completo por sí sola.
    return { texto: o, completo: esNombreCompleto(padre, o) };
  });

  if (partes.length === 1 && partes[0]!.completo) return partes[0]!.texto;
  return `${padre} — ${partes.map((p) => p.texto).join(' / ')}`;
}

/**
 * Si un SKU externo tiene forma de código de barras (EAN-8, UPC-A, EAN-13 o GTIN-14),
 * se devuelve como `codigoBarras`; si no, null. Las tiendas suelen cargar el EAN del
 * fabricante como SKU de la variación (ej. protectores Ultimate Guard).
 */
export function codigoBarrasDesdeSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const limpio = sku.trim();
  return /^(\d{8}|\d{12,14})$/.test(limpio) ? limpio : null;
}
