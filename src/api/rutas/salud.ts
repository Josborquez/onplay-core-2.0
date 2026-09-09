// /salud (02-SDD §5.7, ampliado en 10-SDD §5.7): público, sin credenciales, < 200 ms y SIN consultar
// las tiendas Woo (eso lo hace GET /sync/estado con sesión). Lo lee el cron de cuenta de Hostinger
// cada 5 min: mantiene el proceso despierto, vigila y deja rastro.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import { estadoMigraciones } from '../arranque/migrador.js';
import { ultimoCronEn } from '../sync/cron.js';
import { version } from '../version.js';

let arrancadoEn: Date | null = null;
export function marcarArranque(): void {
  arrancadoEn = new Date();
}

export type EstadoSalud = 'ok' | 'sin_usuarios' | 'migraciones' | 'error';

export default async function rutasSalud(app: FastifyInstance) {
  app.get('/salud', async () => {
    const t = Date.now();
    let base: 'ok' | 'error' = 'ok';
    let usuarios = 0;
    let migraciones: 'alDia' | 'pendientes' | 'fallidas' | 'desconocido' = 'desconocido';
    let ultimaCorridaEn: Date | null = null;
    try {
      await prisma.$queryRaw`SELECT 1`;
      usuarios = await prisma.usuario.count({ where: { activo: true } });
      const est = await estadoMigraciones(prisma);
      migraciones = est.fallidas.length > 0 || est.conflictos.length > 0 ? 'fallidas' : est.pendientes.length > 0 ? 'pendientes' : 'alDia';
      // Última corrida del cron que quedó en base (sobrevive a reinicios; el tick en memoria no).
      const ultimo = await prisma.syncLog.findFirst({
        where: { operacion: { in: ['incremental', 'completa'] } },
        orderBy: { creadoEn: 'desc' },
        select: { creadoEn: true },
      });
      ultimaCorridaEn = ultimo?.creadoEn ?? null;
    } catch {
      base = 'error';
    }
    const estado: EstadoSalud = base !== 'ok' ? 'error' : usuarios === 0 ? 'sin_usuarios' : migraciones !== 'alDia' ? 'migraciones' : 'ok';
    return {
      estado,
      ok: estado === 'ok',
      db: base === 'ok',
      base,
      migraciones,
      usuarios,
      version,
      arrancadoEn,
      cronHabilitado: entorno.syncHabilitado,
      ultimoCronEn: ultimoCronEn(),
      ultimaCorridaEn,
      ms: Date.now() - t,
    };
  });
}
