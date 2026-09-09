// Ventas (§5.4, §5.5). Las validaciones puras (3–9) viven en @onplay/dominio;
// aquí van las que dependen de la DB: turno abierto (1), idempotencia (2),
// congelado de descripción y precio (4), y el folio con SELECT ... FOR UPDATE (10).
// Todo dentro de una única transacción.
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  rolAlcanza,
  validarPagoMonedero,
  validarYCalcularVenta,
  type LineaEntrada,
  type PagoEntrada,
  type Rol, avisoWeb } from '@onplay/dominio';
import { prisma } from '../db.js';
import { ErrorStock, bloquearStock, contextoReserva, registrarMovimiento, ubicacionVenta } from '../stock/libro.js';

const MEDIOS_VALIDOS = new Set([
  'efectivo',
  'debito',
  'credito',
  'transferencia',
  'mercadopago',
  'otro',
  'monedero', // E4 F3 (§6.2): exige clienteId y saldo suficiente
]);

/** Producto-servicio de §6.3: una carga con dinero ES una venta de este SKU. */
const SKU_CARGA = 'SRV-000001';

/** Rechazo del monedero DENTRO de la transacción (§6.2 pasos 2–3): se aborta
 * todo — venta, folio y movimiento — y se responde el 422 con el detalle. */
class ErrorMonedero extends Error {
  constructor(public cuerpo: Record<string, unknown>) {
    super(String(cuerpo.error ?? 'MONEDERO'));
  }
}

interface CuerpoVenta {
  idempotencyKey?: unknown;
  clienteId?: unknown; // E4 HC2: cliente identificado, opcional (M3)
  /** E2 §6.9: encargado que vende pese al bloqueo por pedido web pagado; exige nota. */
  forzarReservado?: unknown;
  clienteNombre?: unknown;
  descuento?: unknown;
  lineas?: unknown;
  pagos?: unknown;
}

const incluirDetalle = {
  lineas: true,
  pagos: true,
} satisfies Prisma.VentaInclude;

