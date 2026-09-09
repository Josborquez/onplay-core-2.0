// Configuración de canales — docs/06-SDD-etapa3-sincronizacion.md §6.3 (G8).
// Tres interruptores independientes que se encienden de a uno, en orden.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';

// Ping a la tienda con caché de 60 s: la marca de la barra lateral lo pide cada 5 min por usuario.
const cachePing = new Map<string, { en: number; ok: boolean }>();
async function tiendaResponde(canal: { url: string; ck: string; cs: string }): Promise<boolean> {
  try {
    const url = new URL('/wp-json/wc/v3/products', canal.url);
    url.searchParams.set('per_page', '1');
    url.searchParams.set('consumer_key', canal.ck);
    url.searchParams.set('consumer_secret', canal.cs);
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

export default async function rutasCanales(app: FastifyInstance) {
  const encargado = { preHandler: app.requiereRol('encargado') };
  const vendedor = { preHandler: app.requiereRol('vendedor') };

  // R-024: marca para cualquier rol (barra lateral): ¿responde la tienda? ¿cuándo se leyó el catálogo?
  app.get('/canales/estado', vendedor, async () => {
    const canales = await prisma.canal.findMany({ where: { tipo: 'woocommerce', activo: true }, orderBy: { id: 'asc' } });
    const grupos = await prisma.productoCanal.groupBy({ by: ['canalId'], _count: { _all: true }, _max: { sincronizadoEn: true } });
    const tiendas = await Promise.all(
      canales.map(async (c) => {
        const cfg = entorno.canales[c.id as 'onplay_cl' | 'onplaygames_cl'];
        const g = grupos.find((x) => x.canalId === c.id);
        let enLinea: boolean | null = null;
        if (cfg?.url && cfg.ck && cfg.cs) {
          const cache = cachePing.get(c.id);
          if (cache && Date.now() - cache.en < 60_000) enLinea = cache.ok;
          else {
            enLinea = await tiendaResponde(cfg);
            cachePing.set(c.id, { en: Date.now(), ok: enLinea });
          }
        }
        return { id: c.id, nombre: c.nombre, enLinea, ultimoCatalogoEn: g?._max.sincronizadoEn ?? null, productos: g?._count._all ?? 0 };
      }),
    );
    return { comprobadoEn: new Date().toISOString(), tiendas };
  });

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

  // R-024: el encargado puede encender/apagar la lectura de pedidos (no escribe en la tienda);
  // publicar precio o stock sigue siendo solo admin.
  app.patch<{ Params: { id: string }; Body: CuerpoCanal }>('/canales/:id', encargado, async (req, reply) => {
    const tocaPush = req.body && ('pushPrecio' in req.body || 'pushStock' in req.body);
    if (tocaPush && req.user.rol !== 'admin') return reply.code(403).send({ error: 'ROL_INSUFICIENTE', detalle: 'Solo el administrador puede publicar en la tienda' });
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
