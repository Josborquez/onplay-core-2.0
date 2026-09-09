// Recuentos guiados — docs/03-SDD-etapa2-inventario.md §6.4 (C4). Rol encargado.
// Cerrar un recuento es lo ÚNICO que enciende controlaStock en masa (M5), y solo en lo contado.
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { cerrarRecuento } from '@onplay/dominio';
import { prisma } from '../db.js';
import { ErrorStock, bloquearStock, registrarMovimiento } from '../stock/libro.js';

const TOPE_LINEAS = 500; // una tanda (01 §9: «por categoría y por tanda»)

const INCLUIR_LINEAS = {
  lineas: {
    include: {
      producto: { select: { id: true, sku: true, nombre: true, imagenUrl: true, codigoBarras: true, controlaStock: true } },
    },
    orderBy: { producto: { nombre: 'asc' } },
  },
  ubicacion: { select: { id: true, codigo: true, nombre: true } },
  usuario: { select: { nombre: true } },
} satisfies Prisma.RecuentoInclude;

async function idsSubarbol(categoriaId: string): Promise<string[]> {
  const todas = await prisma.categoria.findMany({ select: { id: true, padreId: true } });
  const hijos = new Map<string, string[]>();
  for (const c of todas) if (c.padreId) hijos.set(c.padreId, [...(hijos.get(c.padreId) ?? []), c.id]);
  const ids: string[] = [];
  const pila = [categoriaId];
  while (pila.length) {
    const id = pila.pop()!;
    ids.push(id);
    pila.push(...(hijos.get(id) ?? []));
  }
  return ids;
}

/** Stock vigente de varios productos en una ubicación (0 si no hay fila). */
async function stockVigente(ubicacionId: string, productoIds: string[]): Promise<Map<string, number>> {
  if (productoIds.length === 0) return new Map();
  const filas = await prisma.stockActual.findMany({
    where: { ubicacionId, productoId: { in: productoIds } },
    select: { productoId: true, cantidad: true },
  });
  return new Map(filas.map((f) => [f.productoId, f.cantidad]));
}

