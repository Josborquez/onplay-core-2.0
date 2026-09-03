// Cron incremental (02-SDD §6.5): node-cron cada 30 minutos, dentro del
// proceso de la API (Principio P6). Canales sin credenciales se saltan en
// silencio; un fallo de corrida queda en SyncLog y no tumba el proceso.
import cron from 'node-cron';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import { CANALES_WOO, sincronizarIncremental, type CanalWoo } from './importador.js';
import { ErrorCorrida } from './corridas.js';
import { correrCompleta } from './completa.js';

let corriendo = false;

export async function correrIncrementales(log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }): Promise<void> {
  if (corriendo) return; // una corrida a la vez
  corriendo = true;
  try {
    for (const canalId of CANALES_WOO) {
      const cfg = entorno.canales[canalId];
      if (!cfg.url || !cfg.ck || !cfg.cs) continue;
      try {
        const r = await sincronizarIncremental(canalId);
        log.info(r, `sync incremental ${canalId}`);
      } catch (e) {
        log.error(e, `sync incremental ${canalId} falló`);
        await prisma.syncLog
          .create({
            data: {
              canalId,
              operacion: 'incremental',
              resultado: 'error',
              detalle: `corrida fallida: ${(e as Error).message}`,
            },
          })
          .catch(() => {});
      }
    }
  } finally {
    corriendo = false;
  }
}

export function iniciarCronIncremental(log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }): void {
  if (!entorno.syncHabilitado) {
    log.info({}, 'cron incremental deshabilitado por SYNC_HABILITADO=false (§11)');
    return;
  }
  cron.schedule(entorno.syncCron, () => void correrIncrementales(log));
  log.info({ cron: entorno.syncCron }, 'cron incremental programado (§6.5)');
}

// ─── E3 §6.4: corrida completa (pedidos → precios → stock) cada 15 min ─────────
// Solo corre en los canales con algún interruptor encendido. El cerrojo por
// (canal, tipo) de corridas.ts impide solaparse con una corrida manual (409 → se salta).

type Log = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };

let corriendoCompleta = false;

export async function correrCompletas(log: Log): Promise<void> {
  if (corriendoCompleta) return;
  corriendoCompleta = true;
  try {
    const canales = await prisma.canal.findMany({
      where: { tipo: 'woocommerce', activo: true, OR: [{ ingestaPedidos: true }, { pushPrecio: true }, { pushStock: true }] },
      select: { id: true },
    });
    for (const { id } of canales) {
      const canalId = id as CanalWoo;
      if (!CANALES_WOO.includes(canalId)) continue;
      const cfg = entorno.canales[canalId];
      if (!cfg.url || !cfg.ck || !cfg.cs) continue;
      try {
        const r = await correrCompleta(canalId, { dryRun: false, usuarioId: null });
        log.info(
          { canalId, pedidos: 'resumen' in r.pedidos ? r.pedidos.resumen : r.pedidos, precios: r.precios, stock: r.stock },
          `sync completa ${canalId}`,
        );
      } catch (e) {
        if (e instanceof ErrorCorrida && e.cuerpo.error === 'CORRIDA_EN_CURSO') {
          log.warn({ canalId }, 'sync completa saltada: corrida en curso');
        } else {
          log.error(e, `sync completa ${canalId} falló`);
        }
      }
    }
  } finally {
    corriendoCompleta = false;
  }
}

export function iniciarCronCompleta(log: Log): void {
  if (!entorno.syncHabilitado) {
    log.info({}, 'cron de corrida completa deshabilitado por SYNC_HABILITADO=false');
    return;
  }
  cron.schedule(entorno.syncCronCompleta, () => void correrCompletas(log));
  log.info({ cron: entorno.syncCronCompleta }, 'cron de corrida completa programado (E3 §6.4)');
}
