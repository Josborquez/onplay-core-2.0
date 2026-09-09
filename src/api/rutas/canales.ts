// Configuración de canales — docs/06-SDD-etapa3-sincronizacion.md §6.3 (G8).
// Tres interruptores independientes que se encienden de a uno, en orden.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';

export default async function rutasCanales(app: FastifyInstance) {
  const admin = { preHandler: app.requiereRol('admin') };
  const encargado = { preHandler: app.requiereRol('encargado') };

  app.get('/canales', encargado, async () => {
    const canales = await prisma.canal.findMany({ orderBy: { id: 'asc' } });
    const ultimas = await prisma.syncCorrida.findMany({
      where: { estado: { not: 'en_curso' } },
      orderBy: { iniciadaEn: 'desc' },
      distinct: ['canalId', 'tipo'],
      select: { canalId: true, tipo: true, estado: true, simulacion: true, iniciadaEn: true, terminadaEn: true, leidos: true, escritos: true, detenidos: true, fallidos: true },
    });
    return {
      soloLectura: entorno.syncSoloLectura,
      ubicacionOnline: entorno.syncUbicacionOnline,
      canales: canales.map((c) => ({
        ...c,
        credenciales: c.tipo === 'woocommerce' && !!entorno.canales[c.id as 'onplay_cl' | 'onplaygames_cl']?.ck,
        ultimasCorridas: ultimas.filter((u) => u.canalId === c.id),
      })),
    };
  });

  interface CuerpoCanal {
    ingestaPedidos?: unknown;
    pushPrecio?: unknown;
    pushStock?: unknown;
  }

  app.patch<{ Params: { id: string }; Body: CuerpoCanal }>('/canales/:id', admin, async (req, reply) => {
    const canal = await prisma.canal.findUnique({ where: { id: req.params.id } });
    if (!canal) return reply.code(404).send({ error: 'CANAL_DESCONOCIDO' });
    if (canal.tipo !== 'woocommerce') {
      return reply.code(422).send({ error: 'CANAL_SIN_SYNC', detalle: 'Solo los canales WooCommerce sincronizan' });
    }
    const b = req.body ?? {};
    const leer = (v: unknown, actual: boolean) => (typeof v === 'boolean' ? v : actual);
    const nuevo = {
      ingestaPedidos: leer(b.ingestaPedidos, canal.ingestaPedidos),
      pushPrecio: leer(b.pushPrecio, canal.pushPrecio),
      pushStock: leer(b.pushStock, canal.pushStock),
    };
    // §6.3: publicar stock sin ingerir ventas online garantiza deriva en cada corrida.
    if (nuevo.pushStock && !nuevo.ingestaPedidos) {
      return reply.code(422).send({
        error: 'INGESTA_REQUERIDA',
        detalle: 'Primero hay que encender la ingesta de pedidos. Publicar stock sin ingerir ventas online produce diferencias en cada corrida.',
      });
    }
    if ((nuevo.pushPrecio || nuevo.pushStock) && entorno.syncSoloLectura) {
      return reply.code(422).send({
        error: 'CANDADO_SOLO_LECTURA',
        detalle: 'SYNC_SOLO_LECTURA sigue activo (Fase 0 de E3): el push no puede encenderse hasta abrir el candado en el entorno.',
      });
    }
    // La ingesta parte desde el momento en que se enciende: sin marca previa, la marca es ahora.
    const marca = nuevo.ingestaPedidos && !canal.ingestaPedidos && !canal.ultimaIngestaEn ? { ultimaIngestaEn: new Date() } : {};
    const actualizado = await prisma.$transaction(async (tx) => {
      const c = await tx.canal.update({ where: { id: canal.id }, data: { ...nuevo, ...marca } });
      await tx.auditoria.create({
        data: {
          usuarioId: req.user.sub,
          entidad: 'canal',
          entidadId: canal.id,
          accion: 'editar',
          valorAnterior: { ingestaPedidos: canal.ingestaPedidos, pushPrecio: canal.pushPrecio, pushStock: canal.pushStock },
          valorNuevo: { ...nuevo, ...(marca.ultimaIngestaEn ? { ultimaIngestaEn: marca.ultimaIngestaEn.toISOString() } : {}) },
        },
      });
      return c;
    });
    return actualizado;
  });
}
