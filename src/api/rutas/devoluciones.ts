// Devoluciones (C8, 03-SDD §6.6) y movimientos de caja (C9, §6.7). Rol encargado.
// La devolución sale de la caja ABIERTA de quien la hace (la venta puede ser de un turno cerrado),
// repone stock por línea y lleva folio D-año-#####. Nada se borra: la venta sigue completada.
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { formatearFolioDevolucion, validarDevolucion } from '@onplay/dominio';
import { prisma } from '../db.js';
import { ErrorStock, bloquearStock, registrarMovimiento, ubicacionVenta } from '../stock/libro.js';

const MEDIOS_DEVOLUCION = new Set(['efectivo', 'monedero', 'otro']);

const INCLUIR_DEVOLUCION = {
  lineas: { include: { ventaLinea: { select: { descripcion: true, precioUnitario: true } } } },
  usuario: { select: { nombre: true } },
  venta: { select: { folio: true } },
} satisfies Prisma.DevolucionInclude;

/** Cantidades ya devueltas por línea de venta. */
async function yaDevueltas(ventaId: string): Promise<Map<string, number>> {
  const filas = await prisma.devolucionLinea.groupBy({
    by: ['ventaLineaId'],
    _sum: { cantidad: true },
    where: { devolucion: { ventaId } },
  });
  return new Map(filas.map((f) => [f.ventaLineaId, f._sum.cantidad ?? 0]));
}

