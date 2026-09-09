// Turnos de caja con arqueo (§5.3).
// El arqueo es regla pura (calcularArqueo en @onplay/dominio); aquí va la parte con DB.
import type { FastifyInstance } from 'fastify';
import { calcularArqueo, rolAlcanza, type Rol } from '@onplay/dominio';
import { prisma } from '../db.js';

/** E2 §6.7: devoluciones en efectivo e ingresos/retiros de caja del turno. */
async function extrasDelTurno(turnoCajaId: string) {
  const [dev, mov] = await Promise.all([
    prisma.devolucion.aggregate({ _sum: { monto: true }, where: { turnoCajaId, medio: 'efectivo' } }),
    prisma.movimientoCaja.groupBy({ by: ['tipo'], _sum: { monto: true }, where: { turnoCajaId } }),
  ]);
  return {
    devolucionesEfectivo: dev._sum.monto ?? 0,
    ingresosCaja: mov.find((m) => m.tipo === 'ingreso')?._sum.monto ?? 0,
    retirosCaja: mov.find((m) => m.tipo === 'retiro')?._sum.monto ?? 0,
  };
}

async function efectivoDelTurno(turnoCajaId: string): Promise<number> {
  const agg = await prisma.pago.aggregate({
    _sum: { monto: true },
    where: {
      medio: 'efectivo',
      venta: { turnoCajaId, estado: 'completada' },
    },
  });
  return agg._sum.monto ?? 0;
}