export default async function rutasRecuentos(app: FastifyInstance) {
  const encargado = { preHandler: app.requiereRol('encargado') };

  app.get<{ Querystring: { ubicacionId?: string; estado?: string } }>('/recuentos', encargado, async (req) => {
    const recuentos = await prisma.recuento.findMany({
      where: {
        ...(req.query.ubicacionId ? { ubicacionId: req.query.ubicacionId } : {}),
        ...(req.query.estado ? { estado: req.query.estado as 'abierto' | 'cerrado' | 'descartado' } : {}),
      },
      orderBy: { creadoEn: 'desc' },
      take: 100,
      include: {
        ubicacion: { select: { codigo: true, nombre: true } },
        usuario: { select: { nombre: true } },
        lineas: { select: { cantidadSistema: true, cantidadContada: true } },
      },
    });
    return {
      recuentos: recuentos.map(({ lineas, ...r }) => {
        const contadas = lineas.filter((l) => l.cantidadContada !== null);
        const cuadradas = contadas.filter((l) => l.cantidadContada === l.cantidadSistema).length;
        return {
          ...r,
          totalLineas: lineas.length,
          contadas: contadas.length,
          // Para cerrados, cantidadSistema es el stock vigente al cierre: % cuadrado exacto (§6.4 paso 5).
          porcentajeCuadrado: contadas.length > 0 ? Math.round((cuadradas / contadas.length) * 100) : null,
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>('/recuentos/:id', encargado, async (req, reply) => {
    const r = await prisma.recuento.findUnique({ where: { id: req.params.id }, include: INCLUIR_LINEAS });
    if (!r) return reply.code(404).send({ error: 'RECUENTO_NO_ENCONTRADO' });
    const vigente = await stockVigente(r.ubicacionId, r.lineas.map((l) => l.productoId));
    return {
      ...r,
      lineas: r.lineas.map((l) => ({ ...l, stockVigente: vigente.get(l.productoId) ?? 0 })),
    };
  });

  interface CuerpoRecuento {
    ubicacionId?: unknown;
    categoriaId?: unknown;
    productoIds?: unknown;
    nombre?: unknown;
  }

  app.post<{ Body: CuerpoRecuento }>('/recuentos', encargado, async (req, reply) => {
    const b = req.body ?? {};
    const nombre = typeof b.nombre === 'string' ? b.nombre.trim() : '';
    if (!nombre) return reply.code(422).send({ error: 'NOMBRE_REQUERIDO' });
    if (typeof b.ubicacionId !== 'string') return reply.code(422).send({ error: 'UBICACION_REQUERIDA' });
    const ubicacion = await prisma.ubicacion.findUnique({ where: { id: b.ubicacionId } });
    if (!ubicacion || !ubicacion.activa) return reply.code(422).send({ error: 'UBICACION_NO_ENCONTRADA' });

    let productoIds: string[] = [];
    let categoriaId: string | null = null;
    if (typeof b.categoriaId === 'string' && b.categoriaId) {
      categoriaId = b.categoriaId;
      const ids = await idsSubarbol(categoriaId);
      productoIds = (
        await prisma.producto.findMany({
          where: { activo: true, categoriaId: { in: ids }, tipo: { not: 'servicio' } },
          select: { id: true },
        })
      ).map((p) => p.id);
    } else if (Array.isArray(b.productoIds)) {
      const pedidos = b.productoIds.filter((x): x is string => typeof x === 'string');
      productoIds = (await prisma.producto.findMany({ where: { id: { in: pedidos } }, select: { id: true } })).map((p) => p.id);
    }
    if (productoIds.length > TOPE_LINEAS) {
      return reply.code(422).send({
        error: 'RECUENTO_DEMASIADO_GRANDE',
        detalle: `${productoIds.length} productos; el tope por tanda es ${TOPE_LINEAS}. Elige una subcategoría.`,
      });
    }
    const vigente = await stockVigente(ubicacion.id, productoIds);
    const creado = await prisma.recuento.create({
      data: {
        ubicacionId: ubicacion.id,
        categoriaId,
        nombre,
        usuarioId: req.user.sub,
        lineas: { create: productoIds.map((id) => ({ productoId: id, cantidadSistema: vigente.get(id) ?? 0 })) },
      },
      include: INCLUIR_LINEAS,
    });
    return reply.code(201).send(creado);
  });

  async function recuentoAbierto(id: string) {
    const r = await prisma.recuento.findUnique({ where: { id } });
    if (!r) throw new ErrorStock({ error: 'RECUENTO_NO_ENCONTRADO' }, 404);
    if (r.estado !== 'abierto') throw new ErrorStock({ error: 'RECUENTO_CERRADO', detalle: `estado ${r.estado}` }, 409);
    return r;
  }

  // Agregar (o sumar al) producto escaneado que no estaba en el alcance (§6.4 paso 2).
  app.post<{ Params: { id: string }; Body: { productoId?: unknown; sumar?: unknown } }>(
    '/recuentos/:id/lineas',
    encargado,
    async (req, reply) => {
      const r = await recuentoAbierto(req.params.id);
      const productoId = req.body?.productoId;
      if (typeof productoId !== 'string') return reply.code(422).send({ error: 'PRODUCTO_REQUERIDO' });
      const producto = await prisma.producto.findUnique({ where: { id: productoId }, select: { id: true, tipo: true } });
      if (!producto) return reply.code(422).send({ error: 'PRODUCTO_NO_ENCONTRADO' });
      if (producto.tipo === 'servicio') return reply.code(422).send({ error: 'PRODUCTO_SIN_STOCK', detalle: 'Un servicio no se cuenta' });
      const sumar = Number.isInteger(req.body?.sumar) ? (req.body!.sumar as number) : null;
      const existente = await prisma.recuentoLinea.findUnique({ where: { recuentoId_productoId: { recuentoId: r.id, productoId } } });
      let linea;
      if (existente) {
        linea = await prisma.recuentoLinea.update({
          where: { id: existente.id },
          data: sumar !== null ? { cantidadContada: (existente.cantidadContada ?? 0) + sumar, contadoEn: new Date() } : {},
          include: INCLUIR_LINEAS.lineas.include,
        });
      } else {
        const total = await prisma.recuentoLinea.count({ where: { recuentoId: r.id } });
        if (total >= TOPE_LINEAS) return reply.code(422).send({ error: 'RECUENTO_DEMASIADO_GRANDE', detalle: `tope ${TOPE_LINEAS}` });
        const vigente = await stockVigente(r.ubicacionId, [productoId]);
        linea = await prisma.recuentoLinea.create({
          data: {
            recuentoId: r.id,
            productoId,
            cantidadSistema: vigente.get(productoId) ?? 0,
            ...(sumar !== null ? { cantidadContada: sumar, contadoEn: new Date() } : {}),
          },
          include: INCLUIR_LINEAS.lineas.include,
        });
      }
      const vigente = await stockVigente(r.ubicacionId, [productoId]);
      return reply.code(existente ? 200 : 201).send({ ...linea, stockVigente: vigente.get(productoId) ?? 0 });
    },
  );

  app.patch<{ Params: { id: string; productoId: string }; Body: { cantidadContada?: unknown } }>(
    '/recuentos/:id/lineas/:productoId',
    encargado,
    async (req, reply) => {
      const r = await recuentoAbierto(req.params.id);
      const c = req.body?.cantidadContada;
      if (c !== null && (!Number.isInteger(c) || (c as number) < 0)) {
        return reply.code(422).send({ error: 'CANTIDAD_INVALIDA', detalle: 'entero >= 0, o null para descontar' });
      }
      const existente = await prisma.recuentoLinea.findUnique({
        where: { recuentoId_productoId: { recuentoId: r.id, productoId: req.params.productoId } },
      });
      if (!existente) return reply.code(404).send({ error: 'LINEA_NO_ENCONTRADA' });
      const linea = await prisma.recuentoLinea.update({
        where: { id: existente.id },
        data: { cantidadContada: c as number | null, contadoEn: c === null ? null : new Date() },
        include: INCLUIR_LINEAS.lineas.include,
      });
      const vigente = await stockVigente(r.ubicacionId, [linea.productoId]);
      return { ...linea, stockVigente: vigente.get(linea.productoId) ?? 0 };
    },
  );

  // §6.4 paso 3: cierre transaccional. Diferencia contra el stock VIGENTE (bloqueado), no el snapshot.
  app.post<{ Params: { id: string } }>('/recuentos/:id/cerrar', encargado, async (req, reply) => {
    const r = await recuentoAbierto(req.params.id);
    const lineas = await prisma.recuentoLinea.findMany({
      where: { recuentoId: r.id },
      include: { producto: { select: { controlaStock: true } } },
      orderBy: { productoId: 'asc' }, // orden de candados (§6.1)
    });
    const resultado = await prisma.$transaction(async (tx) => {
      const contadas = lineas.filter((l) => l.cantidadContada !== null);
      const vigentes = new Map<string, number>();
      for (const l of contadas) vigentes.set(l.productoId, await bloquearStock(tx, l.productoId, r.ubicacionId));
      const cierre = cerrarRecuento(
        contadas.map((l) => ({
          productoId: l.productoId,
          cantidadContada: l.cantidadContada,
          stockActual: vigentes.get(l.productoId) ?? 0,
          controlaStock: l.producto.controlaStock,
        })),
      );
      for (const m of cierre.movimientos) {
        await registrarMovimiento(tx, {
          productoId: m.productoId,
          ubicacionId: r.ubicacionId,
          cantidad: m.cantidad,
          motivo: m.motivo,
          referenciaTipo: 'recuento',
          referenciaId: r.id,
          nota: m.motivo === 'ajuste' ? `Recuento «${r.nombre}»` : null,
          usuarioId: req.user.sub,
        });
      }
      if (cierre.encender.length > 0) {
        await tx.producto.updateMany({ where: { id: { in: cierre.encender } }, data: { controlaStock: true } });
      }
      // Congelar el sistema al momento del cierre: la diferencia queda auditable en la línea.
      for (const l of contadas) {
        await tx.recuentoLinea.update({ where: { id: l.id }, data: { cantidadSistema: vigentes.get(l.productoId) ?? 0 } });
      }
      const cerrado = await tx.recuento.update({
        where: { id: r.id },
        data: { estado: 'cerrado', cerradoEn: new Date() },
      });
      const resumen = {
        lineas: lineas.length,
        contadas: cierre.contadas,
        conDiferencia: cierre.conDiferencia,
        sumaAbs: cierre.sumaAbs,
        encendidos: cierre.encender.length,
      };
      await tx.auditoria.create({
        data: {
          usuarioId: req.user.sub,
          entidad: 'recuento',
          entidadId: r.id,
          accion: 'recuento',
          valorNuevo: { nombre: r.nombre, ubicacionId: r.ubicacionId, ...resumen },
        },
      });
      return { recuento: cerrado, resumen, movimientos: cierre.movimientos };
    });
    return resultado;
  });

  app.post<{ Params: { id: string }; Body: { nota?: unknown } }>('/recuentos/:id/descartar', encargado, async (req, reply) => {
    const r = await recuentoAbierto(req.params.id);
    const nota = typeof req.body?.nota === 'string' ? req.body.nota.trim() : '';
    if (!nota) return reply.code(422).send({ error: 'NOTA_REQUERIDA' });
    const descartado = await prisma.recuento.update({
      where: { id: r.id },
      data: { estado: 'descartado', cerradoEn: new Date(), nota },
    });
    await prisma.auditoria.create({
      data: { usuarioId: req.user.sub, entidad: 'recuento', entidadId: r.id, accion: 'recuento', valorNuevo: { estado: 'descartado', nota } },
    });
    return descartado;
  });

  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof ErrorStock) return reply.code(e.status).send(e.cuerpo);
    throw e;
  });
}
