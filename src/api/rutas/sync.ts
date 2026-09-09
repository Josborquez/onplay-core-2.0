// Rutas de sincronización F1 — 02-SDD §6 y §9.
// Todas requieren rol admin. El import es dryRun por defecto (regla S1):
// escribir exige ?dryRun=false explícito.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import { CANALES_WOO, importarCanal, sincronizarIncremental, type CanalWoo } from '../sync/importador.js';
import { importarClientesCanal } from '../sync/clientes.js';

export default async function rutasSync(app: FastifyInstance) {
  const soloAdmin = { preHandler: app.requiereRol('admin') };

  app.post<{ Params: { canalId: string }; Querystring: { dryRun?: string } }>(
    '/sync/:canalId/importar',
    soloAdmin,
    async (req, reply) => {
      const canalId = req.params.canalId as CanalWoo;
      if (!CANALES_WOO.includes(canalId)) {
        return reply.code(404).send({ error: 'CANAL_DESCONOCIDO' });
      }
      const dryRun = req.query.dryRun !== 'false';
      try {
        return await importarCanal(canalId, { dryRun });
      } catch (e) {
        req.log.error(e);
        return reply
          .code(502)
          .send({ error: 'IMPORTACION_FALLIDA', detalle: (e as Error).message });
      }
    },
  );

  // Importación de clientes del canal — E4 §7.3 (C7). dryRun por defecto (S1):
  // la corrida real solo VINCULA coincidencias por correo, jamás crea clientes.
  app.post<{ Params: { canalId: string }; Querystring: { dryRun?: string } }>(
    '/sync/:canalId/clientes',
    soloAdmin,
    async (req, reply) => {
      const canalId = req.params.canalId as CanalWoo;
      if (!CANALES_WOO.includes(canalId)) {
        return reply.code(404).send({ error: 'CANAL_DESCONOCIDO' });
      }
      const dryRun = req.query.dryRun !== 'false';
      try {
        return await importarClientesCanal(canalId, { dryRun, usuarioId: req.user.sub });
      } catch (e) {
        req.log.error(e);
        return reply
          .code(502)
          .send({ error: 'IMPORTACION_FALLIDA', detalle: (e as Error).message });
      }
    },
  );

  // Corrida incremental manual (§6.5): la misma que dispara el cron cada 30 min.
  app.post<{ Params: { canalId: string } }>(
    '/sync/:canalId/incremental',
    soloAdmin,
    async (req, reply) => {
      const canalId = req.params.canalId as CanalWoo;
      if (!CANALES_WOO.includes(canalId)) {
        return reply.code(404).send({ error: 'CANAL_DESCONOCIDO' });
      }
      try {
        return await sincronizarIncremental(canalId);
      } catch (e) {
        req.log.error(e);
        return reply
          .code(502)
          .send({ error: 'SYNC_FALLIDO', detalle: (e as Error).message });
      }
    },
  );

  app.get<{
    Querystring: { canalId?: string; resultado?: string; resuelto?: string; pagina?: string };
  }>('/sync/logs', soloAdmin, async (req) => {
    const pagina = Math.max(1, Number(req.query.pagina ?? 1) || 1);
    const porPagina = 100;
    const where = {
      ...(req.query.canalId ? { canalId: req.query.canalId } : {}),
      ...(req.query.resultado ? { resultado: req.query.resultado } : {}),
      ...(req.query.resuelto !== undefined ? { resuelto: req.query.resuelto === 'true' } : {}),
    };
    const [total, logs] = await Promise.all([
      prisma.syncLog.count({ where }),
      prisma.syncLog.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
    ]);
    return { total, pagina, porPagina, logs };
  });

  app.patch<{ Params: { id: string }; Body: { resuelto?: boolean } }>(
    '/sync/logs/:id',
    soloAdmin,
    async (req, reply) => {
      if (typeof req.body?.resuelto !== 'boolean') {
        return reply.code(400).send({ error: 'CUERPO_INVALIDO', detalle: 'se espera { resuelto: boolean }' });
      }
      try {
        return await prisma.syncLog.update({
          where: { id: req.params.id },
          data: { resuelto: req.body.resuelto },
        });
      } catch {
        return reply.code(404).send({ error: 'LOG_NO_ENCONTRADO' });
      }
    },
  );

  app.get('/sync/estado', soloAdmin, async () => {
    const [porCanal, erroresAbiertos, ultimaCorrida] = await Promise.all([
      prisma.productoCanal.groupBy({
        by: ['canalId'],
        _count: { _all: true },
        _max: { sincronizadoEn: true },
      }),
      prisma.syncLog.count({ where: { resultado: 'error', resuelto: false } }),
      prisma.syncLog.findFirst({
        where: { operacion: 'importar', resultado: { in: ['ok', 'ok_con_errores'] } },
        orderBy: { creadoEn: 'desc' },
      }),
    ]);
    return {
      soloLectura: entorno.syncSoloLectura,
      canales: porCanal.map((c) => ({
        canalId: c.canalId,
        productos: c._count._all,
        ultimoSync: c._max.sincronizadoEn,
      })),
      erroresAbiertos,
      ultimaCorrida,
    };
  });
}