export default async function rutasVentas(app: FastifyInstance) {
  const vendedor = { preHandler: app.requiereRol('vendedor') };
  const encargado = { preHandler: app.requiereRol('encargado') };

  app.post<{ Body: CuerpoVenta }>('/ventas', vendedor, async (req, reply) => {
    // 1. Turno abierto del usuario.
    const turno = await prisma.turnoCaja.findFirst({
      where: { usuarioId: req.user.sub, estado: 'abierto' },
    });
    if (!turno) return reply.code(409).send({ error: 'TURNO_NO_ABIERTO' });

    const idempotencyKey = req.body?.idempotencyKey;
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      return reply.code(422).send({ error: 'IDEMPOTENCY_KEY_REQUERIDA' });
    }
    // 2. Clave ya usada → la venta original con 200, no se crea otra.
    const previa = await prisma.venta.findUnique({
      where: { idempotencyKey },
      include: incluirDetalle,
    });
    if (previa) return reply.code(200).send({ venta: previa, advertencias: [], repetida: true });

    const lineasCrudas = Array.isArray(req.body?.lineas) ? (req.body.lineas as LineaEntrada[]) : [];
    const pagosCrudos = Array.isArray(req.body?.pagos) ? (req.body.pagos as PagoEntrada[]) : [];
    const descuento = typeof req.body?.descuento === 'number' ? req.body.descuento : 0;
    for (const p of pagosCrudos) {
      if (!MEDIOS_VALIDOS.has(p?.medio as string)) {
        return reply.code(422).send({ error: 'MEDIO_PAGO_INVALIDO', detalle: `medio desconocido: ${p?.medio}` });
      }
    }

    // 4 (parte con DB): congelar descripción y detectar precio distinto del vigente.
    const ids = [...new Set(lineasCrudas.map((l) => l?.productoId).filter((x): x is string => typeof x === 'string'))];
    const productos = new Map(
      (await prisma.producto.findMany({ where: { id: { in: ids } } })).map((p) => [p.id, p]),
    );
    type Advertencia =
      | { tipo: 'PRECIO_DISTINTO'; lineaIndex: number; precioActual: number; precioEnviado: number }
      | { tipo: 'STOCK_NEGATIVO'; productoId: string; descripcion: string; ubicacion: string; cantidadNueva: number };
    const advertencias: Advertencia[] = [];
    const lineas: LineaEntrada[] = [];
    for (let i = 0; i < lineasCrudas.length; i++) {
      const l = lineasCrudas[i]!;
      if (l.productoId != null) {
        const producto = productos.get(l.productoId);
        if (!producto) {
          return reply.code(422).send({ error: 'PRODUCTO_NO_ENCONTRADO', detalle: `Línea ${i}: productoId ${l.productoId}` });
        }
        if (producto.precioVenta !== l.precioUnitario) {
          advertencias.push({ tipo: 'PRECIO_DISTINTO', lineaIndex: i, precioActual: producto.precioVenta, precioEnviado: l.precioUnitario });
        }
        lineas.push({ ...l, productoId: producto.id, descripcion: producto.nombre });
      } else {
        lineas.push({ ...l, productoId: null });
      }
    }

    // 3, 5–9: reglas puras.
    const calculo = validarYCalcularVenta(lineas, descuento, pagosCrudos);
    if (!calculo.ok) {
      return reply.code(422).send({ error: calculo.codigo, detalle: calculo.detalle });
    }

    const clienteNombre =
      typeof req.body?.clienteNombre === 'string' && req.body.clienteNombre.trim() !== ''
        ? req.body.clienteNombre.trim()
        : null;

    // E4 HC2: clienteId opcional; si viene, debe existir y estar activo.
    let clienteId: string | null = null;
    if (req.body?.clienteId != null && req.body.clienteId !== '') {
      if (typeof req.body.clienteId !== 'string') {
        return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: 'clienteId: string' });
      }
      const cliente = await prisma.cliente.findUnique({
        where: { id: req.body.clienteId },
        select: { id: true, activo: true },
      });
      if (!cliente || !cliente.activo) {
        return reply.code(422).send({ error: 'CLIENTE_NO_ENCONTRADO', detalle: req.body.clienteId });
      }
      clienteId = cliente.id;
    }

    // E4 §6.2/§6.3: total pagado con monedero y total de líneas de carga de saldo.
    const montoMonedero = pagosCrudos
      .filter((p) => p.medio === 'monedero')
      .reduce((s, p) => s + p.monto, 0);
    const montoCarga = lineas.reduce((s, l, i) => {
      const producto = l.productoId ? productos.get(l.productoId) : undefined;
      return producto?.sku === SKU_CARGA ? s + calculo.totalesLinea[i]! : s;
    }, 0);
    if (montoMonedero > 0 && !clienteId) {
      // Criterio 10: sin cliente identificado no hay saldo del que descontar.
      return reply.code(422).send({ error: 'CLIENTE_REQUERIDO', detalle: 'Un pago con monedero exige clienteId (§6.2)' });
    }
    if (montoCarga > 0 && !clienteId) {
      return reply.code(422).send({ error: 'CLIENTE_REQUERIDO', detalle: 'Una carga de saldo exige clienteId (§6.3)' });
    }
    if (montoCarga > 0 && montoMonedero > 0) {
      return reply.code(422).send({ error: 'MEDIO_PAGO_INVALIDO', detalle: 'Una carga de saldo nunca se paga con monedero (§6.3)' });
    }

    // E2 §6.3: líneas que descuentan stock (productos con controlaStock), agregadas por producto
    // y ORDENADAS por id: es el orden en que se toman los candados (§6.1).
    const porProducto = new Map<string, { cantidad: number; descripcion: string }>();
    for (const l of lineas) {
      const producto = l.productoId ? productos.get(l.productoId) : undefined;
      if (!producto?.controlaStock) continue;
      const previo = porProducto.get(producto.id);
      porProducto.set(producto.id, { cantidad: (previo?.cantidad ?? 0) + l.cantidad, descripcion: producto.nombre });
    }
    const lineasStock = [...porProducto.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    let ubicacionVentaActual: { id: string; codigo: string } | null = null;
    const reservadosForzados: { productoId: string; canalId: string; stockCanal: number | null; stockCanalEn: Date | null; stockPropio: number }[] = [];
    if (lineasStock.length > 0) {
      try {
        ubicacionVentaActual = await ubicacionVenta(prisma);
      } catch (e) {
        if (e instanceof ErrorStock) return reply.code(e.status).send(e.cuerpo);
        throw e;
      }
      // §6.9 prioridad entre canales: si el espejo del canal dice que la web ya vendió y cobró la
      // última unidad, el cobro se detiene; solo un encargado con nota puede seguir.
      const ctx = await contextoReserva(prisma, lineasStock.map(([id]) => id), ubicacionVentaActual.id);
      const forzar = req.body?.forzarReservado as { nota?: unknown } | undefined;
      const notaForzar = forzar && typeof forzar.nota === 'string' ? forzar.nota.trim() : '';
      for (const [productoId] of lineasStock) {
        const c = ctx.get(productoId)!;
        const nivel = avisoWeb({ controlaStock: true, stockPropioVenta: c.stockPropioVenta, canales: c.canales });
        if (nivel !== 'reservado') continue;
        const canal = c.canales.find((k) => k.manejaStockCanal && k.stockCanal !== null && k.stockCanal <= 0)!;
        const detalle = { productoId, canalId: canal.canalId, stockCanal: canal.stockCanal, stockCanalEn: canal.stockCanalEn, stockPropio: c.stockPropioVenta };
        if (notaForzar && rolAlcanza(req.user.rol, 'encargado')) {
          reservadosForzados.push(detalle);
          continue;
        }
        return reply.code(409).send({
          error: 'RESERVADO_WEB',
          detalle: 'Este producto figura agotado en la tienda online: probablemente lo compró y pagó un cliente web, y ese pedido tiene prioridad (03 §6.9).',
          ...detalle,
          descripcion: porProducto.get(productoId)!.descripcion,
        });
      }
    }

    try {
      const venta = await prisma.$transaction(async (tx) => {
        // E4 §6.2: cerrojo sobre la fila Cliente PRIMERO (determinista incluso
        // con cero movimientos), Correlativo SIEMPRE al final — orden fijo
        // obligatorio para no interbloquear dos ventas concurrentes.
        if (montoMonedero > 0) {
          const filasCliente = await tx.$queryRaw<
            { id: string; permiteCredito: number; limiteCredito: number }[]
          >`SELECT id, permiteCredito, limiteCredito FROM Cliente WHERE id = ${clienteId} FOR UPDATE`;
          const c = filasCliente[0];
          if (!c) throw new ErrorMonedero({ error: 'CLIENTE_NO_ENCONTRADO', detalle: clienteId });
          const agregado = await tx.movimientoMonedero.aggregate({
            where: { clienteId: clienteId! },
            _sum: { monto: true },
          });
          const saldo = agregado._sum.monto ?? 0;
          const errorTope = validarPagoMonedero({
            monto: montoMonedero,
            saldo,
            permiteCredito: Boolean(c.permiteCredito),
            limiteCredito: Number(c.limiteCredito),
          });
          if (errorTope) {
            const { codigo, ...resto } = errorTope;
            throw new ErrorMonedero({ error: codigo, ...resto });
          }
        }

        // E2 §6.1: candados de StockActual en orden ascendente, ANTES del Correlativo.
        for (const [productoId] of lineasStock) {
          await bloquearStock(tx, productoId, ubicacionVentaActual!.id);
        }

        // 10. Folio con SELECT ... FOR UPDATE sobre Correlativo (§5.5).
        const anioActual = new Date().getFullYear();
        const filas = await tx.$queryRaw<{ ultimo: number; anio: number }[]>`
          SELECT ultimo, anio FROM Correlativo WHERE clave = 'venta' FOR UPDATE`;
        let ultimo: number;
        let anio: number;
        if (filas.length === 0) {
          await tx.correlativo.create({ data: { clave: 'venta', anio: anioActual, ultimo: 0 } });
          ultimo = 0;
          anio = anioActual;
        } else {
          ultimo = Number(filas[0]!.ultimo);
          anio = Number(filas[0]!.anio);
        }
        if (anio !== anioActual) {
          ultimo = 0; // el folio reinicia cada año
          anio = anioActual;
        }
        const nuevoUltimo = ultimo + 1;
        await tx.$executeRaw`
          UPDATE Correlativo SET ultimo = ${nuevoUltimo}, anio = ${anio} WHERE clave = 'venta'`;
        const folio = `V-${anio}-${String(nuevoUltimo).padStart(5, '0')}`;

        const creada = await tx.venta.create({
          data: {
            folio,
            idempotencyKey,
            turnoCajaId: turno.id,
            usuarioId: req.user.sub,
            clienteId,
            clienteNombre,
            subtotal: calculo.subtotal,
            descuento,
            total: calculo.total,
            lineas: {
              create: lineas.map((l, i) => ({
                productoId: l.productoId,
                descripcion: (l.descripcion ?? '').trim(),
                cantidad: l.cantidad,
                precioUnitario: l.precioUnitario,
                descuentoLinea: l.descuentoLinea ?? 0,
                totalLinea: calculo.totalesLinea[i]!,
              })),
            },
            pagos: {
              create: pagosCrudos.map((p) => ({
                medio: p.medio,
                monto: p.monto,
                montoRecibido: p.medio === 'efectivo' ? (p.montoRecibido ?? null) : null,
                referencia: p.referencia ?? null,
              })),
            },
          },
          include: incluirDetalle,
        });

        // E2 §6.3: descuento de stock (motivo venta). Nunca bloquea: si queda negativo, advierte (M2).
        for (const [productoId, { cantidad, descripcion }] of lineasStock) {
          const r = await registrarMovimiento(tx, {
            productoId,
            ubicacionId: ubicacionVentaActual!.id,
            cantidad: -cantidad,
            motivo: 'venta',
            referenciaTipo: 'venta',
            referenciaId: creada.id,
            usuarioId: req.user.sub,
          });
          if (r.quedaNegativo) {
            advertencias.push({ tipo: 'STOCK_NEGATIVO', productoId, descripcion, ubicacion: ubicacionVentaActual!.codigo, cantidadNueva: r.cantidadNueva });
          }
        }
        if (reservadosForzados.length > 0) {
          const forzar = req.body?.forzarReservado as { nota: string };
          await tx.auditoria.create({
            data: {
              usuarioId: req.user.sub,
              entidad: 'venta',
              entidadId: creada.id,
              accion: 'vender_reservado',
              valorNuevo: { folio, nota: String(forzar.nota).trim(), productos: reservadosForzados } as unknown as Prisma.InputJsonValue,
            },
          });
        }

        // §6.2 paso 4: el consumo de saldo, negativo, referenciando la venta.
        if (montoMonedero > 0) {
          await tx.movimientoMonedero.create({
            data: {
              clienteId: clienteId!,
              monto: -montoMonedero,
              motivo: 'consumo',
              referenciaTipo: 'venta',
              referenciaId: creada.id,
              usuarioId: req.user.sub,
            },
          });
        }
        // §6.3: la venta de SRV-000001 genera la carga positiva y queda en
        // Auditoria con usuario, monto y motivo (criterio 11).
        if (montoCarga > 0) {
          const movimiento = await tx.movimientoMonedero.create({
            data: {
              clienteId: clienteId!,
              monto: montoCarga,
              motivo: 'carga',
              referenciaTipo: 'venta',
              referenciaId: creada.id,
              usuarioId: req.user.sub,
            },
          });
          await tx.auditoria.create({
            data: {
              usuarioId: req.user.sub,
              entidad: 'cliente',
              entidadId: clienteId!,
              accion: 'crear',
              valorNuevo: { movimientoId: movimiento.id, motivo: 'carga', monto: montoCarga, folio },
            },
          });
        }

        // La advertencia de precio se registra en Auditoria (§5.4).
        if (advertencias.length > 0) {
          await tx.auditoria.create({
            data: {
              usuarioId: req.user.sub,
              entidad: 'venta',
              entidadId: creada.id,
              accion: 'crear',
              valorNuevo: { folio, advertencias },
            },
          });
        }
        return creada;
      });
      return reply.code(201).send({ venta, advertencias });
    } catch (e) {
      // Saldo insuficiente o tope de crédito: la transacción entera se abortó (§6.2 paso 5).
      if (e instanceof ErrorMonedero) return reply.code(422).send(e.cuerpo);
      // R-014: sin stock suficiente la venta entera se aborta; se devuelve el producto afectado.
      if (e instanceof ErrorStock) {
        const productoId = typeof e.cuerpo.productoId === 'string' ? e.cuerpo.productoId : null;
        return reply.code(e.status).send({ ...e.cuerpo, descripcion: productoId ? porProducto.get(productoId)?.descripcion ?? null : null });
      }
      // Carrera sobre idempotencyKey: dos reintentos simultáneos. Devolver la original.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const original = await prisma.venta.findUnique({
          where: { idempotencyKey },
          include: incluirDetalle,
        });
        if (original) return reply.code(200).send({ venta: original, advertencias: [], repetida: true });
      }
      throw e;
    }
  });

  app.get<{
    Querystring: { turnoCajaId?: string; desde?: string; hasta?: string; estado?: string; pagina?: string };
  }>('/ventas', vendedor, async (req, reply) => {
    const esEncargado = rolAlcanza(req.user.rol as Rol, 'encargado');
    const where: Prisma.VentaWhereInput = {};
    if (!esEncargado) {
      // Un vendedor SOLO consulta su turno abierto (§5.3).
      const turno = await prisma.turnoCaja.findFirst({
        where: { usuarioId: req.user.sub, estado: 'abierto' },
      });
      if (!req.query.turnoCajaId || !turno || req.query.turnoCajaId !== turno.id) {
        return reply.code(403).send({
          error: 'TURNO_REQUERIDO',
          detalle: 'Un vendedor solo consulta ventas de su propio turno abierto (?turnoCajaId=)',
        });
      }
      where.turnoCajaId = turno.id;
    } else {
      if (req.query.turnoCajaId) where.turnoCajaId = req.query.turnoCajaId;
      if (req.query.estado === 'completada' || req.query.estado === 'anulada') {
        where.estado = req.query.estado;
      }
      if (req.query.desde || req.query.hasta) {
        where.creadoEn = {
          ...(req.query.desde ? { gte: new Date(req.query.desde) } : {}),
          ...(req.query.hasta ? { lte: new Date(req.query.hasta) } : {}),
        };
      }
    }
    const pagina = Math.max(1, Number(req.query.pagina ?? 1) || 1);
    const porPagina = 100;
    const [total, ventas] = await Promise.all([
      prisma.venta.count({ where }),
      prisma.venta.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
        include: incluirDetalle,
      }),
    ]);
    return { total, pagina, porPagina, ventas };
  });

  app.get<{ Params: { id: string } }>('/ventas/:id', vendedor, async (req, reply) => {
    const venta = await prisma.venta.findUnique({
      where: { id: req.params.id },
      include: { ...incluirDetalle, turnoCaja: true },
    });
    if (!venta) return reply.code(404).send({ error: 'VENTA_NO_ENCONTRADA' });
    if (!rolAlcanza(req.user.rol as Rol, 'encargado')) {
      const esDeSuTurnoAbierto =
        venta.turnoCaja.usuarioId === req.user.sub && venta.turnoCaja.estado === 'abierto';
      if (!esDeSuTurnoAbierto) return reply.code(403).send({ error: 'VENTA_AJENA' });
    }
    return venta;
  });

  app.post<{ Params: { id: string }; Body: { motivo?: unknown } }>(
    '/ventas/:id/anular',
    encargado,
    async (req, reply) => {
      const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
      if (motivo === '') {
        return reply.code(422).send({ error: 'MOTIVO_REQUERIDO' });
      }
      const venta = await prisma.venta.findUnique({
        where: { id: req.params.id },
        include: {
          turnoCaja: true,
          // E4 §6.4 (HC3): pagos monedero → devolución; líneas SRV-000001 → reverso.
          pagos: true,
          lineas: { include: { producto: { select: { sku: true } } } },
        },
      });
      if (!venta) return reply.code(404).send({ error: 'VENTA_NO_ENCONTRADA' });
      if (venta.estado === 'anulada') {
        return reply.code(409).send({ error: 'VENTA_YA_ANULADA' });
      }
      // E2 §6.6: con devoluciones, el camino es devolver el resto, no anular.
      const conDevoluciones = await prisma.devolucion.count({ where: { ventaId: venta.id } });
      if (conDevoluciones > 0) {
        return reply.code(409).send({ error: 'VENTA_CON_DEVOLUCIONES', detalle: 'Esta venta ya tiene devoluciones: devuelve el resto en vez de anular' });
      }
      // Anular una venta de un turno cerrado invalidaría un arqueo ya persistido (§5.3).
      if (venta.turnoCaja.estado !== 'abierto') {
        return reply.code(409).send({
          error: 'TURNO_CERRADO',
          detalle: 'El turno ya cerró: corresponde una devolución (E2), no una anulación',
        });
      }
      const anulada = await prisma.$transaction(async (tx) => {
        const v = await tx.venta.update({
          where: { id: venta.id },
          data: {
            estado: 'anulada',
            motivoAnulacion: motivo,
            anuladaEn: new Date(),
            anuladaPorId: req.user.sub,
          },
          include: incluirDetalle,
        });
        // E4 §6.4: por cada pago monedero, un movimiento POSITIVO de devolución.
        // El consumo original no se toca (M4).
        if (venta.clienteId) {
          for (const pago of venta.pagos.filter((p) => p.medio === 'monedero')) {
            await tx.movimientoMonedero.create({
              data: {
                clienteId: venta.clienteId,
                monto: pago.monto,
                motivo: 'devolucion',
                referenciaTipo: 'venta',
                referenciaId: venta.id,
                nota: `Anulación de ${venta.folio}: ${motivo}`,
                usuarioId: req.user.sub,
              },
            });
          }
          // Caso simétrico: anular una venta de carga genera el reverso NEGATIVO
          // — si no, el cliente se llevaría el dinero Y el saldo (criterio 16).
          const montoCargaAnulada = venta.lineas
            .filter((l) => l.producto?.sku === SKU_CARGA)
            .reduce((s, l) => s + l.totalLinea, 0);
          if (montoCargaAnulada > 0) {
            const reverso = await tx.movimientoMonedero.create({
              data: {
                clienteId: venta.clienteId,
                monto: -montoCargaAnulada,
                motivo: 'reverso_carga',
                referenciaTipo: 'venta',
                referenciaId: venta.id,
                nota: `Anulación de ${venta.folio}: ${motivo}`,
                usuarioId: req.user.sub,
              },
            });
            // Criterio 11: todo reverso queda en Auditoria con usuario, monto y nota.
            await tx.auditoria.create({
              data: {
                usuarioId: req.user.sub,
                entidad: 'cliente',
                entidadId: venta.clienteId,
                accion: 'crear',
                valorNuevo: {
                  movimientoId: reverso.id,
                  motivo: 'reverso_carga',
                  monto: -montoCargaAnulada,
                  folio: venta.folio,
                  nota: motivo,
                },
              },
            });
          }
        }
        // E2 §6.3: por cada descuento de esta venta, un movimiento POSITIVO `devolucion`.
        // El original no se toca (P9).
        const descuentos = await tx.movimientoStock.findMany({
          where: { referenciaTipo: 'venta', referenciaId: venta.id, motivo: 'venta' },
          orderBy: [{ productoId: 'asc' }, { ubicacionId: 'asc' }],
        });
        for (const d of descuentos) {
          await registrarMovimiento(tx, {
            productoId: d.productoId,
            ubicacionId: d.ubicacionId,
            cantidad: -d.cantidad,
            motivo: 'devolucion',
            referenciaTipo: 'venta',
            referenciaId: venta.id,
            nota: `Anulación de ${venta.folio}: ${motivo}`,
            usuarioId: req.user.sub,
          });
        }
        await tx.auditoria.create({
          data: {
            usuarioId: req.user.sub,
            entidad: 'venta',
            entidadId: venta.id,
            accion: 'anular',
            valorAnterior: { estado: 'completada' },
            valorNuevo: { estado: 'anulada', motivo, stockRepuesto: descuentos.length },
          },
        });
        return v;
      });
      return anulada;
    },
  );
}
