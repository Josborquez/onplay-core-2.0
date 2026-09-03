// Corrida completa — docs/06-SDD-etapa3-sincronizacion.md §4.2 y §6.1.
// La unidad programada: pedidos → precios → stock, en secuencia y por dependencia.
// Cada paso corre solo si su interruptor está encendido (G8) o si es simulación; el push
// de stock además exige una ingesta real reciente (lo comprueba publicarStock, §4.2).
import { prisma } from '../db.js';
import { ErrorCorrida } from './corridas.js';
import type { CanalWoo } from './importador.js';
import { ingerirPedidos, type ResumenIngesta } from './pedidos.js';
import { publicarPrecios, publicarStock, type ResumenPush } from './push.js';

type Omitida = { omitida: string };

export interface ResumenCompleta {
  canalId: string;
  simulacion: boolean;
  pedidos: ResumenIngesta | Omitida;
  precios: ResumenPush | Omitida;
  stock: ResumenPush | Omitida;
}

export async function correrCompleta(
  canalId: CanalWoo,
  opciones: { dryRun: boolean; usuarioId: string | null },
): Promise<ResumenCompleta> {
  const canal = await prisma.canal.findUnique({ where: { id: canalId } });
  if (!canal) throw new ErrorCorrida({ error: 'CANAL_DESCONOCIDO' }, 404);
  const { dryRun } = opciones;

  const pedidos: ResumenCompleta['pedidos'] =
    canal.ingestaPedidos || dryRun ? await ingerirPedidos(canalId, opciones) : { omitida: 'ingestaPedidos apagado (G8)' };

  const precios: ResumenCompleta['precios'] =
    canal.pushPrecio || dryRun ? await publicarPrecios(canalId, opciones) : { omitida: 'pushPrecio apagado (G8)' };

  // Nunca se publica stock antes de ingerir (§4.2): si la ingesta de esta corrida falló, no se intenta.
  let stock: ResumenCompleta['stock'];
  if (!(canal.pushStock || dryRun)) stock = { omitida: 'pushStock apagado (G8)' };
  else if ('omitida' in pedidos) stock = { omitida: 'sin ingesta en esta corrida (§4.2)' };
  else stock = await publicarStock(canalId, opciones);

  return { canalId, simulacion: dryRun, pedidos, precios, stock };
}
