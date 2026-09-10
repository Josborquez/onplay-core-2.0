// Extracción de texto de un PDF en filas y celdas — docs/11-SDD-etapa6-compras.md §6.3.
// pdfjs entrega cada trozo de texto con su posición; aquí se agrupan por altura (fila) y se
// ordenan de izquierda a derecha (celda). Los lectores por distribuidor trabajan sobre esas celdas
// y nunca sobre el PDF: así cada lector es una función pura con test.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Una página = filas; una fila = celdas de texto ya recortadas, de izquierda a derecha. */
export type PaginaTexto = string[][];

const TOLERANCIA_FILA = 2; // puntos: trozos a ±2 pt de altura pertenecen a la misma fila

export async function extraerPaginasPdf(archivo: Uint8Array): Promise<PaginaTexto[]> {
  const doc = await getDocument({
    data: new Uint8Array(archivo),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;
  const paginas: PaginaTexto[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const pagina = await doc.getPage(p);
      const contenido = await pagina.getTextContent();
      const filas = new Map<number, { x: number; s: string }[]>();
      for (const item of contenido.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5] as number);
        const x = item.transform[4] as number;
        let clave: number | undefined;
        for (const k of filas.keys()) {
          if (Math.abs(k - y) <= TOLERANCIA_FILA) {
            clave = k;
            break;
          }
        }
        if (clave === undefined) {
          clave = y;
          filas.set(clave, []);
        }
        filas.get(clave)!.push({ x, s: item.str.trim() });
      }
      const ordenadas = [...filas.entries()].sort((a, b) => b[0] - a[0]); // arriba → abajo
      paginas.push(ordenadas.map(([, celdas]) => celdas.sort((a, b) => a.x - b.x).map((c) => c.s)));
      pagina.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return paginas;
}
