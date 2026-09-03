// Corrida completa — docs/06-SDD-etapa3-sincronizacion.md §4.2 y §6.1.
// La unidad programada: pedidos → precios → stock, en secuencia y por dependencia.
// El push de precios (Fase 3) y de stock (Fase 4) se enganchan aquí cuando existan;
// mientras tanto se reportan como omitidos con el motivo.
import { prisma } from '../db.js';
import { ErrorCorrida } from './corridas.js';
import type { CanalWoo } from './importador.js';
import { ingerirPedidos, type ResumenIngesta } from './pedidos.js';

export interface ResumenCompleta {
  canalId: string;
  simulacion: boolean;
  pedidos: ResumenIngesta | { omitida: string };
  precios: { omitida: string };
  stock: { omitida: string };
}

export async function correrCompleta(
  canalId: CanalWoo,
  opciones: { dryRun: boolean; usuarioId: string | null },
): Promise<ResumenCompleta> {
  const canal = await prisma.canal.findUnique({ where: { id: canalId } });
  if (!canal) throw new ErrorCorrida({ error: 'CANAL_DESCONOCIDO' }, 404);

  let pedidos: ResumenCompleta['pedidos'];
  if (canal.ingestaPedidos || opciones.dryRun) {
    pedidos = await ingerirPedidos(canalId, opciones);
  } else {
    pedidos = { omitida: 'ingestaPedidos apagado (G8)' };
  }
  return {
    canalId,
    simulacion: opciones.dryRun,
    pedidos,
    precios: { omitida: canal.pushPrecio ? 'push de precio: Fase 3 de E3 pendiente' : 'pushPrecio apagado (G8)' },
    stock: { omitida: canal.pushStock ? 'push de stock: Fase 4 de E3 pendiente' : 'pushStock apagado (G8)' },
  };
}
