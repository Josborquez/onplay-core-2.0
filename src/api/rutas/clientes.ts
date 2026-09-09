// Clientes — 07-SDD §7.1 (E4 Fase 2: C1/C2/C3/C6, sin monedero).
// POST /clientes es la ÚNICA escritura de esta etapa permitida a un vendedor.
// El saldo NUNCA es un campo: se calcula como SUM(MovimientoMonedero.monto) (M1, §6.1).
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  detectarDuplicadosCliente,
  nombreBusquedaCliente,
  normalizarRut,
  rolAlcanza,
  validarMovimientoManual,
  type ClienteComparable,
  type MotivoMonedero,
  type Rol,
} from '@onplay/dominio';
import { prisma } from '../db.js';
import { CANALES_WOO, type CanalWoo, type ResumenClientesCanal } from '../sync/clientes.js';

const MENSAJE_RUT = 'Ese RUT no es válido. Revisa el dígito verificador.';

/** Campos públicos de la ficha (sin nombreBusqueda, que es interno). */
const SELECT_CLIENTE = {
  id: true,
  nombre: true,
  rut: true,
  email: true,
  telefono: true,
  notas: true,
  activo: true,
  permiteCredito: true,
  limiteCredito: true,
  creadoEn: true,
  actualizadoEn: true,
} satisfies Prisma.ClienteSelect;

/** saldo(cliente) = SUM(monto) por cliente, en una sola consulta agregada (§6.1). */
async function saldosPorCliente(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const grupos = await prisma.movimientoMonedero.groupBy({
    by: ['clienteId'],
    where: { clienteId: { in: ids } },
    _sum: { monto: true },
  });
  return new Map(grupos.map((g) => [g.clienteId, g._sum.monto ?? 0]));
}

/** Última compra completada por cliente (columna de V18), una consulta agregada. */
async function ultimasCompras(ids: string[]): Promise<Map<string, Date>> {
  if (ids.length === 0) return new Map();
  const grupos = await prisma.venta.groupBy({
    by: ['clienteId'],
    where: { clienteId: { in: ids }, estado: 'completada' },
    _max: { creadoEn: true },
  });
  return new Map(
    grupos
      .filter((g) => g.clienteId !== null && g._max.creadoEn !== null)
      .map((g) => [g.clienteId!, g._max.creadoEn!]),
  );
}

/** Candidatos para la detección de duplicados §6.6. Volumen chico (cientos): se
 * comparan todos en memoria con la regla pura del dominio. */
async function candidatosDuplicados(excluirId?: string): Promise<ClienteComparable[]> {
  return prisma.cliente.findMany({
    where: { activo: true, ...(excluirId ? { id: { not: excluirId } } : {}) },
    select: { id: true, rut: true, email: true, telefono: true, nombreBusqueda: true },
  });
}

interface CuerpoCliente {
  nombre?: unknown;
  rut?: unknown;
  email?: unknown;
  telefono?: unknown;
  notas?: unknown;
  activo?: unknown;
  permiteCredito?: unknown;
  limiteCredito?: unknown;
  nota?: unknown; // exigida al cambiar el crédito (§6.4)
}