export default async function rutasTurnos(app: FastifyInstance) {
  const vendedor = { preHandler: app.requiereRol('vendedor') };
  const encargado = { preHandler: app.requiereRol('encargado') };

  app.post<{ Body: { montoApertura?: unknown } }>('/turnos/abrir', vendedor, async (req, reply) => {
    const montoApertura = req.body?.montoApertura;
    if (!Number.isInteger(montoApertura) || (montoApertura as number) < 0) {
      return reply.code(422).send({
        error: 'MONTO_APERTURA_INVALIDO',
        detalle: 'montoApertura debe ser un entero >= 0 en CLP',
      });
    }
    const abierto = await prisma.turnoCaja.findFirst({
      where: { usuarioId: req.user.sub, estado: 'abierto' },
    });
    if (abierto) {
      return reply.code(409).send({ error: 'TURNO_YA_ABIERTO', turnoCajaId: abierto.id });
    }
    const turno = await prisma.turnoCaja.create({
      data: { usuarioId: req.user.sub, montoApertura: montoApertura as number },
    });
    await prisma.auditoria.create({
      data: {
        usuarioId: req.user.sub,
        entidad: 'turno_caja',
        entidadId: turno.id,
        accion: 'abrir_turno',
        valorNuevo: { montoApertura: turno.montoApertura },
      },
    });
    return reply.code(201).send(turno);
  });

  app.get('/turnos/actual', vendedor, async (req) => {
    const turno = await prisma.turnoCaja.findFirst({
      where: { usuarioId: req.user.sub, estado: 'abierto' },
    });
    return turno ?? null;
  });

  app.post<{ Params: { id: string }; Body: { montoDeclarado?: unknown; notas?: unknown } }>(
    '/turnos/:id/cerrar',
    vendedor,
    async (req, reply) => {
      const turno = await prisma.turnoCaja.findUnique({ where: { id: req.params.id } });
      if (!turno) return reply.code(404).send({ error: 'TURNO_NO_ENCONTRADO' });
      const esEncargado = rolAlcanza(req.user.rol as Rol, 'encargado');
      if (turno.usuarioId !== req.user.sub && !esEncargado) {
        return reply.code(403).send({ error: 'TURNO_AJENO' });
      }
      // El cierre es irreversible (§5.3): un turno cerrado no se reabre ni se recierra.
      if (turno.estado !== 'abierto') {
        return reply.code(409).send({ error: 'TURNO_CERRADO' });
      }
      const montoDeclarado = req.body?.montoDeclarado;
      if (!Number.isInteger(montoDeclarado) || (montoDeclarado as number) < 0) {
        return reply.code(422).send({
          error: 'MONTO_DECLARADO_INVALIDO',
          detalle: 'montoDeclarado debe ser un entero >= 0 en CLP',
        });
      }
      const notas = typeof req.body?.notas === 'string' ? req.body.notas.trim() : '';

      const [efectivo, extras] = await Promise.all([efectivoDelTurno(turno.id), extrasDelTurno(turno.id)]);
      const { montoEsperado, diferencia } = calcularArqueo(
        turno.montoApertura,
        efectivo,
        montoDeclarado as number,
        extras, // E2 §6.7
      );
      // Validación en el servidor, no solo en la interfaz (§5.3).
      if (diferencia !== 0 && notas === '') {
        return reply.code(422).send({
          error: 'NOTA_REQUERIDA',
          detalle: `La diferencia es ${diferencia}; explica el descuadre en notas`,
          montoEsperado,
          diferencia,
        });
      }
      const cerrado = await prisma.turnoCaja.update({
        where: { id: turno.id },
        data: {
          estado: 'cerrado',
          cerradoEn: new Date(),
          montoDeclarado: montoDeclarado as number,
          montoEsperado,
          diferencia,
          notas: notas || null,
        },
      });
      await prisma.auditoria.create({
        data: {
          usuarioId: req.user.sub,
          entidad: 'turno_caja',
          entidadId: turno.id,
          accion: 'cerrar_turno',
          valorNuevo: { montoDeclarado: montoDeclarado as number, montoEsperado, diferencia, notas: notas || null },
        },
      });
      return { ...cerrado, montoEsperado, diferencia };
    },
  );

  app.get<{ Params: { id: string } }>('/turnos/:id/resumen', vendedor, async (req, reply) => {
    const turno = await prisma.turnoCaja.findUnique({ where: { id: req.params.id } });
    if (!turno) return reply.code(404).send({ error: 'TURNO_NO_ENCONTRADO' });
    if (turno.usuarioId !== req.user.sub && !rolAlcanza(req.user.rol as Rol, 'encargado')) {
      return reply.code(403).send({ error: 'TURNO_AJENO' });
    }
    const [porMedio, ventas] = await Promise.all([
      prisma.pago.groupBy({
        by: ['medio'],
        _sum: { monto: true },
        where: { venta: { turnoCajaId: turno.id, estado: 'completada' } },
      }),
      prisma.venta.aggregate({
        _count: { _all: true },
        _sum: { total: true },
        where: { turnoCajaId: turno.id, estado: 'completada' },
      }),
    ]);
    const cantidadVentas = ventas._count._all;
    const totalVendido = ventas._sum.total ?? 0;
    // E2 §6.7: el esperado en vivo lo calcula el servidor con la misma fórmula del cierre.
    const extras = await extrasDelTurno(turno.id);
    const efectivo = porMedio.find((m) => m.medio === 'efectivo')?._sum.monto ?? 0;
    const { montoEsperado } = calcularArqueo(turno.montoApertura, efectivo, 0, extras);
    return {
      turnoCajaId: turno.id,
      estado: turno.estado,
      montoApertura: turno.montoApertura,
      totalesPorMedio: porMedio.map((m) => ({ medio: m.medio, total: m._sum.monto ?? 0 })),
      cantidadVentas,
      totalVendido,
      ticketPromedio: cantidadVentas > 0 ? Math.round(totalVendido / cantidadVentas) : 0,
      ...extras,
      montoEsperado,
    };
  });

  app.get<{ Querystring: { usuarioId?: string; pagina?: string } }>(
    '/turnos',
    encargado,
    async (req) => {
      const pagina = Math.max(1, Number(req.query.pagina ?? 1) || 1);
      const porPagina = 50;
      const where = req.query.usuarioId ? { usuarioId: req.query.usuarioId } : {};
      const [total, turnos] = await Promise.all([
        prisma.turnoCaja.count({ where }),
        prisma.turnoCaja.findMany({
          where,
          orderBy: { abiertoEn: 'desc' },
          skip: (pagina - 1) * porPagina,
          take: porPagina,
          include: { usuario: { select: { id: true, nombre: true, email: true } } },
        }),
      ]);
      return { total, pagina, porPagina, turnos };
    },
  );
}
