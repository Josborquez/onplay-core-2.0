// Mapeo de categorías WooCommerce → taxonomía interna — 02-SDD §6.3.
// Las reglas son POR CANAL: onplay.cl vende singles; onplaygames.cl, sellado.
import type { TipoProducto } from '@onplay/dominio';
import type { CategoriaDeProductoWoo, CategoriaWoo } from '@onplay/woo-client';

export interface ResultadoMapeo {
  categoriaSlug: string; // slug de la taxonomía interna (semillas §4.3)
  tipo: TipoProducto;
  juego: string | null;
  /** Los eventos de onplaygames.cl entran inactivos: E5 los tomará (§6.3). */
  activo: boolean;
}

const SIN_CLASIFICAR: ResultadoMapeo = {
  categoriaSlug: 'sin-clasificar',
  tipo: 'indeterminado',
  juego: null,
  activo: true,
};

// ---------- onplay.cl → siempre tipo single ----------

/** ¿La categoría desciende (o es) `one-piece-tcg`? Se resuelve con el árbol del canal. */
function desciendeDe(
  slugObjetivo: string,
  cat: CategoriaDeProductoWoo,
  arbol: Map<number, CategoriaWoo>,
): boolean {
  let actual = arbol.get(cat.id);
  // La categoría del producto puede no venir en el árbol (borrada en carrera): usa su propio slug.
  if (!actual) return cat.slug === slugObjetivo;
  const visitados = new Set<number>();
  while (actual && !visitados.has(actual.id)) {
    if (actual.slug === slugObjetivo) return true;
    visitados.add(actual.id);
    actual = actual.parent ? arbol.get(actual.parent) : undefined;
  }
  return false;
}

export function mapearOnplay(
  categorias: CategoriaDeProductoWoo[],
  arbol: Map<number, CategoriaWoo>,
): ResultadoMapeo {
  for (const cat of categorias) {
    if (cat.slug === 'magic-the-gathering' || cat.slug.endsWith('-magic-the-gathering')) {
      return { categoriaSlug: 'cartas-magic', tipo: 'single', juego: 'magic', activo: true };
    }
  }
  for (const cat of categorias) {
    if (desciendeDe('one-piece-tcg', cat, arbol)) {
      return { categoriaSlug: 'cartas-one-piece', tipo: 'single', juego: 'one_piece', activo: true };
    }
  }
  return { ...SIN_CLASIFICAR, tipo: 'single' };
}

// ---------- onplaygames.cl → lista explícita de los 40 slugs reales ----------

interface ReglaOpg {
  slugs: string[];
  resultado: Omit<ResultadoMapeo, 'activo'> & { activo?: boolean };
}

// Se evalúan EN ORDEN; gana la primera coincidencia (§6.3).
const REGLAS_ONPLAYGAMES: ReglaOpg[] = [
  {
    slugs: [
      'magic', 'magic-the-gathering', 'mtg-final-fantasy', 'final-fantasy', 'duskmourn',
      'edge-of-eternities', 'secrets-of-strixhaven', 'tarkir-dragonstorm', 'secret-lair',
      'single-magic', 'avatar-the-last-airbender', 'marvels-spider-man',
      'the-lord-of-the-rings', 'the-hobbit', 'marvel-super-heroes',
    ],
    resultado: { categoriaSlug: 'sellado', tipo: 'sellado', juego: 'magic' },
  },
  { slugs: ['pokemon'], resultado: { categoriaSlug: 'sellado', tipo: 'sellado', juego: 'pokemon' } },
  { slugs: ['one-piece-tcg'], resultado: { categoriaSlug: 'sellado', tipo: 'sellado', juego: 'one_piece' } },
  {
    slugs: ['riftbound-league-of-legends'],
    resultado: { categoriaSlug: 'sellado', tipo: 'sellado', juego: 'riftbound' },
  },
  {
    slugs: ['star-wars-unlimited'],
    resultado: { categoriaSlug: 'sellado', tipo: 'sellado', juego: 'star_wars' },
  },
  {
    slugs: ['flesh-and-blood'],
    resultado: { categoriaSlug: 'sellado', tipo: 'sellado', juego: 'flesh_and_blood' },
  },
  { slugs: ['tcg-sellado'], resultado: { categoriaSlug: 'sellado', tipo: 'sellado', juego: null } },
  {
    slugs: ['accesorios', 'sleeves', 'carpetas', 'deck-box', 'dados', 'playmate-tube'],
    resultado: { categoriaSlug: 'accesorios', tipo: 'accesorio', juego: null },
  },
  {
    slugs: ['figuras-pokemon', 'juguetes-coleccion'],
    resultado: { categoriaSlug: 'juguetes-y-coleccion', tipo: 'juguete', juego: null },
  },
  {
    slugs: ['juego-de-mesa', 'juegos-de-mesa', 'familiar', 'fiesta'],
    resultado: { categoriaSlug: 'juegos-de-mesa', tipo: 'juego_mesa', juego: null },
  },
  {
    slugs: ['juego-de-rol', 'juegos-de-rol'],
    resultado: { categoriaSlug: 'juegos-de-rol', tipo: 'juego_mesa', juego: null },
  },
  {
    slugs: ['eventos', 'eventos-tcg'],
    resultado: { categoriaSlug: 'eventos', tipo: 'evento', juego: null, activo: false },
  },
];

export function mapearOnplaygames(categorias: CategoriaDeProductoWoo[]): ResultadoMapeo {
  const slugs = categorias.map((c) => c.slug);
  for (const regla of REGLAS_ONPLAYGAMES) {
    if (slugs.some((s) => regla.slugs.includes(s))) {
      return { activo: true, ...regla.resultado };
    }
  }
  // `juego-de-cartas` es contenedor genérico: se ignora si hay otra categoría;
  // si es la única, → Sellado (§6.3).
  const sinGenericas = slugs.filter(
    (s) => !['juego-de-cartas', 'uncategorized', 'sin-categorizar'].includes(s),
  );
  if (slugs.includes('juego-de-cartas') && sinGenericas.length === 0) {
    return { categoriaSlug: 'sellado', tipo: 'sellado', juego: null, activo: true };
  }
  return SIN_CLASIFICAR;
}
