// Reglas puras de la Etapa 3 — docs/06-SDD-etapa3-sincronizacion.md §4 y §8.
// Sin acceso a red ni a base: reciben los tres números y devuelven la decisión.

export type AccionPush = 'escribir' | 'detener' | 'omitir';

export type MotivoDetencionStock = 'stock_derivado' | 'primera_publicacion' | 'canal_sin_gestion';
export type MotivoOmisionStock = 'sin_control_stock' | 'no_publicado';

export interface EntradaDecisionStock {
  controlaStock: boolean; // §7.3 condición dura
  publicado: boolean;
  manejaStockCanal: boolean | null; // §7.4: manage_stock del canal
  maestro: number; // S_maestro = SUM(stock_actual) sobre ubicaciones publicables
  canal: number | null; // S_canal leído AHORA
  publicadoAntes: number | null; // S_publicado: lo último que escribió este sistema
}

export interface DecisionStock {
  accion: AccionPush;
  motivo?: MotivoDetencionStock | MotivoOmisionStock;
  deriva?: number;
  explicacion?: string;
}

/**
 * §4.1 — verificación previa contra el valor publicado. El orden de las reglas importa:
 * primero la elegibilidad (§7.3), después la adopción (§4.4), después la deriva.
 */
export function decidirPushStock(e: EntradaDecisionStock): DecisionStock {
  if (!e.controlaStock) return { accion: 'omitir', motivo: 'sin_control_stock' };
  if (!e.publicado) return { accion: 'omitir', motivo: 'no_publicado' };
  if (e.manejaStockCanal === false) {
    return {
      accion: 'detener',
      motivo: 'canal_sin_gestion',
      explicacion:
        'El canal no gestiona stock para este producto (manage_stock apagado). Encenderlo es decisión de una persona (§7.4).',
    };
  }
  if (e.publicadoAntes === null || e.canal === null) {
    return {
      accion: 'detener',
      motivo: 'primera_publicacion',
      explicacion: 'Nunca se publicó el stock de este producto. Requiere adopción (§4.4).',
    };
  }
  const deriva = e.canal - e.publicadoAntes;
  if (deriva !== 0) {
    return { accion: 'detener', motivo: 'stock_derivado', deriva, explicacion: explicarDeriva(deriva) };
  }
  if (e.maestro === e.canal) return { accion: 'omitir' };
  return { accion: 'escribir', deriva: 0 };
}

/** Frase de V13: qué se deduce de una deriva. */
export function explicarDeriva(deriva: number): string {
  const n = Math.abs(deriva);
  const u = n === 1 ? 'unidad' : 'unidades';
  if (deriva < 0) {
    return `El canal bajó ${n} ${u} que el maestro no registró. Probablemente una venta online sin ingerir, o un ajuste manual en wp-admin.`;
  }
  return `El canal subió ${n} ${u} que el maestro no registró. Probablemente un ajuste manual en wp-admin o una devolución hecha en la tienda web.`;
}

export interface EntradaDecisionPrecio {
  publicado: boolean;
  maestro: number; // precioVenta (o precioCanal si existe)
  regularCanal: number | null; // regular_price leído ahora
  enOferta: boolean; // sale_price activo → no se toca (§4.3, RS7)
  precioPublicado: number | null;
}

export interface DecisionPrecio {
  accion: AccionPush;
  motivo?: 'precio_en_oferta' | 'no_publicado' | 'sin_precio';
  informativa?: 'precio_derivado'; // se escribe igual, pero se avisa
}

/** §4.3 — el precio avanza (salvo oferta), el stock se detiene. */
export function decidirPushPrecio(e: EntradaDecisionPrecio): DecisionPrecio {
  if (!e.publicado) return { accion: 'omitir', motivo: 'no_publicado' };
  if (e.maestro <= 0) return { accion: 'omitir', motivo: 'sin_precio' };
  if (e.enOferta) return { accion: 'detener', motivo: 'precio_en_oferta' };
  const derivado =
    e.precioPublicado !== null && e.regularCanal !== null && e.regularCanal !== e.precioPublicado;
  const informativa = derivado ? { informativa: 'precio_derivado' as const } : {};
  if (e.regularCanal === e.maestro) return { accion: 'omitir', ...informativa };
  return { accion: 'escribir', ...informativa };
}

// ─── Ingesta de pedidos (§8) ──────────────────────────────────────────────────

export const ESTADOS_PAGADOS = ['processing', 'completed'] as const;
export const ESTADOS_ANULADOS = ['cancelled', 'refunded'] as const;

export function pedidoPagado(status: string): boolean {
  return (ESTADOS_PAGADOS as readonly string[]).includes(status);
}

export function pedidoAnulado(status: string): boolean {
  return (ESTADOS_ANULADOS as readonly string[]).includes(status);
}

export interface ReembolsoLineaEntrada {
  id: number; // id de la línea del pedido original
  quantity: number; // Woo la manda NEGATIVA
}

/**
 * §8.3 — cantidades devueltas por línea a partir de los reembolsos de Woo.
 * Suma valores absolutos; ignora líneas sin cantidad (reembolsos de monto sin ítems).
 */
export function devueltasPorLinea(reembolsos: { line_items: ReembolsoLineaEntrada[] }[]): Map<number, number> {
  const mapa = new Map<number, number>();
  for (const r of reembolsos) {
    for (const l of r.line_items ?? []) {
      const q = Math.abs(Number(l.quantity) || 0);
      if (q === 0) continue;
      mapa.set(l.id, (mapa.get(l.id) ?? 0) + q);
    }
  }
  return mapa;
}

/** Monto CLP entero desde el string de Woo ("31775", "-99990", "25201.68"). */
export function montoDesdeWoo(texto: string | number | null | undefined): number {
  const n = Math.round(Number(texto ?? 0));
  return Number.isFinite(n) ? n : 0;
}
