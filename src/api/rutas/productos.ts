// Catálogo y búsqueda F3/F4 — 02-SDD §5.2. Fusión de duplicados F11 (§6.6).
// GET requiere vendedor; alta, edición y fusión, encargado.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma, TipoProducto } from '@prisma/client';
import { PREFIJO_POR_TIPO } from '@onplay/dominio';
import { prisma } from '../db.js';
import { adjuntarStock } from '../stock/libro.js';
import { idsSubarbol } from '../categorias.js';
import { ReservadorSku } from '../sync/importador.js';
import { publicarProductoADemanda } from '../sync/push.js';

const TIPOS_VALIDOS = Object.keys(PREFIJO_POR_TIPO);

/** Campos que devuelve la búsqueda del mostrador. */
const SELECT_BUSQUEDA = {
  id: true,
  sku: true,
  nombre: true,
  tipo: true,
  juego: true,
  precioVenta: true,
  imagenUrl: true,
  codigoBarras: true,
  cardNumber: true,
  categoriaId: true,
} satisfies Prisma.ProductoSelect;

/** Bitácora humana (§4.1): toda alta/edición del catálogo deja rastro. */
async function registrarAuditoria(
  usuarioId: string,
  entidadId: string,
  accion: 'crear' | 'editar' | 'cambiar_precio' | 'ajustar_stock',
  valorAnterior: Prisma.InputJsonValue | undefined,
  valorNuevo: Prisma.InputJsonValue,
) {
  await prisma.auditoria.create({
    data: { usuarioId, entidad: 'producto', entidadId, accion, valorAnterior, valorNuevo },
  });
}

