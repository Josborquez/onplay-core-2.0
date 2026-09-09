// Rutas de la Etapa 3 — docs/06-SDD-etapa3-sincronizacion.md §6.
// Conviven con `sync.ts` (pull de catálogo de E1). dryRun por defecto en toda corrida (S1).
import type { EstadoCorrida, EstadoDiscrepancia, TipoCorrida, TipoDiscrepancia } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import { ErrorStock, registrarMovimiento } from '../stock/libro.js';
import { ErrorCorrida } from '../sync/corridas.js';
import { TITULO_DISCREPANCIA, cerrarDiscrepancia } from '../sync/discrepancias.js';
import { CANALES_WOO, type CanalWoo } from '../sync/importador.js';
import { ingerirPedidos, mapearLineaPedido } from '../sync/pedidos.js';
import { correrCompleta } from '../sync/completa.js';
import { adoptarStock, imponerMaestro, publicarPrecios, publicarStock } from '../sync/push.js';

function responderError(reply: FastifyReply, e: unknown) {
  if (e instanceof ErrorCorrida || e instanceof ErrorStock) return reply.code(e.status).send(e.cuerpo);
  throw e;
}

export default async function rutasSincronizacion(app: FastifyInstance) {
  const admin = { preHandler: app.requiereRol('admin') };
  const encargado = { preHandler: app.requiereRol('encargado') };

  const canalValido = (canalId: string, reply: FastifyReply): canalId is CanalWoo => {
    if (!CANALES_WOO.includes(canalId as CanalWoo)) {
      void reply.code(404).send({ error: 'CANAL_DESCONOCIDO' });
      return false;
    }
    return true;
  };

  // ---------- Corridas (§6.1) ----------

  // R-024: leer pedidos no escribe en la tienda → encargado+. Publicar (abajo) sigue siendo admin.
  app.post<{ Params: { canalId: string }; Querystring: { dryRun?: string } }>(
    '/sync/:canalId/pedidos',
    encargado,
    async (req, reply) => {
      if (!canalValido(req.params.canalId, reply)) return;
      const dryRun = req.query.dryRun !== 'false';
      try {
        return await ingerirPedidos(req.params.canalId, { dryRun, usuarioId: req.user.sub });
      } catch (e) {
        return responderError(reply, e);
      }
    },
  );

  // La unidad programada: pedidos → precios → stock, en orden y por dependencia (§4.2).
  app.post<{ Params: { canalId: string }; Querystring: { dryRun?: string } }>(
    '/sync/:canalId/completa',
    admin,
    async (req, reply) => {
      if (!canalValido(req.params.canalId, reply)) return;
      const dryRun = req.query.dryRun !== 'false';
      try {
        return await correrCompleta(req.params.canalId, { dryRun, usuarioId: req.user.sub });
      } catch (e) {
        return responderError(reply, e);
      }
    },
  );

  // E3a/E3b: push de precio, push de stock y adopción inicial (§4.4). dryRun por defecto.
  for (const [ruta, correr] of [
    ['precios', publicarPrecios],
    ['stock', publicarStock],
    ['adoptar', adoptarStock],
  ] as const) {
    app.post<{ Params: { canalId: string }; Querystring: { dryRun?: string; productoIds?: string; soloErrores?: string } }>(
      `/sync/:canalId/${ruta}`,
      admin,
      async (req, reply) => {
        if (!canalValido(req.params.canalId, reply)) return;
        const dryRun = req.query.dryRun !== 'false';
        const productoIds = req.query.productoIds ? req.query.productoIds.split(',').filter(Boolean) : undefined;
        const soloErrores = req.query.soloErrores === 'true'; // G10: reintento acotado a los fallidos
        try {
          return await correr(req.params.canalId, { dryRun, usuarioId: req.user.sub, productoIds, soloErrores });
        } catch (e) {
          return responderError(reply, e);
        }
      },
    );
  }

  app.get<{ Querystring: { canalId?: string; tipo?: string; estado?: string; desde?: string; pagina?: string } }>(
    '/sync/corridas',
    encargado,
    async (req) => {
      const pagina = Math.max(1, Number(req.query.pagina ?? 1) || 1);
      const porPagina = 50;
      const where = {
        ...(req.query.canalId ? { canalId: req.query.canalId } : {}),
        ...(req.query.tipo ? { tipo: req.query.tipo as TipoCorrida } : {}),
        ...(req.query.estado ? { estado: req.query.estado as EstadoCorrida } : {}),
        ...(req.query.desde ? { iniciadaEn: { gte: new Date(req.query.desde) } } : {}),
      };
      const [total, corridas] = await Promise.all([
        prisma.syncCorrida.count({ where }),
        prisma.syncCorrida.findMany({
          where,
          orderBy: { iniciadaEn: 'desc' },
          skip: (pagina - 1) * porPagina,
          take: porPagina,
          include: { usuario: { select: { nombre: true } }, _count: { select: { items: true } } },
        }),
      ]);
      return { total, pagina, porPagina, corridas };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { pagina?: string } }>('/sync/corridas/:id', encargado, async (req, reply) => {
    const corrida = await prisma.syncCorrida.findUnique({
      where: { id: req.params.id },
      include: { usuario: { select: { nombre: true } } },
    });
    if (!corrida) return reply.code(404).send({ error: 'CORRIDA_NO_ENCONTRADA' });
    const pagina = Math.max(1, Number(req.query.pagina ?? 1) || 1);
    const porPagina = 100;
    const [total, items] = await Promise.all([
      prisma.syncCorridaItem.count({ where: { corridaId: corrida.id } }),
      prisma.syncCorridaItem.findMany({ where: { corridaId: corrida.id }, orderBy: { id: 'asc' }, skip: (pagina - 1) * porPagina, take: porPagina }),
    ]);
    return { corrida, total, pagina, porPagina, items };
  });

  // ---------- Pedidos online (V14) ----------

  app.get<{ Querystring: { canalId?: string; desde?: string; sinMapear?: string; pagina?: string } }>(
    '/sync/pedidos',
    encargado,
    async (req) => {
      const pagina = Math.max(1, Number(req.query.pagina ?? 1) || 1);
      const porPagina = 50;
      const where = {
        ...(req.query.canalId ? { canalId: req.query.canalId } : {}),
        ...(req.query.desde ? { creadoEnCanal: { gte: new Date(req.query.desde) } } : {}),
        ...(req.query.sinMapear === 'true' ? { lineas: { some: { productoId: null } } } : {}),
      };
      const [total, pedidos] = await Promise.all([
        prisma.pedidoCanal.count({ where }),
        prisma.pedidoCanal.findMany({
          where,
          orderBy: { creadoEnCanal: 'desc' },
          skip: (pagina - 1) * porPagina,
          take: porPagina,
          include: {
            lineas: { include: { producto: { select: { id: true, sku: true, nombre: true, controlaStock: true } } } },
            cliente: { select: { id: true, nombre: true } },
            discrepancias: { where: { estado: 'abierta' }, select: { id: true, tipo: true, pedidoCanalLineaId: true } },
          },
        }),
      ]);
      return {
        total,
        pagina,
        porPagina,
        pedidos: pedidos.map((p) => ({ ...p, sinMapear: p.lineas.filter((l) => !l.productoId).length })),
      };
    },
  );

  app.post<{ Params: { pedidoId: string; lineaId: string }; Body: { productoId?: unknown } }>(
    '/sync/pedidos/:pedidoId/lineas/:lineaId/mapear',
    encargado,
    async (req, reply) => {
      const productoId = typeof req.body?.productoId === 'string' ? req.body.productoId : '';
      if (!productoId) return reply.code(422).send({ error: 'PRODUCTO_REQUERIDO' });
      try {
        return await mapearLineaPedido(req.params.pedidoId, req.params.lineaId, productoId, req.user.sub);
      } catch (e) {
        return responderError(reply, e);
      }
    },
  );

  // ---------- Discrepancias (§6.2) ----------

  app.get<{ Querystring: { canalId?: string; tipo?: string; estado?: string; desde?: string; pagina?: string } }>(
    '/sync/discrepancias',
    encargado,
    async (req) => {
      const pagina = Math.max(1, Number(req.query.pagina ?? 1) || 1);
      const porPagina = 100;
      const where = {
        ...(req.query.canalId ? { canalId: req.query.canalId } : {}),
        ...(req.query.tipo ? { tipo: req.query.tipo as TipoDiscrepancia } : {}),
        estado: (req.query.estado as EstadoDiscrepancia | undefined) ?? 'abierta',
        ...(req.query.desde ? { creadaEn: { gte: new Date(req.query.desde) } } : {}),
      };
      const [total, discrepancias, porTipo] = await Promise.all([
        prisma.discrepancia.count({ where }),
        prisma.discrepancia.findMany({
          where,
          orderBy: [{ vistaEn: 'desc' }],
          skip: (pagina - 1) * porPagina,
          take: porPagina,
          include: {
            productoCanal: { select: { id: true, externoId: true, externoSku: true, producto: { select: { id: true, sku: true, nombre: true, controlaStock: true } } } },
            pedidoCanal: { select: { id: true, numero: true, estadoCanal: true, total: true } },
            pedidoCanalLinea: { select: { id: true, descripcion: true, cantidad: true, cantidadDevuelta: true, externoSku: true } },
          },
        }),
        prisma.discrepancia.groupBy({ by: ['tipo'], where: { estado: 'abierta', ...(req.query.canalId ? { canalId: req.query.canalId } : {}) }, _count: { _all: true } }),
      ]);
      return {
        total,
        pagina,
        porPagina,
        abiertasPorTipo: Object.fromEntries(porTipo.map((g) => [g.tipo, g._count._all])),
        titulos: TITULO_DISCREPANCIA,
        discrepancias,
      };
    },
  );

  app.get<{ Params: { id: string } }>('/sync/discrepancias/:id', encargado, async (req, reply) => {
    const d = await prisma.discrepancia.findUnique({
      where: { id: req.params.id },
      include: {
        productoCanal: { include: { producto: { select: { id: true, sku: true, nombre: true, controlaStock: true, precioVenta: true } } } },
        pedidoCanal: { include: { lineas: true } },
        pedidoCanalLinea: true,
        resueltaPor: { select: { nombre: true } },
      },
    });
    if (!d) return reply.code(404).send({ error: 'DISCREPANCIA_NO_ENCONTRADA' });
    const movimientos = d.productoCanal
      ? await prisma.movimientoStock.findMany({
          where: { productoId: d.productoCanal.productoId },
          orderBy: { creadoEn: 'desc' },
          take: 20,
          include: { ubicacion: { select: { codigo: true } } },
        })
      : d.pedidoCanal
        ? await prisma.movimientoStock.findMany({
            where: { referenciaTipo: 'pedido_canal', referenciaId: d.pedidoCanal.id },
            orderBy: { creadoEn: 'desc' },
            include: { ubicacion: { select: { codigo: true } }, producto: { select: { sku: true, nombre: true } } },
          })
        : [];
    return { discrepancia: d, titulo: TITULO_DISCREPANCIA[d.tipo], movimientos };
  });

  interface CuerpoResolver {
    accion?: unknown;
    nota?: unknown;
    cantidad?: unknown; // reponer: unidades que llegaron
  }

  /**
   * Acciones (§6.2 y §8.4): adoptar_canal (ajuste con la diferencia), imponer_maestro
   * (admin; llega con el push de la Fase 4), descartar; y para pedido_sin_stock:
   * contactar_cliente / reembolsar / reponer. Todas quedan en Auditoria.
   */
  app.post<{ Params: { id: string }; Body: CuerpoResolver }>('/sync/discrepancias/:id/resolver', encargado, async (req, reply) => {
    const accion = typeof req.body?.accion === 'string' ? req.body.accion : '';
    const nota = typeof req.body?.nota === 'string' ? req.body.nota.trim() : '';
    const d = await prisma.discrepancia.findUnique({
      where: { id: req.params.id },
      include: { productoCanal: { include: { producto: { select: { id: true, sku: true, controlaStock: true } } } }, pedidoCanal: true, pedidoCanalLinea: true },
    });
    if (!d) return reply.code(404).send({ error: 'DISCREPANCIA_NO_ENCONTRADA' });
    if (d.estado !== 'abierta') return reply.code(409).send({ error: 'DISCREPANCIA_CERRADA' });

    const acciones = ['adoptar_canal', 'imponer_maestro', 'descartar', 'contactar_cliente', 'reembolsar', 'reponer'];
    if (!acciones.includes(accion)) return reply.code(422).send({ error: 'ACCION_INVALIDA', acciones });
    if (accion !== 'descartar' && !nota) return reply.code(422).send({ error: 'NOTA_REQUERIDA' });
    const usuarioId = req.user.sub;
    if (accion === 'imponer_maestro') {
      // Dispara un PUT contra producción: solo admin (§6.2). Pasa por el candado SYNC_SOLO_LECTURA.
      if (req.user.rol !== 'admin') return reply.code(403).send({ error: 'ROL_INSUFICIENTE' });
      try {
        const escrito = await imponerMaestro(d);
        await prisma.$transaction(async (tx) => {
          await cerrarDiscrepancia(tx, d.id, { estado: 'resuelta', usuarioId, accionTomada: `imponer_maestro: ${nota}` });
          await tx.auditoria.create({
            data: {
              usuarioId,
              entidad: 'discrepancia',
              entidadId: d.id,
              accion: 'editar',
              valorAnterior: { tipo: d.tipo, estado: 'abierta', valorMaestro: d.valorMaestro, valorCanal: d.valorCanal, valorPublicado: d.valorPublicado },
              valorNuevo: { estado: 'resuelta', accion, nota, ...escrito },
            },
          });
        });
        return { id: d.id, estado: 'resuelta', accion, ...escrito };
      } catch (e) {
        if (e instanceof Error && e.name === 'ErrorEscrituraBloqueada') {
          return reply.code(422).send({ error: 'CANDADO_SOLO_LECTURA', detalle: e.message });
        }
        return responderError(reply, e);
      }
    }

    try {
      const resultado = await prisma.$transaction(async (tx) => {
        let detalle: Record<string, unknown> = {};
        if (accion === 'adoptar_canal') {
          // El canal tiene razón: ajuste con la diferencia sobre la ubicación online y
          // stockPublicado = valor del canal, para que el push deje de reportarlo.
          const tiposStock = ['stock_derivado', 'primera_publicacion', 'canal_sin_gestion'];
          if (!tiposStock.includes(d.tipo) || !d.productoCanal || d.valorCanal === null || d.valorMaestro === null) {
            throw new ErrorCorrida({ error: 'ACCION_NO_APLICA', detalle: 'adoptar_canal exige una discrepancia de stock con los tres números' });
          }
          const ubicacion = await tx.ubicacion.findUnique({ where: { codigo: entorno.syncUbicacionOnline } });
          if (!ubicacion) throw new ErrorCorrida({ error: 'UBICACION_ONLINE_NO_CONFIGURADA' }, 409);
          const diferencia = d.valorCanal - d.valorMaestro;
          if (diferencia !== 0) {
            const r = await registrarMovimiento(tx, {
              productoId: d.productoCanal.productoId,
              ubicacionId: ubicacion.id,
              cantidad: diferencia,
              motivo: 'ajuste',
              referenciaTipo: 'discrepancia',
              referenciaId: d.id,
              nota,
              usuarioId,
            });
            detalle = { movimientoId: r.movimientoId, diferencia, cantidadNueva: r.cantidadNueva };
          }
          await tx.productoCanal.update({ where: { id: d.productoCanal.id }, data: { stockPublicado: d.valorCanal, syncStock: 'por_publicar', syncMensaje: null } });
        } else if (accion === 'descartar') {
          if (d.productoCanal && d.valorCanal !== null && (d.tipo === 'stock_derivado' || d.tipo === 'primera_publicacion')) {
            await tx.productoCanal.update({ where: { id: d.productoCanal.id }, data: { stockPublicado: d.valorCanal, syncStock: 'por_publicar', syncMensaje: null } });
          }
          if (d.productoCanal && d.valorCanal !== null && d.tipo === 'precio_derivado') {
            await tx.productoCanal.update({ where: { id: d.productoCanal.id }, data: { precioPublicado: d.valorCanal } });
          }
        } else if (accion === 'reponer') {
          if (d.tipo !== 'pedido_sin_stock' || !d.pedidoCanalLinea) throw new ErrorCorrida({ error: 'ACCION_NO_APLICA', detalle: 'reponer solo aplica a pedido_sin_stock' });
          const cantidad = Number(req.body?.cantidad ?? 0);
          if (!Number.isInteger(cantidad) || cantidad <= 0) throw new ErrorCorrida({ error: 'CANTIDAD_INVALIDA' });
          const linea = await tx.pedidoCanalLinea.findUniqueOrThrow({ where: { id: d.pedidoCanalLinea.id }, select: { productoId: true } });
          if (!linea.productoId) throw new ErrorCorrida({ error: 'LINEA_SIN_PRODUCTO' });
          const ubicacion = await tx.ubicacion.findUniqueOrThrow({ where: { codigo: entorno.syncUbicacionOnline } });
          const r = await registrarMovimiento(tx, {
            productoId: linea.productoId,
            ubicacionId: ubicacion.id,
            cantidad,
            motivo: 'compra',
            referenciaTipo: 'discrepancia',
            referenciaId: d.id,
            nota,
            usuarioId,
          });
          detalle = { movimientoId: r.movimientoId, cantidad, cantidadNueva: r.cantidadNueva };
        } else if (accion === 'contactar_cliente' || accion === 'reembolsar') {
          if (d.tipo !== 'pedido_sin_stock') throw new ErrorCorrida({ error: 'ACCION_NO_APLICA', detalle: `${accion} solo aplica a pedido_sin_stock` });
        }
        const estado = accion === 'descartar' ? 'descartada' : 'resuelta';
        await cerrarDiscrepancia(tx, d.id, { estado, usuarioId, accionTomada: nota ? `${accion}: ${nota}` : accion });
        await tx.auditoria.create({
          data: {
            usuarioId,
            entidad: 'discrepancia',
            entidadId: d.id,
            accion: accion === 'adoptar_canal' || accion === 'reponer' ? 'ajustar_stock' : 'editar',
            valorAnterior: { tipo: d.tipo, estado: 'abierta', valorMaestro: d.valorMaestro, valorCanal: d.valorCanal, valorPublicado: d.valorPublicado },
            valorNuevo: { estado, accion, nota, ...detalle },
          },
        });
        return { id: d.id, estado, accion, ...detalle };
      });
      return resultado;
    } catch (e) {
      return responderError(reply, e);
    }
  });
}
