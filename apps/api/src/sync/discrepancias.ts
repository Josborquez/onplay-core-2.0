// Discrepancias — docs/06-SDD-etapa3-sincronizacion.md §5.2 y §6.2.
// Una sola ABIERTA por sujeto y tipo: la clave `claveAbierta` ("<sujeto>:<tipo>") es
// única en la base y vale null al resolver, así que las corridas siguientes actualizan
// la existente (vecesVista + 1) en vez de crear otra (criterio 10).
import type { Prisma, PrismaClient, TipoDiscrepancia } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export interface EntradaDiscrepancia {
  canalId: string;
  tipo: TipoDiscrepancia;
  productoCanalId?: string | null;
  pedidoCanalId?: string | null;
  pedidoCanalLineaId?: string | null;
  valorMaestro?: number | null;
  valorCanal?: number | null;
  valorPublicado?: number | null;
  detalle?: string | null;
}

export function claveAbierta(e: EntradaDiscrepancia): string {
  const sujeto = e.pedidoCanalLineaId
    ? `lin:${e.pedidoCanalLineaId}`
    : e.pedidoCanalId
      ? `ped:${e.pedidoCanalId}`
      : e.productoCanalId
        ? `pc:${e.productoCanalId}`
        : `canal:${e.canalId}`;
  return `${sujeto}:${e.tipo}`;
}

/** Abre la discrepancia o, si ya hay una abierta para el mismo sujeto y tipo, la actualiza. */
export async function registrarDiscrepancia(
  db: Db,
  e: EntradaDiscrepancia,
): Promise<{ id: string; nueva: boolean; vecesVista: number }> {
  const clave = claveAbierta(e);
  const existente = await db.discrepancia.findUnique({ where: { claveAbierta: clave }, select: { id: true, vecesVista: true } });
  if (existente) {
    const d = await db.discrepancia.update({
      where: { id: existente.id },
      data: {
        vecesVista: { increment: 1 },
        vistaEn: new Date(),
        valorMaestro: e.valorMaestro ?? undefined,
        valorCanal: e.valorCanal ?? undefined,
        valorPublicado: e.valorPublicado ?? undefined,
        detalle: e.detalle ?? undefined,
      },
      select: { id: true, vecesVista: true },
    });
    return { id: d.id, nueva: false, vecesVista: d.vecesVista };
  }
  const d = await db.discrepancia.create({
    data: {
      canalId: e.canalId,
      tipo: e.tipo,
      productoCanalId: e.productoCanalId ?? null,
      pedidoCanalId: e.pedidoCanalId ?? null,
      pedidoCanalLineaId: e.pedidoCanalLineaId ?? null,
      valorMaestro: e.valorMaestro ?? null,
      valorCanal: e.valorCanal ?? null,
      valorPublicado: e.valorPublicado ?? null,
      detalle: e.detalle ?? null,
      claveAbierta: clave,
    },
    select: { id: true, vecesVista: true },
  });
  return { id: d.id, nueva: true, vecesVista: d.vecesVista };
}

/** Cierra una discrepancia (resuelta o descartada) liberando la clave. */
export async function cerrarDiscrepancia(
  db: Db,
  id: string,
  datos: { estado: 'resuelta' | 'descartada'; usuarioId: string; accionTomada: string },
) {
  return db.discrepancia.update({
    where: { id },
    data: {
      estado: datos.estado,
      claveAbierta: null,
      resueltaEn: new Date(),
      resueltaPorId: datos.usuarioId,
      accionTomada: datos.accionTomada,
    },
  });
}

/** Cierra en bloque las abiertas de un sujeto y tipo (p. ej. al mapear una línea). */
export async function cerrarAbiertasDe(
  db: Db,
  sujeto: Pick<EntradaDiscrepancia, 'canalId' | 'tipo' | 'productoCanalId' | 'pedidoCanalId' | 'pedidoCanalLineaId'>,
  datos: { usuarioId: string; accionTomada: string },
): Promise<number> {
  const clave = claveAbierta(sujeto);
  const r = await db.discrepancia.updateMany({
    where: { claveAbierta: clave },
    data: {
      estado: 'resuelta',
      claveAbierta: null,
      resueltaEn: new Date(),
      resueltaPorId: datos.usuarioId,
      accionTomada: datos.accionTomada,
    },
  });
  return r.count;
}

/** Explicación en castellano para V13 según el tipo. */
export const TITULO_DISCREPANCIA: Record<TipoDiscrepancia, string> = {
  stock_derivado: 'El stock del canal cambió sin que el maestro lo registrara',
  precio_derivado: 'El precio del canal cambió por fuera del maestro',
  precio_en_oferta: 'Producto en oferta: el maestro no toca su precio',
  primera_publicacion: 'Nunca se publicó el stock de este producto',
  producto_sin_mapear: 'Línea de pedido sin producto en el maestro',
  producto_desaparecido: 'El producto ya no existe en el canal',
  pedido_anulado: 'Pedido cancelado o reembolsado después de ingerirlo',
  pedido_sin_stock: 'Pedido pagado sin stock en el maestro',
};