export default async function rutasClientes(app: FastifyInstance) {
  const vendedor = { preHandler: app.requiereRol('vendedor') };
  const encargado = { preHandler: app.requiereRol('encargado') };

  // ---------- GET /clientes/buscar — mostrador, máx 10, p95 < 200 ms ----------
  // Busca por nombre (prefijo vía nombreBusqueda: "Ped" encuentra "Pedro",
  // criterio 17), RUT, teléfono y correo.
  app.get<{ Querystring: { q?: string } }>('/clientes/buscar', vendedor, async (req) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return { resultados: [] };

    const rutNorm = normalizarRut(q);
    const nombreNorm = nombreBusquedaCliente(q);
    const clientes = await prisma.cliente.findMany({
      where: {
        activo: true,
        OR: [
          ...(rutNorm ? [{ rut: rutNorm }] : []),
          { rut: { contains: q } },
          ...(nombreNorm.length >= 2 ? [{ nombreBusqueda: { contains: nombreNorm } }] : []),
          { telefono: { contains: q } },
          { email: { contains: q } },
        ],
      },
      select: SELECT_CLIENTE,
      orderBy: { nombre: 'asc' },
      take: 10,
    });
    const saldos = await saldosPorCliente(clientes.map((c) => c.id));
    return { resultados: clientes.map((c) => ({ ...c, saldo: saldos.get(c.id) ?? 0 })) };
  });

  // ---------- GET /clientes — panel del encargado, cursor ----------
  // V18: filtros con saldo / con deuda / con crédito y orden por saldo o última
  // compra. Ordenar por un agregado exige el conjunto completo: volumen chico
  // (cientos) → se ordena en memoria y se devuelve sin cursor.
  app.get<{
    Querystring: {
      q?: string;
      conSaldo?: string;
      conDeuda?: string;
      conCredito?: string;
      activo?: string;
      orden?: string;
      limit?: string;
      cursor?: string;
    };
  }>('/clientes', encargado, async (req) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const orden =
      req.query.orden === 'saldo' || req.query.orden === 'ultimaCompra' ? req.query.orden : null;

    // conSaldo: SUM(monto) ≠ 0; conDeuda: SUM(monto) < 0. Volumen chico → ids primero.
    let idsConSaldo: string[] | null = null;
    let idsConDeuda: string[] | null = null;
    if (req.query.conSaldo === 'true' || req.query.conDeuda === 'true') {
      const grupos = await prisma.movimientoMonedero.groupBy({
        by: ['clienteId'],
        _sum: { monto: true },
      });
      if (req.query.conSaldo === 'true') {
        idsConSaldo = grupos.filter((g) => (g._sum.monto ?? 0) !== 0).map((g) => g.clienteId);
      }
      if (req.query.conDeuda === 'true') {
        idsConDeuda = grupos.filter((g) => (g._sum.monto ?? 0) < 0).map((g) => g.clienteId);
      }
    }

    const q = req.query.q?.trim();
    const where: Prisma.ClienteWhereInput = {
      AND: [
        ...(idsConSaldo ? [{ id: { in: idsConSaldo } }] : []),
        ...(idsConDeuda ? [{ id: { in: idsConDeuda } }] : []),
      ],
      ...(req.query.conCredito === 'true' ? { permiteCredito: true } : {}),
      ...(req.query.activo !== undefined ? { activo: req.query.activo === 'true' } : {}),
      ...(q
        ? {
            OR: [
              { nombreBusqueda: { contains: nombreBusquedaCliente(q) } },
              { rut: { contains: q } },
              { email: { contains: q } },
              { telefono: { contains: q } },
            ],
          }
        : {}),
    };

    if (orden) {
      const todos = await prisma.cliente.findMany({ where, select: SELECT_CLIENTE });
      const ids = todos.map((c) => c.id);
      const [saldos, ultimas] = await Promise.all([saldosPorCliente(ids), ultimasCompras(ids)]);
      const filas = todos.map((c) => ({
        ...c,
        saldo: saldos.get(c.id) ?? 0,
        ultimaCompra: ultimas.get(c.id) ?? null,
      }));
      filas.sort(
        orden === 'saldo'
          ? (a, b) => b.saldo - a.saldo
          : (a, b) => (b.ultimaCompra?.getTime() ?? 0) - (a.ultimaCompra?.getTime() ?? 0),
      );
      return { clientes: filas.slice(0, limit), siguienteCursor: null };
    }

    const clientes = await prisma.cliente.findMany({
      where,
      select: SELECT_CLIENTE,
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(req.query.cursor ? { cursor: { id: req.query.cursor }, skip: 1 } : {}),
    });
    const hayMas = clientes.length > limit;
    if (hayMas) clientes.pop();
    const ids = clientes.map((c) => c.id);
    const [saldos, ultimas] = await Promise.all([saldosPorCliente(ids), ultimasCompras(ids)]);
    return {
      clientes: clientes.map((c) => ({
        ...c,
        saldo: saldos.get(c.id) ?? 0,
        ultimaCompra: ultimas.get(c.id) ?? null,
      })),
      siguienteCursor: hayMas ? clientes[clientes.length - 1]!.id : null,
    };
  });

  // ---------- GET /clientes/:id — ficha: datos, saldo calculado, canales ----------
  app.get<{ Params: { id: string } }>('/clientes/:id', vendedor, async (req, reply) => {
    const cliente = await prisma.cliente.findUnique({
      where: { id: req.params.id },
      select: {
        ...SELECT_CLIENTE,
        canales: {
          select: {
            id: true,
            canalId: true,
            externoUserId: true,
            externoEmail: true,
            vinculadoEn: true,
            desvinculadoEn: true,
          },
        },
      },
    });
    if (!cliente) return reply.code(404).send({ error: 'CLIENTE_NO_ENCONTRADO' });
    const saldos = await saldosPorCliente([cliente.id]);
    return { ...cliente, saldo: saldos.get(cliente.id) ?? 0 };
  });

  // ---------- GET /clientes/:id/compras — historial consolidado (§7.2) ----------
  // Vista REDUCIDA para el vendedor (criterio 18): fecha, total y origen, SIN
  // folio, SIN nombre del vendedor y SIN enlace al detalle. El encargado ve todo.
  // Pedidos de canales: dependen de PedidoCanal (E3, no existe) → pedidosDisponibles:false.
  app.get<{ Params: { id: string }; Querystring: { pagina?: string } }>(
    '/clientes/:id/compras',
    vendedor,
    async (req, reply) => {
      const cliente = await prisma.cliente.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!cliente) return reply.code(404).send({ error: 'CLIENTE_NO_ENCONTRADO' });

      const pagina = Math.max(1, Number(req.query.pagina ?? 1) || 1);
      const porPagina = 50;
      const esEncargado = rolAlcanza(req.user.rol as Rol, 'encargado');
      const [total, ventas] = await Promise.all([
        prisma.venta.count({ where: { clienteId: cliente.id } }),
        prisma.venta.findMany({
          where: { clienteId: cliente.id },
          orderBy: { creadoEn: 'desc' },
          skip: (pagina - 1) * porPagina,
          take: porPagina,
          select: {
            creadoEn: true,
            total: true,
            estado: true,
            ...(esEncargado
              ? { id: true, folio: true, usuario: { select: { id: true, nombre: true } } }
              : {}),
          },
        }),
      ]);
      return {
        total,
        pagina,
        porPagina,
        compras: ventas.map((v) => ({ ...v, origen: 'tienda_fisica' })),
        pedidosDisponibles: false, // la parte de pedidos llega con E3 (§7.2)
      };
    },
  );

  // ---------- GET /clientes/:id/movimientos — libro con saldo corriente (§7.2) ----------
  // Vista reducida para el vendedor (criterio 18): sin usuario ni referencia a
  // la venta (folio). El encargado ve todo. Volumen chico: se devuelve entero.
  app.get<{ Params: { id: string } }>('/clientes/:id/movimientos', vendedor, async (req, reply) => {
    const cliente = await prisma.cliente.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!cliente) return reply.code(404).send({ error: 'CLIENTE_NO_ENCONTRADO' });

    const esEncargado = rolAlcanza(req.user.rol as Rol, 'encargado');
    const movimientos = await prisma.movimientoMonedero.findMany({
      where: { clienteId: cliente.id },
      orderBy: { creadoEn: 'asc' },
      include: { usuario: { select: { id: true, nombre: true } } },
    });
    let saldo = 0;
    const conSaldo = movimientos.map((m) => {
      saldo += m.monto;
      return {
        id: m.id,
        creadoEn: m.creadoEn,
        motivo: m.motivo,
        monto: m.monto,
        nota: m.nota,
        saldoDespues: saldo,
        ...(esEncargado
          ? { usuario: m.usuario, referenciaTipo: m.referenciaTipo, referenciaId: m.referenciaId }
          : {}),
      };
    });
    conSaldo.reverse(); // más reciente primero, como V16
    return { saldo, movimientos: conSaldo };
  });

  // ---------- GET /clientes/candidatos — propuestas de la última importación (§7.3) ----------
  // Lee la última corrida por canal (SyncLog operacion 'clientes') y descarta lo
  // que ya se vinculó después. Fastify resuelve la ruta estática antes que
  // /clientes/:id, así que el orden de registro no importa.
  app.get('/clientes/candidatos', encargado, async () => {
    const canales = [];
    for (const canalId of CANALES_WOO) {
      const log = await prisma.syncLog.findFirst({
        where: { canalId, operacion: 'clientes' },
        orderBy: { creadoEn: 'desc' },
      });
      if (!log?.detalle) continue;
      let resumen: ResumenClientesCanal;
      try {
        resumen = JSON.parse(log.detalle) as ResumenClientesCanal;
      } catch {
        continue;
      }
      const vinculados = await prisma.clienteCanal.findMany({
        where: { canalId, desvinculadoEn: null },
        select: { externoUserId: true },
      });
      const ya = new Set(vinculados.map((v) => v.externoUserId));
      canales.push({
        canalId,
        corridaEn: log.creadoEn,
        dryRun: resumen.dryRun,
        vinculos: (resumen.vinculos ?? []).filter((v) => !ya.has(v.externoUserId)),
        sinCoincidencia: (resumen.sinCoincidencia ?? []).filter((p) => !ya.has(p.externoUserId)),
        conflictos: resumen.conflictos ?? [],
      });
    }
    return { canales };
  });

  // ---------- POST /clientes/:id/vincular — confirmar un vínculo, ENCARGADO (§7.3) ----------
  // Dos uniques del schema §5: [canalId, externoUserId] (una cuenta → un cliente)
  // y [clienteId, canalId] (un cliente → una cuenta por canal). Una fila
  // desvinculada del mismo par cliente-canal se REUTILIZA (M4: nunca se borró).
  app.post<{
    Params: { id: string };
    Body: { canalId?: unknown; externoUserId?: unknown; externoEmail?: unknown };
  }>('/clientes/:id/vincular', encargado, async (req, reply) => {
    const cliente = await prisma.cliente.findUnique({
      where: { id: req.params.id },
      select: { id: true, nombre: true },
    });
    if (!cliente) return reply.code(404).send({ error: 'CLIENTE_NO_ENCONTRADO' });

    const canalId = req.body?.canalId;
    if (typeof canalId !== 'string' || !CANALES_WOO.includes(canalId as CanalWoo)) {
      return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: `canalId: ${CANALES_WOO.join(' | ')}` });
    }
    const externoUserId = req.body?.externoUserId;
    if (!Number.isInteger(externoUserId) || (externoUserId as number) <= 0) {
      return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: 'externoUserId: entero > 0 (id de wc/v3/customers)' });
    }
    const externoEmail =
      typeof req.body?.externoEmail === 'string' && req.body.externoEmail.trim() !== ''
        ? req.body.externoEmail.trim().toLowerCase()
        : null;

    const deLaCuenta = await prisma.clienteCanal.findUnique({
      where: { canalId_externoUserId: { canalId, externoUserId: externoUserId as number } },
    });
    if (deLaCuenta && deLaCuenta.clienteId !== cliente.id) {
      return reply.code(409).send({
        error: 'CUENTA_YA_VINCULADA',
        detalle:
          deLaCuenta.desvinculadoEn === null
            ? 'Esa cuenta del canal ya está vinculada a otro cliente'
            : 'Esa cuenta quedó registrada (desvinculada) en otro cliente; la historia no se borra (M4)',
      });
    }
    const delCliente = await prisma.clienteCanal.findUnique({
      where: { clienteId_canalId: { clienteId: cliente.id, canalId } },
    });
    if (delCliente && delCliente.desvinculadoEn === null && delCliente.externoUserId !== externoUserId) {
      return reply.code(409).send({
        error: 'CLIENTE_YA_VINCULADO',
        detalle: 'El cliente ya tiene otra cuenta activa en este canal; desvincula primero',
      });
    }

    const vinculo = await prisma.$transaction(async (tx) => {
      const fila = await tx.clienteCanal.upsert({
        where: { clienteId_canalId: { clienteId: cliente.id, canalId } },
        create: { clienteId: cliente.id, canalId, externoUserId: externoUserId as number, externoEmail },
        update: {
          externoUserId: externoUserId as number,
          externoEmail,
          vinculadoEn: new Date(),
          desvinculadoEn: null,
        },
      });
      await tx.auditoria.create({
        data: {
          usuarioId: req.user.sub,
          entidad: 'cliente',
          entidadId: cliente.id,
          accion: 'editar',
          valorNuevo: { vinculo: fila.id, canalId, externoUserId: externoUserId as number, externoEmail, origen: 'manual' },
        },
      });
      return fila;
    });
    return reply.code(201).send(vinculo);
  });

  // ---------- POST /clientes/:id/desvincular — ENCARGADO (§7.3, criterio 20) ----------
  // NO borra: marca desvinculadoEn (M4). La importación respeta esta decisión y
  // no re-vincula la cuenta sola.
  app.post<{ Params: { id: string }; Body: { canalId?: unknown } }>(
    '/clientes/:id/desvincular',
    encargado,
    async (req, reply) => {
      const canalId = req.body?.canalId;
      if (typeof canalId !== 'string' || !CANALES_WOO.includes(canalId as CanalWoo)) {
        return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: `canalId: ${CANALES_WOO.join(' | ')}` });
      }
      const fila = await prisma.clienteCanal.findUnique({
        where: { clienteId_canalId: { clienteId: req.params.id, canalId } },
      });
      if (!fila || fila.desvinculadoEn !== null) {
        return reply.code(404).send({
          error: 'VINCULO_NO_ENCONTRADO',
          detalle: 'El cliente no tiene una cuenta activa en ese canal',
        });
      }
      const actualizado = await prisma.$transaction(async (tx) => {
        const v = await tx.clienteCanal.update({
          where: { id: fila.id },
          data: { desvinculadoEn: new Date() },
        });
        await tx.auditoria.create({
          data: {
            usuarioId: req.user.sub,
            entidad: 'cliente',
            entidadId: fila.clienteId,
            accion: 'editar',
            valorAnterior: { vinculo: fila.id, canalId, externoUserId: fila.externoUserId, desvinculadoEn: null },
            valorNuevo: { vinculo: fila.id, canalId, externoUserId: fila.externoUserId, desvinculadoEn: v.desvinculadoEn },
          },
        });
        return v;
      });
      return actualizado;
    },
  );

  // ---------- POST /clientes/:id/monedero — movimiento manual, ENCARGADO (§7.2) ----------
  // Solo cargas sin dinero: premio, ajuste, reverso (y carga excepcional por API).
  // Una carga CON dinero es una venta de SRV-000001 y va por POST /ventas (§6.3).
  app.post<{ Params: { id: string }; Body: { monto?: unknown; motivo?: unknown; nota?: unknown } }>(
    '/clientes/:id/monedero',
    encargado,
    async (req, reply) => {
      const cliente = await prisma.cliente.findUnique({
        where: { id: req.params.id },
        select: { id: true, activo: true },
      });
      if (!cliente) return reply.code(404).send({ error: 'CLIENTE_NO_ENCONTRADO' });

      const MOTIVOS: MotivoMonedero[] = ['carga', 'consumo', 'devolucion', 'premio_evento', 'ajuste', 'reverso_carga'];
      const motivo = req.body?.motivo;
      if (typeof motivo !== 'string' || !MOTIVOS.includes(motivo as MotivoMonedero)) {
        return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: 'motivo: carga | premio_evento | ajuste | reverso_carga' });
      }
      const monto = req.body?.monto;
      if (typeof monto !== 'number') {
        return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: 'monto: CLP entero con signo, distinto de cero' });
      }
      const nota = typeof req.body?.nota === 'string' ? req.body.nota.trim() : '';

      const invalido = validarMovimientoManual({ motivo: motivo as MotivoMonedero, monto, nota });
      if (invalido) {
        const detalles: Record<string, string> = {
          MOTIVO_NO_MANUAL: 'consumo y devolucion los genera el sistema desde una venta, nunca a mano (§7.2)',
          MONTO_INVALIDO: 'monto: CLP entero con signo, distinto de cero',
          SIGNO_INVALIDO: `Este motivo exige monto ${'esperado' in invalido ? invalido.esperado : ''}`,
          NOTA_REQUERIDA: 'Un ajuste o reverso sin explicación es un agujero en la auditoría (§7.2)',
        };
        return reply.code(422).send({ error: invalido.codigo, detalle: detalles[invalido.codigo] });
      }

      const resultado = await prisma.$transaction(async (tx) => {
        const previo = await tx.movimientoMonedero.aggregate({
          where: { clienteId: cliente.id },
          _sum: { monto: true },
        });
        const saldoAnterior = previo._sum.monto ?? 0;
        const movimiento = await tx.movimientoMonedero.create({
          data: {
            clienteId: cliente.id,
            monto,
            motivo: motivo as MotivoMonedero,
            nota: nota || null,
            usuarioId: req.user.sub,
          },
        });
        // Criterio 11: usuario, monto, motivo y nota en Auditoria, siempre.
        await tx.auditoria.create({
          data: {
            usuarioId: req.user.sub,
            entidad: 'cliente',
            entidadId: cliente.id,
            accion: 'crear',
            valorAnterior: { saldo: saldoAnterior },
            valorNuevo: { movimientoId: movimiento.id, motivo, monto, nota: nota || null, saldo: saldoAnterior + monto },
          },
        });
        return { movimiento, saldo: saldoAnterior + monto };
      });
      return reply.code(201).send(resultado);
    },
  );

  // ---------- POST /clientes — alta, rol VENDEDOR (única escritura de vendedor) ----------
  // Solo nombre es obligatorio (M2). Duplicados §6.6: rut/email idéntico (alta)
  // → NO se crea; teléfono (media) y nombre (baja) → se crea y se avisa.
  app.post<{ Body: CuerpoCliente }>('/clientes', vendedor, async (req, reply) => {
    const b = req.body ?? {};
    const nombre = typeof b.nombre === 'string' ? b.nombre.trim() : '';
    if (!nombre) return reply.code(422).send({ error: 'NOMBRE_REQUERIDO' });

    let rut: string | null = null;
    if (typeof b.rut === 'string' && b.rut.trim() !== '') {
      rut = normalizarRut(b.rut);
      if (!rut) return reply.code(422).send({ error: 'RUT_INVALIDO', detalle: MENSAJE_RUT });
    }
    const email = typeof b.email === 'string' && b.email.trim() !== '' ? b.email.trim() : null;
    const telefono =
      typeof b.telefono === 'string' && b.telefono.trim() !== '' ? b.telefono.trim() : null;
    const notas = typeof b.notas === 'string' && b.notas.trim() !== '' ? b.notas.trim() : null;

    const duplicados = detectarDuplicadosCliente(
      { nombre, rut, email, telefono },
      await candidatosDuplicados(),
    );
    const altos = duplicados.filter((d) => d.confianza === 'alta');
    if (altos.length > 0) {
      return reply.code(409).send({
        error: 'CLIENTE_DUPLICADO',
        detalle: 'Ya existe un cliente con ese RUT o correo',
        duplicados: altos,
      });
    }

    try {
      const cliente = await prisma.cliente.create({
        data: { nombre, rut, email, telefono, notas, nombreBusqueda: nombreBusquedaCliente(nombre) },
        select: SELECT_CLIENTE,
      });
      await prisma.auditoria.create({
        data: {
          usuarioId: req.user.sub,
          entidad: 'cliente',
          entidadId: cliente.id,
          accion: 'crear',
          valorNuevo: { nombre, rut, email, telefono },
        },
      });
      // media/baja no bloquean: se proponen (§6.6)
      return reply.code(201).send({ cliente: { ...cliente, saldo: 0 }, posiblesDuplicados: duplicados });
    } catch (e) {
      // Carrera sobre rut @unique: dos altas simultáneas con el mismo RUT.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return reply.code(409).send({ error: 'CLIENTE_DUPLICADO', detalle: 'Ya existe un cliente con ese RUT' });
      }
      throw e;
    }
  });

  // ---------- PATCH /clientes/:id — edición, rol encargado ----------
  // Cambiar permiteCredito o limiteCredito exige nota (§6.4) y queda en Auditoria.
  app.patch<{ Params: { id: string }; Body: CuerpoCliente }>(
    '/clientes/:id',
    encargado,
    async (req, reply) => {
      const actual = await prisma.cliente.findUnique({ where: { id: req.params.id } });
      if (!actual) return reply.code(404).send({ error: 'CLIENTE_NO_ENCONTRADO' });

      const b = req.body ?? {};
      const data: Prisma.ClienteUpdateInput = {};

      if ('nombre' in b) {
        const nombre = typeof b.nombre === 'string' ? b.nombre.trim() : '';
        if (!nombre) return reply.code(422).send({ error: 'NOMBRE_REQUERIDO' });
        data.nombre = nombre;
        data.nombreBusqueda = nombreBusquedaCliente(nombre);
      }
      if ('rut' in b) {
        if (b.rut === null || (typeof b.rut === 'string' && b.rut.trim() === '')) {
          data.rut = null;
        } else if (typeof b.rut === 'string') {
          const rut = normalizarRut(b.rut);
          if (!rut) return reply.code(422).send({ error: 'RUT_INVALIDO', detalle: MENSAJE_RUT });
          data.rut = rut;
        }
      }
      if ('email' in b) data.email = typeof b.email === 'string' && b.email.trim() !== '' ? b.email.trim() : null;
      if ('telefono' in b)
        data.telefono = typeof b.telefono === 'string' && b.telefono.trim() !== '' ? b.telefono.trim() : null;
      if ('notas' in b) data.notas = typeof b.notas === 'string' && b.notas.trim() !== '' ? b.notas.trim() : null;
      if ('activo' in b && typeof b.activo === 'boolean') data.activo = b.activo;

      const tocaCredito = 'permiteCredito' in b || 'limiteCredito' in b;
      const nota = typeof b.nota === 'string' ? b.nota.trim() : '';
      if (tocaCredito) {
        if (!nota) {
          return reply.code(422).send({
            error: 'NOTA_REQUERIDA',
            detalle: 'Cambiar el crédito exige una nota (§6.4)',
          });
        }
        if ('permiteCredito' in b) {
          if (typeof b.permiteCredito !== 'boolean') {
            return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: 'permiteCredito: boolean' });
          }
          data.permiteCredito = b.permiteCredito;
        }
        if ('limiteCredito' in b) {
          if (!Number.isInteger(b.limiteCredito) || (b.limiteCredito as number) < 0) {
            return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: 'limiteCredito: CLP entero >= 0' });
          }
          data.limiteCredito = b.limiteCredito as number;
        }
      }

      if (Object.keys(data).length === 0) return reply.code(400).send({ error: 'SIN_CAMBIOS' });

      try {
        const cliente = await prisma.cliente.update({
          where: { id: actual.id },
          data,
          select: SELECT_CLIENTE,
        });
        const claves = Object.keys(data).filter((k) => k !== 'nombreBusqueda');
        await prisma.auditoria.create({
          data: {
            usuarioId: req.user.sub,
            entidad: 'cliente',
            entidadId: cliente.id,
            accion: 'editar',
            valorAnterior: Object.fromEntries(
              claves.map((k) => [k, (actual as unknown as Record<string, unknown>)[k] ?? null]),
            ) as Prisma.InputJsonValue,
            valorNuevo: {
              ...Object.fromEntries(
                claves.map((k) => [k, (cliente as unknown as Record<string, unknown>)[k] ?? null]),
              ),
              ...(nota ? { nota } : {}),
            } as Prisma.InputJsonValue,
          },
        });
        const saldos = await saldosPorCliente([cliente.id]);
        return { ...cliente, saldo: saldos.get(cliente.id) ?? 0 };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return reply.code(409).send({ error: 'CLIENTE_DUPLICADO', detalle: 'Ya existe un cliente con ese RUT' });
        }
        throw e;
      }
    },
  );
}