export default async function rutasProductos(app: FastifyInstance) {
  const vendedor = { preHandler: app.requiereRol('vendedor') };
  const encargado = { preHandler: app.requiereRol('encargado') };

  // ---------- GET /productos — listado paginado por cursor. NUNCA sin paginar (§5.2). ----------
  app.get<{
    Querystring: {
      q?: string;
      tipo?: string;
      juego?: string;
      categoriaId?: string;
      activo?: string;
      posibleDuplicado?: string;
      limit?: string;
      cursor?: string;
      /** R-009: paginación por número de página (misma convención que GET /ventas). */
      pagina?: string;
    };
  }>('/productos', vendedor, async (req) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    // R-012: la categoría filtra por SUBÁRBOL (elegir «Cartas» incluye Magic, One Piece…).
    const categoriaIds = req.query.categoriaId ? await idsSubarbol(req.query.categoriaId) : null;
    const where: Prisma.ProductoWhereInput = {
      ...(req.query.q ? { nombre: { contains: req.query.q } } : {}),
      ...(req.query.tipo && TIPOS_VALIDOS.includes(req.query.tipo)
        ? { tipo: req.query.tipo as TipoProducto }
        : {}),
      ...(req.query.juego ? { juego: req.query.juego } : {}),
      ...(categoriaIds ? { categoriaId: { in: categoriaIds } } : {}),
      ...(req.query.activo !== undefined ? { activo: req.query.activo === 'true' } : {}),
      ...(req.query.posibleDuplicado !== undefined
        ? { posibleDuplicado: req.query.posibleDuplicado === 'true' }
        : {}),
    };
    // `total` resuelve 05-SDD §14 H5: un COUNT sobre ~3.000 filas es barato.
    const total = await prisma.producto.count({ where });

    if (req.query.pagina !== undefined) {
      const pagina = Math.max(1, Number(req.query.pagina) || 1);
      const productos = await prisma.producto.findMany({
        where,
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
        skip: (pagina - 1) * limit,
        take: limit,
      });
      return { productos: await adjuntarStock(prisma, productos), total, pagina, porPagina: limit, siguienteCursor: null };
    }

    const productos = await prisma.producto.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit + 1, // uno extra para saber si hay más
      ...(req.query.cursor ? { cursor: { id: req.query.cursor }, skip: 1 } : {}),
    });
    const hayMas = productos.length > limit;
    if (hayMas) productos.pop();
    return { productos: await adjuntarStock(prisma, productos), total, siguienteCursor: hayMas ? productos[productos.length - 1]!.id : null };
  });

  // ---------- GET /productos/juegos — valores reales de `juego` (string libre, 02 §4.1) ----------
  // R-012: el sellado vive en la categoría raíz «Sellado» y su juego va en `juego`; el
  // backoffice necesita filtrar por juego para encontrar «sellado de Magic».
  app.get('/productos/juegos', vendedor, async () => {
    const filas = await prisma.producto.groupBy({
      by: ['juego'],
      where: { juego: { not: null }, activo: true },
      _count: { _all: true },
      orderBy: { _count: { juego: 'desc' } },
    });
    return { juegos: filas.map((f) => ({ juego: f.juego!, productos: f._count._all })) };
  });

  // ---------- GET /productos/buscar — mostrador, máx 20 por relevancia, p95 < 200 ms ----------
  app.get<{ Querystring: { q?: string } }>('/productos/buscar', vendedor, async (req) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return { resultados: [] };

    // 1) Identificadores exactos primero: código de barras, card number, SKU maestro.
    const exactos = await prisma.producto.findMany({
      where: { activo: true, OR: [{ codigoBarras: q }, { cardNumber: q }, { sku: q }] },
      select: SELECT_BUSQUEDA,
      take: 20,
    });

    // 2) Fulltext sobre nombre (índice §4.1), en modo booleano con prefijos.
    const terminos = q.split(/\s+/).filter(Boolean);
    const sanitizados = terminos
      .map((t) => t.replace(/[+\-<>()~*"@]/g, ''))
      .filter((t) => t.length >= 2);
    let porNombre: Awaited<typeof exactos> = [];
    if (exactos.length < 20 && sanitizados.length > 0) {
      const booleana = sanitizados.map((t) => `+${t}*`).join(' ');
      try {
        porNombre = await prisma.producto.findMany({
          where: { activo: true, nombre: { search: booleana } },
          orderBy: { _relevance: { fields: ['nombre'], search: booleana, sort: 'desc' } },
          select: SELECT_BUSQUEDA,
          take: 20,
        });
      } catch {
        porNombre = []; // sintaxis fulltext inválida → cae al plan B
      }
    }

    // 3) Plan B: contains término a término (tokens cortos o con guiones, ej. "EB04-001",
    //    que el tokenizador fulltext parte o descarta por longitud mínima).
    if (exactos.length + porNombre.length === 0) {
      porNombre = await prisma.producto.findMany({
        where: {
          activo: true,
          AND: terminos.map((t) => ({
            OR: [
              { nombre: { contains: t } },
              { cardNumber: { contains: t } },
              { sku: { contains: t } },
            ],
          })),
        },
        select: SELECT_BUSQUEDA,
        take: 20,
      });
    }

    const vistos = new Set<string>();
    const resultados = [...exactos, ...porNombre]
      .filter((p) => (vistos.has(p.id) ? false : (vistos.add(p.id), true)))
      .slice(0, 20);
    return { resultados: await adjuntarStock(prisma, resultados) }; // E2 §7.3
  });

  // ---------- GET /productos/catalogo-offline — caché de la PWA (F10), gzip vía @fastify/compress ----------
  app.get<{ Querystring: { desde?: string } }>(
    '/productos/catalogo-offline',
    vendedor,
    async (req, reply) => {
      let desde: Date | null = null;
      if (req.query.desde !== undefined) {
        desde = new Date(req.query.desde);
        if (Number.isNaN(desde.getTime())) {
          return reply.code(400).send({ error: 'DESDE_INVALIDO', detalle: 'se espera fecha ISO' });
        }
      }
      const generadoEn = new Date().toISOString();
      // E2 R-014: el delta tambien trae productos cuyo STOCK (propio o espejo del canal) cambio
      // desde la marca, aunque la fila Producto no se haya tocado: el tope del carrito depende de eso.
      const productos = await prisma.producto.findMany({
        where: desde
          ? {
              OR: [
                { actualizadoEn: { gt: desde } },
                { stock: { some: { actualizadoEn: { gt: desde } } } },
                { canales: { some: { stockCanalEn: { gt: desde } } } },
              ],
            }
          : {},
        // Campos de §5.2 (payload deliberadamente mínimo) + imagenUrl (R-006: miniaturas
        // en la lista de accesos rápidos; es solo la URL, la imagen se carga bajo demanda).
        select: {
          id: true,
          sku: true,
          nombre: true,
          precioVenta: true,
          categoriaId: true,
          codigoBarras: true,
          cardNumber: true,
          activo: true,
          imagenUrl: true,
          controlaStock: true, // E2 §7.3
        },
        orderBy: { id: 'asc' },
      });
      // E2 §7.3: stockTotal/stockVenta/stockCanalMin/estadoStock en cada fila (esquema 3 del caché).
      return { generadoEn, total: productos.length, productos: await adjuntarStock(prisma, productos) };
    },
  );

  // ---------- GET /productos/:id — detalle con canales[] ----------
  app.get<{ Params: { id: string } }>('/productos/:id', vendedor, async (req, reply) => {
    const producto = await prisma.producto.findUnique({
      where: { id: req.params.id },
      include: { categoria: true, canales: true },
    });
    if (!producto) return reply.code(404).send({ error: 'PRODUCTO_NO_ENCONTRADO' });
    return producto;
  });

  // ---------- POST /productos — alta manual (F3), rol encargado ----------
  interface CuerpoProducto {
    nombre?: string;
    tipo?: string;
    juego?: string | null;
    categoriaId?: string | null;
    precioVenta?: number;
    controlaStock?: boolean;
    activo?: boolean;
    imagenUrl?: string | null;
    codigoBarras?: string | null;
    cardNumber?: string | null;
    atributos?: Record<string, unknown> | null;
    sku?: string;
  }

  app.post<{ Body: CuerpoProducto }>('/productos', encargado, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.nombre?.trim()) {
      return reply.code(422).send({ error: 'NOMBRE_REQUERIDO' });
    }
    if (!b.tipo || !TIPOS_VALIDOS.includes(b.tipo)) {
      return reply
        .code(422)
        .send({ error: 'TIPO_INVALIDO', detalle: `tipo debe ser uno de: ${TIPOS_VALIDOS.join(', ')}` });
    }
    if (!Number.isInteger(b.precioVenta) || (b.precioVenta as number) < 0) {
      return reply.code(422).send({ error: 'PRECIO_INVALIDO', detalle: 'precioVenta: CLP entero >= 0' });
    }
    const tipo = b.tipo as TipoProducto;

    // SKU: explícito (validando unicidad) o correlativo por tipo (§6.4 regla 3).
    let sku = b.sku?.trim();
    if (sku) {
      const ocupado = await prisma.producto.findUnique({ where: { sku }, select: { id: true } });
      if (ocupado) return reply.code(409).send({ error: 'SKU_DUPLICADO', detalle: sku });
    } else {
      sku = await new ReservadorSku(false).reservar(tipo);
    }

    const producto = await prisma.producto.create({
      data: {
        sku,
        nombre: b.nombre.trim(),
        tipo,
        juego: b.juego ?? null,
        categoriaId: b.categoriaId ?? null,
        precioVenta: b.precioVenta as number,
        controlaStock: b.controlaStock ?? false, // Principio P4
        activo: b.activo ?? true,
        imagenUrl: b.imagenUrl ?? null,
        codigoBarras: b.codigoBarras ?? null,
        cardNumber: b.cardNumber ?? null,
        atributos: (b.atributos as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
    await registrarAuditoria(req.user.sub, producto.id, 'crear', undefined, {
      sku: producto.sku,
      nombre: producto.nombre,
      tipo: producto.tipo,
      precioVenta: producto.precioVenta,
    });
    return reply.code(201).send(producto);
  });

  // ---------- PATCH /productos/:id — edición (F3), rol encargado ----------
  const CAMPOS_EDITABLES = [
    'nombre', 'tipo', 'juego', 'categoriaId', 'precioVenta', 'controlaStock', 'stockMinimo',
    'activo', 'posibleDuplicado', 'imagenUrl', 'codigoBarras', 'cardNumber', 'atributos',
  ] as const;

  app.patch<{ Params: { id: string }; Body: CuerpoProducto & { posibleDuplicado?: boolean } }>(
    '/productos/:id',
    encargado,
    async (req, reply) => {
      const actual = await prisma.producto.findUnique({ where: { id: req.params.id } });
      if (!actual) return reply.code(404).send({ error: 'PRODUCTO_NO_ENCONTRADO' });

      const b = (req.body ?? {}) as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      for (const campo of CAMPOS_EDITABLES) {
        if (campo in b) data[campo] = b[campo];
      }
      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ error: 'SIN_CAMBIOS' });
      }
      if ('nombre' in data && !String(data.nombre ?? '').trim()) {
        return reply.code(422).send({ error: 'NOMBRE_REQUERIDO' });
      }
      if ('tipo' in data && !TIPOS_VALIDOS.includes(String(data.tipo))) {
        return reply.code(422).send({ error: 'TIPO_INVALIDO' });
      }
      if (
        'precioVenta' in data &&
        (!Number.isInteger(data.precioVenta) || (data.precioVenta as number) < 0)
      ) {
        return reply.code(422).send({ error: 'PRECIO_INVALIDO' });
      }
      // E2 §5.2 / §7.1: stockMinimo entero >= 0; apagar controlaStock exige nota (M5).
      if ('stockMinimo' in data && (!Number.isInteger(data.stockMinimo) || (data.stockMinimo as number) < 0)) {
        return reply.code(422).send({ error: 'STOCK_MINIMO_INVALIDO', detalle: 'entero >= 0' });
      }
      if ('controlaStock' in data && typeof data.controlaStock !== 'boolean') {
        return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: 'controlaStock: boolean' });
      }
      const apagaControl = data.controlaStock === false && actual.controlaStock;
      const notaControl = typeof b.nota === 'string' ? b.nota.trim() : '';
      if (apagaControl && !notaControl) {
        return reply.code(422).send({ error: 'NOTA_REQUERIDA', detalle: 'Apagar el control de stock exige una nota (M5)' });
      }

      const producto = await prisma.producto.update({
        where: { id: actual.id },
        data: data as Prisma.ProductoUpdateInput,
      });

      // §5.2: todo cambio de precioVenta queda en Auditoria con valor anterior y nuevo.
      const cambios = Object.fromEntries(
        Object.keys(data).filter((k) => k !== 'atributos').map((k) => [
          k,
          (producto as unknown as Record<string, unknown>)[k] ?? null,
        ]),
      );
      const anteriores = Object.fromEntries(
        Object.keys(cambios).map((k) => [k, (actual as unknown as Record<string, unknown>)[k] ?? null]),
      );
      const cambioPrecio =
        'precioVenta' in data && producto.precioVenta !== actual.precioVenta;
      await registrarAuditoria(
        req.user.sub,
        producto.id,
        cambioPrecio ? 'cambiar_precio' : apagaControl ? 'ajustar_stock' : 'editar',
        anteriores as Prisma.InputJsonValue,
        (apagaControl ? { ...cambios, nota: notaControl } : cambios) as Prisma.InputJsonValue,
      );
      // E3 G9: publicación a demanda al guardar un precio, sin bloquear la respuesta.
      // Solo actúa en canales con pushPrecio encendido; el cron de 15 min es la red de seguridad.
      if (cambioPrecio) {
        void publicarProductoADemanda(producto.id, req.user.sub).then(
          (r) => req.log.info({ productoId: producto.id, ...r }, 'publicación a demanda (E3 G9)'),
          (e) => req.log.error(e, 'publicación a demanda falló'),
        );
      }
      return producto;
    },
  );

  // ---------- POST /productos/:id/publicar — E3 G9 (06 §6.1), rol encargado ----------
  // Publica el precio del producto en sus canales con pushPrecio encendido. Es la misma
  // corrida de precios acotada a un producto: pasa por el candado y el cerrojo.
  app.post<{ Params: { id: string } }>('/productos/:id/publicar', encargado, async (req, reply) => {
    const producto = await prisma.producto.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!producto) return reply.code(404).send({ error: 'PRODUCTO_NO_ENCONTRADO' });
    const canales = await publicarProductoADemanda(producto.id, req.user.sub);
    return { productoId: producto.id, canales };
  });

  // ---------- POST /productos/:id/fusionar — F11 (§6.6), rol encargado ----------
  // El :id es el SOBREVIVIENTE. Nunca automático: lo confirma un humano en V9.
  app.post<{ Params: { id: string }; Body: { productoAbsorbidoId?: string } }>(
    '/productos/:id/fusionar',
    encargado,
    async (req, reply) => {
      const absorbidoId = req.body?.productoAbsorbidoId;
      if (typeof absorbidoId !== 'string' || !absorbidoId) {
        return reply
          .code(422)
          .send({ error: 'CUERPO_INVALIDO', detalle: 'se espera { productoAbsorbidoId }' });
      }
      if (absorbidoId === req.params.id) {
        return reply.code(422).send({ error: 'MISMO_PRODUCTO' });
      }
      const [sobreviviente, absorbido] = await Promise.all([
        prisma.producto.findUnique({ where: { id: req.params.id }, include: { canales: true } }),
        prisma.producto.findUnique({ where: { id: absorbidoId }, include: { canales: true } }),
      ]);
      if (!sobreviviente || !absorbido) {
        return reply.code(404).send({ error: 'PRODUCTO_NO_ENCONTRADO' });
      }

      const conflictos: { canalId: string; conservado: string; eliminado: string }[] = [];
      await prisma.$transaction(async (tx) => {
        for (const ca of absorbido.canales) {
          const propio = sobreviviente.canales.find((c) => c.canalId === ca.canalId);
          if (propio) {
            // §6.6: ambos tienen fila del mismo canal → sobrevive la del
            // sincronizadoEn más reciente; la otra se elimina y queda en Auditoria.
            const ganaAbsorbido =
              (ca.sincronizadoEn?.getTime() ?? 0) > (propio.sincronizadoEn?.getTime() ?? 0);
            const pierde = ganaAbsorbido ? propio : ca;
            await tx.productoCanal.delete({ where: { id: pierde.id } });
            if (ganaAbsorbido) {
              await tx.productoCanal.update({
                where: { id: ca.id },
                data: { productoId: sobreviviente.id },
              });
            }
            conflictos.push({
              canalId: ca.canalId,
              conservado: ganaAbsorbido ? ca.id : propio.id,
              eliminado: pierde.id,
            });
          } else {
            await tx.productoCanal.update({
              where: { id: ca.id },
              data: { productoId: sobreviviente.id },
            });
          }
        }
        // El absorbido queda inactivo; NO se borra (Principio P9).
        await tx.producto.update({
          where: { id: absorbido.id },
          data: { activo: false, posibleDuplicado: false },
        });
        await tx.producto.update({
          where: { id: sobreviviente.id },
          data: { posibleDuplicado: false },
        });
        await tx.auditoria.create({
          data: {
            usuarioId: req.user.sub,
            entidad: 'producto',
            entidadId: sobreviviente.id,
            accion: 'editar',
            valorAnterior: { posibleDuplicado: sobreviviente.posibleDuplicado },
            valorNuevo: {
              fusion: {
                absorbidoId: absorbido.id,
                absorbidoSku: absorbido.sku,
                canalesReasignados: absorbido.canales.length - conflictos.length,
                conflictos,
              },
            },
          },
        });
        await tx.auditoria.create({
          data: {
            usuarioId: req.user.sub,
            entidad: 'producto',
            entidadId: absorbido.id,
            accion: 'editar',
            valorAnterior: { activo: absorbido.activo },
            valorNuevo: { activo: false, absorbidoPor: sobreviviente.id },
          },
        });
      });

      return prisma.producto.findUnique({
        where: { id: sobreviviente.id },
        include: { canales: true },
      });
    },
  );

  // ---------- GET /categorias — árbol completo (chico, el cliente lo cachea) ----------
  app.get('/categorias', vendedor, async () => {
    const planas = await prisma.categoria.findMany({ orderBy: { nombre: 'asc' } });
    interface Nodo {
      id: string;
      nombre: string;
      slug: string;
      hijos: Nodo[];
    }
    const nodos = new Map<string, Nodo>(
      planas.map((c) => [c.id, { id: c.id, nombre: c.nombre, slug: c.slug, hijos: [] }]),
    );
    const raices: Nodo[] = [];
    for (const c of planas) {
      const nodo = nodos.get(c.id)!;
      const padre = c.padreId ? nodos.get(c.padreId) : undefined;
      if (padre) padre.hijos.push(nodo);
      else raices.push(nodo);
    }
    return { categorias: raices };
  });

  // ---------- GET /auditoria — rastro de cambios (§8), rol encargado ----------
  app.get<{
    Querystring: {
      entidad?: string;
      entidadId?: string;
      usuarioId?: string;
      accion?: string;
      desde?: string;
      hasta?: string;
      pagina?: string;
    };
  }>('/auditoria', encargado, async (req: FastifyRequest<{ Querystring: Record<string, string | undefined> }>) => {
    const pagina = Math.max(1, Number(req.query.pagina ?? 1) || 1);
    const porPagina = 100;
    const where: Prisma.AuditoriaWhereInput = {
      ...(req.query.entidad ? { entidad: req.query.entidad } : {}),
      ...(req.query.entidadId ? { entidadId: req.query.entidadId } : {}),
      ...(req.query.usuarioId ? { usuarioId: req.query.usuarioId } : {}),
      ...(req.query.accion
        ? { accion: req.query.accion as Prisma.AuditoriaWhereInput['accion'] }
        : {}),
      ...(req.query.desde || req.query.hasta
        ? {
            creadoEn: {
              ...(req.query.desde ? { gte: new Date(req.query.desde) } : {}),
              ...(req.query.hasta ? { lte: new Date(req.query.hasta) } : {}),
            },
          }
        : {}),
    };
    const [total, registros] = await Promise.all([
      prisma.auditoria.count({ where }),
      prisma.auditoria.findMany({
        where,
        include: { usuario: { select: { id: true, nombre: true, email: true } } },
        orderBy: { creadoEn: 'desc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
    ]);
    return { total, pagina, porPagina, registros };
  });
}
