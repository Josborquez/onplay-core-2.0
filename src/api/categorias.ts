// Árbol de categorías: helpers compartidos (productos, stock, recuentos).
import { prisma } from './db.js';

/** Ids de una categoría y todas sus descendientes. El árbol es chico (~20): se carga entero. */
export async function idsSubarbol(categoriaId: string): Promise<string[]> {
  const todas = await prisma.categoria.findMany({ select: { id: true, padreId: true } });
  const hijos = new Map<string, string[]>();
  for (const c of todas) {
    if (c.padreId) hijos.set(c.padreId, [...(hijos.get(c.padreId) ?? []), c.id]);
  }
  const ids: string[] = [];
  const pila = [categoriaId];
  while (pila.length) {
    const id = pila.pop()!;
    ids.push(id);
    pila.push(...(hijos.get(id) ?? []));
  }
  return ids;
}