export default async function rutasDevoluciones(app: FastifyInstance) {
  const vendedor = { preHandler: app.requiereRol('vendedor') };
  const encargado = { preHandler: app.requiereRol('encargado') };

  app.get<{ Params: { id: string } }>('/ventas/:id/devoluciones', vendedor, async (req, reply) => {
    const venta = await prisma.venta.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!venta) return reply.code(404).send({ error: 'VENTA_NO_ENCONTRADA' });
    const [devoluciones, previas] = await Promise.all([
      prisma.devolucion.findMany({ where: { ventaId: venta.id }, orderBy: { creadoEn: 'asc' }, include: INCLUIR_DEVOLUCION }),
      yaDevueltas(venta.id),
    ]);
    return { devoluciones, yaDevueltas: Object.fromEntries(previas) };
  });

  app.get<{ Querystring: { desde?: string; hasta?: string; pagina?: string } }>('/devoluciones', encargado, async (req) => {
    const pagina = Math.max(1, Number(req.query.pagina ?? 1) || 1);
    const porPagina = 50;
    const desde = req.query.desde ? new Date(req.query.desde) : null;
    const hasta = req.query.hasta ? new Date(req.query.hasta) : null;
    const where: Prisma.DevolucionWhereInput = {
      ...(desde || hasta ? { creadoEn: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } } : {}),
    };
    const [total, devoluciones] = await Promise.all([
      prisma.devolucion.count({ where }),
      prisma.devolucion.findMany({ where, orderBy: { creadoEn: 'desc' }, skip: (pagina - 1) * porPagina, take: porPagina, include: INCLUIR_DEVOLUCION }),
    ]);
    return { total, pagina, porPagina, devoluciones };
  });

  interface CuerpoDevolucion {
    lineas?: unknown;
    medio?: unknown;
    motivo?: unknown;
  }

  app.post<{ Params: { id: string }; Body: CuerpoDevolucion }>('/ventas/:id/devoluciones', encargado, async (req, reply) => {
    const b = req.body ?? {};
    const motivo = typeof b.motivo === 'string' ? b.motivo.trim() : '';
    if (!motivo) return reply.code(422).send({ error: 'MOTIVO_REQUERIDO' });
    const medio = typeof b.medio === 'string' ? b.medio : '';
    if (!MEDIOS_DEVOLUCION.has(medio)) return reply.code(422).send({ error: 'MEDIO_INVALIDO', detalle: 'efectivo | monedero | otro' });
    const solicitud = Array.isArray(b.lineas)
      ? (b.lineas as { ventaLineaId?: unknown; cantidad?: unknown; reponeStock?: unknown }[]).map((l) => ({
          ventaLineaId: String(l.ventaLineaId ?? ''),
          cantidad: Number(l.cantidad),
          reponeStock: l.reponeStock !== false,
        }))
      : [];

    // El dinero sale del turno ABIERTO de quien devuelve (§6.6).
    const turno = await prisma.turnoCaja.findFirst({ where: { usuarioId: req.user.sub, estado: 'abierto' } });
    if (!turno) return reply.code(409).send({ error: 'TURNO_NO_ABIERTO', detalle: 'Abre tu caja para devolver: el dinero sale de ella' });

    const venta = await prisma.venta.findUnique({
      where: { id: req.params.id },
      include: { lineas: { include: { producto: { select: { id: true, controlaStock: true } } } } },
    });
    if (!venta) return reply.code(404).send({ error: 'VENTA_NO_ENCONTRADA' });
    if (medio === 'monedero' && !venta.clienteId) {
      return reply.code(422).send({ error: 'CLIENTE_REQUERIDO', detalle: 'La venta no tiene cliente: no hay monedero al que devolver' });
    }
    const previas = await yaDevueltas(venta.id);
    const calculo = validarDevolucion(
      {
        estado: venta.estado,
        subtotal: venta.subtotal,
        descuento: venta.descuento,
        lineas: venta.lineas.map((l) => ({
          ventaLineaId: l.id,
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          descuentoLinea: l.descuentoLinea,
          totalLinea: l.totalLinea,
          yaDevuelta: previas.get(l.id) ?? 0,
        })),
      },
      solicitud,
    );
    if ('codigo' in calculo) {
      const { codigo, ...resto } = calculo;
      return reply.code(422).send({ error: codigo, ...resto });
    }

    // Líneas que reponen stock (producto con control), ordenadas por productoId (candados §6.1).
    let ubicacion: { id: string; codigo: string } | null = null;
    const reponen = calculo.lineas
      .map((l) => ({ l, vl: venta.lineas.find((x) => x.id === l.ventaLineaId)! }))
      .filter(({ l, vl }) => l.reponeStock && vl.producto?.controlaStock)
      .sort((a, b) => (a.vl.productoId! < b.vl.productoId! ? -1 : 1));
    if (reponen.length > 0) {
      try {
        ubicacion = await ubicacionVenta(prisma);
      } catch (e) {
        if (e instanceof ErrorStock) return reply.code(e.status).send(e.cuerpo);
        throw e;
      }
    }

    try {
      const creada = await prisma.$transaction(async (tx) => {
        // Orden fijo: Cliente (si monedero) → StockActual ascendente → Correlativo al final.
        if (medio === 'monedero') {
          await tx.$queryRaw`SELECT id FROM Cliente WHERE id = ${venta.clienteId} FOR UPDATE`;
        }
        for (const { vl } of reponen) await bloquearStock(tx, vl.productoId!, ubicacion!.id);

        const anio = new Date().getFullYear();
        const clave = `devolucion_${anio}`;
        const filas = await tx.$queryRaw<{ ultimo: number }[]>`SELECT ultimo FROM Correlativo WHERE clave = ${clave} FOR UPDATE`;
        let ultimo = 0;
        if (filas.length === 0) await tx.correlativo.create({ data: { clave, anio, ultimo: 0 } });
        else ultimo = Number(filas[0]!.ultimo);
        const nuevo = ultimo + 1;
        await tx.$executeRaw`UPDATE Correlativo SET ultimo = ${nuevo} WHERE clave = ${clave}`;
        const folio = formatearFolioDevolucion(anio, nuevo);

        const dev = await tx.devolucion.create({
          data: {
            folio,
            ventaId: venta.id,
            turnoCajaId: turno.id,
            monto: calculo.monto,
            medio: medio as 'efectivo' | 'monedero' | 'otro',
            motivo,
            usuarioId: req.user.sub,
            lineas: { create: calculo.lineas.map((l) => ({ ventaLineaId: l.ventaLineaId, cantidad: l.cantidad, reponeStock: l.reponeStock, montoLinea: l.montoLinea })) },
          },
          include: INCLUIR_DEVOLUCION,
        });

        // Stock: reposición por línea (§6.6). Producto dañado (reponeStock=false): sin movimiento.
        for (const { l, vl } of reponen) {
          await registrarMovimiento(tx, {
            productoId: vl.productoId!,
            ubicacionId: ubicacion!.id,
            cantidad: l.cantidad,
            motivo: 'devolucion',
            referenciaTipo: 'devolucion',
            referenciaId: dev.id,
            nota: `${folio} sobre ${venta.folio}: ${motivo}`,
            usuarioId: req.user.sub,
          });
        }
        // Monedero (E4 §6.4): la devolución vuelve como saldo, positivo.
        if (medio === 'monedero') {
          await tx.movimientoMonedero.create({
            data: {
              clienteId: venta.clienteId!,
              monto: calculo.monto,
              motivo: 'devolucion',
              referenciaTipo: 'devolucion',
              referenciaId: dev.id,
              nota: `${folio} sobre ${venta.folio}: ${motivo}`,
              usuarioId: req.user.sub,
            },
          });
        }
        await tx.auditoria.create({
          data: {
            usuarioId: req.user.sub,
            entidad: 'venta',
            entidadId: venta.id,
            accion: 'devolver',
            valorNuevo: { folioVenta: venta.folio, folioDevolucion: folio, monto: calculo.monto, medio, motivo, lineas: calculo.lineas.length, reponen: reponen.length },
          },
        });
        return dev;
      });
      return reply.code(201).send(creada);
    } catch (e) {
      if (e instanceof ErrorStock) return reply.code(e.status).send(e.cuerpo);
      throw e;
    }
  });

  // ---------- Movimientos de caja (C9, §6.7) ----------
  app.get<{ Params: { id: string } }>('/turnos/:id/movimientos-caja', vendedor, async (req, reply) => {
    const turno = await prisma.turnoCaja.findUnique({ where: { id: req.params.id } });
    if (!turno) return reply.code(404).send({ error: 'TURNO_NO_ENCONTRADO' });
    const movimientos = await prisma.movimientoCaja.findMany({
      where: { turnoCajaId: turno.id },
      orderBy: { creadoEn: 'asc' },
      include: { usuario: { select: { nombre: true } } },
    });
    return { movimientos };
  });

  app.post<{ Params: { id: string }; Body: { tipo?: unknown; monto?: unknown; nota?: unknown } }>(
    '/turnos/:id/movimientos-caja',
    encargado,
    async (req, reply) => {
      const turno = await prisma.turnoCaja.findUnique({ where: { id: req.params.id } });
      if (!turno) return reply.code(404).send({ error: 'TURNO_NO_ENCONTRADO' });
      if (turno.estado !== 'abierto') return reply.code(409).send({ error: 'TURNO_CERRADO' });
      const b = req.body ?? {};
      if (b.tipo !== 'ingreso' && b.tipo !== 'retiro') return reply.code(422).send({ error: 'TIPO_INVALIDO', detalle: 'ingreso | retiro' });
      if (!Number.isInteger(b.monto) || (b.monto as number) <= 0) return reply.code(422).send({ error: 'MONTO_INVALIDO', detalle: 'entero > 0 en CLP' });
      const nota = typeof b.nota === 'string' ? b.nota.trim() : '';
      if (!nota) return reply.code(422).send({ error: 'NOTA_REQUERIDA' });
      const mov = await prisma.movimientoCaja.create({
        data: { turnoCajaId: turno.id, tipo: b.tipo, monto: b.monto as number, nota, usuarioId: req.user.sub },
        include: { usuario: { select: { nombre: true } } },
      });
      await prisma.auditoria.create({
        data: { usuarioId: req.user.sub, entidad: 'turno_caja', entidadId: turno.id, accion: 'editar', valorNuevo: { movimientoCajaId: mov.id, tipo: b.tipo, monto: b.monto as number, nota } },
      });
      return reply.code(201).send(mov);
    },
  );
}
