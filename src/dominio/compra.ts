// Reglas puras de compras — docs/11-SDD-etapa6-compras.md §6.
// Aquí se calcula y se cuadra; leer el PDF y escribir en la base viven en src/api/compras.

export type LectorFactura = 'manual' | 'andina';
export type TipoDocumentoCompra = 'factura' | 'boleta' | 'guia' | 'otro';

/** Una línea tal como la entrega un lector (o la digita una persona). Montos en CLP enteros. */
export interface LineaLeida {
  codigoProveedor: string | null;
  descripcion: string;
  bultos: number; // cajas
  unidadesPorBulto: number; // 12 si la caja trae 12
  sueltas: number; // unidades fuera de caja
  neto: number;
  impuestos: number; // IVA + específicos de la línea
  total: number; // neto + impuestos
}

export interface LineaCalculada extends LineaLeida {
  cantidad: number; // unidades que entran al stock
  costoUnitario: number; // total / cantidad, redondeado
}

export interface TotalesLeidos {
  neto: number;
  impuestos: number;
  total: number;
}

/** Lo que devuelve un lector: cabecera + líneas + lo que no pudo entender (para la persona). */
export interface DocumentoLeido {
  lector: LectorFactura;
  proveedor: { rut: string | null; nombre: string | null };
  tipoDocumento: TipoDocumentoCompra;
  numeroDocumento: string | null;
  fechaDocumento: string | null; // ISO yyyy-mm-dd
  lineas: LineaLeida[];
  totales: TotalesLeidos | null;
  advertencias: string[];
}

export type ErrorCompra =
  | { codigo: 'CANTIDAD_INVALIDA'; detalle: string }
  | { codigo: 'BULTO_INVALIDO'; detalle: string }
  | { codigo: 'MONTO_INVALIDO'; detalle: string };

/** Proveedores reconocidos por RUT (normalizado, sin puntos) → lector que entiende su documento. */
export const LECTOR_POR_RUT: Readonly<Record<string, LectorFactura>> = {
  '91144000-8': 'andina', // Embotelladora Andina S.A. (Coca-Cola)
};

export function lectorPorRut(rutNormalizado: string | null | undefined): LectorFactura | null {
  if (!rutNormalizado) return null;
  return LECTOR_POR_RUT[rutNormalizado] ?? null;
}

/** "14.956" → 14956 · "6,50" → 6.5 · "1.337" → 1337. Formato chileno: punto de miles, coma decimal. */
export function parsearNumeroCl(texto: string): number | null {
  const limpio = texto.trim().replace(/\s/g, '');
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(limpio)) return null;
  const n = Number(limpio.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** «Vital C/G PT600cc x 12 ter» → 12 · «Monster Energy LT473cc x 6» → 6 · sin «x N» → null. */
export function unidadesPorBultoDesdeDescripcion(descripcion: string): number | null {
  const m = /(?:^|\s)x\s*(\d{1,3})(?=\s|$)/i.exec(descripcion);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}

/**
 * Cantidad y costo unitario de una línea (§6.1):
 * cantidad = bultos × unidadesPorBulto + sueltas (> 0); costoUnitario = total / cantidad redondeado.
 * El costo unitario es lo que cuesta cada unidad puesta en la tienda: incluye IVA e impuestos
 * específicos (D-E6-1).
 */
export function calcularLinea(l: LineaLeida): LineaCalculada | ErrorCompra {
  if (!Number.isInteger(l.unidadesPorBulto) || l.unidadesPorBulto < 1) {
    return { codigo: 'BULTO_INVALIDO', detalle: 'Las unidades por bulto deben ser un entero ≥ 1.' };
  }
  if (!Number.isInteger(l.bultos) || l.bultos < 0 || !Number.isInteger(l.sueltas) || l.sueltas < 0) {
    return { codigo: 'CANTIDAD_INVALIDA', detalle: 'Bultos y sueltas deben ser enteros ≥ 0.' };
  }
  const cantidad = l.bultos * l.unidadesPorBulto + l.sueltas;
  if (cantidad <= 0) return { codigo: 'CANTIDAD_INVALIDA', detalle: 'La línea debe traer al menos 1 unidad.' };
  const montos: [string, number][] = [
    ['neto', l.neto],
    ['impuestos', l.impuestos],
    ['total', l.total],
  ];
  for (const [nombre, v] of montos) {
    if (!Number.isInteger(v) || v < 0) return { codigo: 'MONTO_INVALIDO', detalle: `El ${nombre} debe ser un entero ≥ 0.` };
  }
  return { ...l, cantidad, costoUnitario: Math.round(l.total / cantidad) };
}

export interface TotalesCuadrados extends TotalesLeidos {
  /** Lo que suman las líneas, para mostrar junto a lo que dice el documento. */
  sumaLineas: TotalesLeidos;
  advertencias: string[];
}

/**
 * Cuadra la suma de las líneas contra los totales del documento (§6.2). Manda el documento (es lo
 * que se paga); si difiere de la suma en más de $1 por línea (redondeos) se avisa, no se bloquea.
 * Sin totales en el documento (digitado a mano), los totales SON la suma.
 */
export function cuadrarTotales(lineas: LineaCalculada[], documento: TotalesLeidos | null): TotalesCuadrados {
  const suma = lineas.reduce(
    (acc, l) => ({ neto: acc.neto + l.neto, impuestos: acc.impuestos + l.impuestos, total: acc.total + l.total }),
    { neto: 0, impuestos: 0, total: 0 },
  );
  if (!documento) return { ...suma, sumaLineas: suma, advertencias: [] };
  const tolerancia = Math.max(1, lineas.length);
  const advertencias: string[] = [];
  for (const campo of ['neto', 'total'] as const) {
    const dif = Math.abs(documento[campo] - suma[campo]);
    if (dif > tolerancia) {
      advertencias.push(
        `El ${campo} del documento ($${documento[campo].toLocaleString('es-CL')}) no cuadra con la suma de las líneas ($${suma[campo].toLocaleString('es-CL')}): diferencia $${dif.toLocaleString('es-CL')}.`,
      );
    }
  }
  return { ...documento, sumaLineas: suma, advertencias };
}

/** "09-09-2026" | "09/09/2026" → "2026-09-09"; "2026-09-09" tal cual; otra cosa → null. */
export function fechaIsoDesdeCl(texto: string): string | null {
  const t = texto.trim();
  let m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  return null;
}
