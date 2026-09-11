// Compras y proveedores — docs/11-SDD-etapa6-compras.md §7 (Fase 1). Rol encargado.
// Flujo: leer el PDF con el lector del distribuidor (o digitar) → borrador con líneas → vincular
// cada línea a un producto del maestro (se aprende por código de proveedor) → recibir: un
// movimiento `compra` por línea con referencia a la compra, en una sola transacción.
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  calcularImportacion,
  calcularLinea,
  convertirLineasAClp,
  cuadrarTotales,
  lectorPorRut,
  normalizarRut,
  resumenImportacion,
  type DocumentoLeido,
  type LectorFactura,
  type LineaCalculada,
  type LineaLeida,
  type TipoDocumentoCompra,
} from '@onplay/dominio';
import { prisma } from '../db.js';
import { ErrorStock, registrarMovimiento } from '../stock/libro.js';
import { extraerPaginasPdf } from '../compras/pdf.js';
import { detectarLector, lectorPorClave, LECTORES } from '../compras/lectores/index.js';
import { leerDin, reconoceDin } from '../compras/lectores/din.js';

const LECTORES_VALIDOS: LectorFactura[] = ['manual', ...LECTORES.map((l) => l.clave)];
const TIPOS_DOCUMENTO: TipoDocumentoCompra[] = ['factura', 'boleta', 'guia', 'otro'];
const TOPE_PDF_BYTES = 8 * 1024 * 1024;

const SELECT_PRODUCTO = {
  id: true,
  sku: true,
  nombre: true,
  controlaStock: true,
  costoReferencia: true,
  precioVenta: true,
  tipo: true,
} satisfies Prisma.ProductoSelect;

const INCLUIR_COMPRA = {
  proveedor: { select: { id: true, nombre: true, rut: true, lector: true } },
  ubicacion: { select: { id: true, codigo: true, nombre: true } },
  usuario: { select: { nombre: true } },
  recibidaPor: { select: { nombre: true } },
  lineas: { orderBy: { orden: 'asc' }, include: { producto: { select: SELECT_PRODUCTO } } },
  gastos: { orderBy: { creadoEn: 'asc' } },
} satisfies Prisma.CompraInclude;

const TIPOS_GASTO = ['agente', 'courier', 'seguro', 'otro'] as const;
type TipoGasto = (typeof TIPOS_GASTO)[number];

function numeroOpcional(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Leer el PDF del cuerpo (base64) → páginas; o una respuesta de error ya enviada (null). */
async function paginasDelCuerpo(archivo: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }, log: { warn: (o: unknown, m: string) => void }) {
  if (typeof archivo !== 'string' || !archivo) {
    reply.code(422).send({ error: 'ARCHIVO_REQUERIDO', detalle: 'archivo: PDF en base64' });
    return null;
  }
  const bytes = Buffer.from(archivo, 'base64');
  if (bytes.length === 0) {
    reply.code(422).send({ error: 'ARCHIVO_INVALIDO' });
    return null;
  }
  if (bytes.length > TOPE_PDF_BYTES) {
    reply.code(413).send({ error: 'ARCHIVO_DEMASIADO_GRANDE', detalle: 'Máximo 8 MB' });
    return null;
  }
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    reply.code(422).send({ error: 'ARCHIVO_INVALIDO', detalle: 'Solo PDF' });
    return null;
  }
  try {
    return await extraerPaginasPdf(new Uint8Array(bytes));
  } catch (e) {
    log.warn({ err: e }, 'pdf ilegible');
    reply.code(422).send({ error: 'PDF_ILEGIBLE', detalle: 'No se pudo leer el texto del PDF (¿es una imagen escaneada?).' });
    return null;
  }
}

function entero(v: unknown, def = 0): number {
  return Number.isInteger(v) ? (v as number) : def;
}

/** Línea del cuerpo → LineaLeida validada (o null si no tiene forma). */
function lineaDesdeCuerpo(l: unknown): LineaLeida | null {
  if (!l || typeof l !== 'object') return null;
  const o = l as Record<string, unknown>;
  const descripcion = typeof o.descripcion === 'string' ? o.descripcion.trim() : '';
  if (!descripcion) return null;
  return {
    codigoProveedor: typeof o.codigoProveedor === 'string' && o.codigoProveedor.trim() ? o.codigoProveedor.trim() : null,
    descripcion: descripcion.slice(0, 191),
    bultos: entero(o.bultos),
    unidadesPorBulto: entero(o.unidadesPorBulto, 1),
    sueltas: entero(o.sueltas),
    neto: entero(o.neto),
    impuestos: entero(o.impuestos),
    total: entero(o.total),
    totalOriginal: typeof o.totalOriginal === 'number' && Number.isFinite(o.totalOriginal) ? o.totalOriginal : null,
  };
}

function monedaDe(v: unknown): 'CLP' | 'USD' {
  return v === 'USD' ? 'USD' : 'CLP';
}

function tipoCambioDe(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Mapeos aprendidos del proveedor para un conjunto de códigos. */
async function mapeosDelProveedor(proveedorId: string, codigos: string[]) {
  if (codigos.length === 0) return new Map<string, { productoId: string; unidadesPorBulto: number }>();
  const filas = await prisma.productoProveedor.findMany({
    where: { proveedorId, codigoProveedor: { in: codigos } },
    select: { codigoProveedor: true, productoId: true, unidadesPorBulto: true },
  });
  return new Map(filas.map((f) => [f.codigoProveedor, { productoId: f.productoId, unidadesPorBulto: f.unidadesPorBulto }]));
}

export default async function rutasCompras(app: FastifyInstance) {
  const encargado = { preHandler: app.requiereRol('encargado') };

  // ---------- Proveedores (§7.1) ----------
  app.get('/proveedores', encargado, async () => {
    const proveedores = await prisma.proveedor.findMany({
      orderBy: { nombre: 'asc' },
      include: { _count: { select: { compras: true, productos: true } } },
    });
    return {
      proveedores: proveedores.map((p) => ({ ...p, compras: p._count.compras, productosVinculados: p._count.productos, _count: undefined })),
      lectores: [{ clave: 'manual', nombre: 'Digitar a mano' }, ...LECTORES.map((l) => ({ clave: l.clave, nombre: l.nombre }))],
    };
  });

  interface CuerpoProveedor {
    nombre?: unknown;
    rut?: unknown;
    lector?: unknown;
    notas?: unknown;
    activo?: unknown;
  }

  type ResultadoProveedor = { error: { codigo: string; detalle?: string } } | { datos: Prisma.ProveedorUncheckedUpdateInput };

  function validarProveedor(b: CuerpoProveedor, parcial: boolean): ResultadoProveedor {
    const datos: Prisma.ProveedorUncheckedUpdateInput = {};
    if (b.nombre !== undefined || !parcial) {
      const nombre = typeof b.nombre === 'string' ? b.nombre.trim() : '';
      if (!nombre) return { error: { codigo: 'NOMBRE_REQUERIDO' } };
      datos.nombre = nombre.slice(0, 191);
    }
    if (b.rut !== undefined) {
      if (b.rut === null || b.rut === '') datos.rut = null;
      else if (typeof b.rut === 'string') {
        const rut = normalizarRut(b.rut);
        if (!rut) return { error: { codigo: 'RUT_INVALIDO', detalle: 'El RUT no es válido (dígito verificador).' } };
        datos.rut = rut;
      }
    }
    if (b.lector !== undefined) {
      if (typeof b.lector !== 'string' || !LECTORES_VALIDOS.includes(b.lector as LectorFactura)) {
        return { error: { codigo: 'LECTOR_INVALIDO', detalle: `Lectores: ${LECTORES_VALIDOS.join(', ')}` } };
      }
      datos.lector = b.lector as LectorFactura;
    }
    if (b.notas !== undefined) datos.notas = typeof b.notas === 'string' && b.notas.trim() ? b.notas.trim() : null;
    if (b.activo !== undefined) datos.activo = Boolean(b.activo);
    return { datos };
  }

  app.post<{ Body: CuerpoProveedor }>('/proveedores', encargado, async (req, reply) => {
    const v = validarProveedor(req.body ?? {}, false);
    if ('error' in v) return reply.code(422).send({ error: v.error.codigo, detalle: v.error.detalle });
    const datos = v.datos as Prisma.ProveedorUncheckedCreateInput;
    // Sin lector explícito, el RUT conocido lo decide (Andina → andina).
    if (datos.lector === undefined && typeof datos.rut === 'string') datos.lector = lectorPorRut(datos.rut) ?? 'manual';
    if (typeof datos.rut === 'string') {
      const existe = await prisma.proveedor.findUnique({ where: { rut: datos.rut }, select: { id: true, nombre: true } });
      if (existe) return reply.code(409).send({ error: 'PROVEEDOR_DUPLICADO', detalle: `Ese RUT ya es de «${existe.nombre}».`, proveedorId: existe.id });
    }
    const p = await prisma.proveedor.create({ data: datos });
    await prisma.auditoria.create({
      data: { usuarioId: req.user.sub, entidad: 'proveedor', entidadId: p.id, accion: 'crear', valorNuevo: p },
    });
    return reply.code(201).send(p);
  });

  app.patch<{ Params: { id: string }; Body: CuerpoProveedor }>('/proveedores/:id', encargado, async (req, reply) => {
    const actual = await prisma.proveedor.findUnique({ where: { id: req.params.id } });
    if (!actual) return reply.code(404).send({ error: 'PROVEEDOR_NO_ENCONTRADO' });
    const v = validarProveedor(req.body ?? {}, true);
    if ('error' in v) return reply.code(422).send({ error: v.error.codigo, detalle: v.error.detalle });
    if (typeof v.datos.rut === 'string' && v.datos.rut !== actual.rut) {
      const existe = await prisma.proveedor.findUnique({ where: { rut: v.datos.rut }, select: { id: true } });
      if (existe) return reply.code(409).send({ error: 'PROVEEDOR_DUPLICADO' });
    }
    const p = await prisma.proveedor.update({ where: { id: actual.id }, data: v.datos });
    await prisma.auditoria.create({
      data: { usuarioId: req.user.sub, entidad: 'proveedor', entidadId: p.id, accion: 'editar', valorAnterior: actual, valorNuevo: p },
    });
    return p;
  });

  app.get<{ Params: { id: string } }>('/proveedores/:id/productos', encargado, async (req, reply) => {
    const proveedor = await prisma.proveedor.findUnique({ where: { id: req.params.id }, select: { id: true, nombre: true } });
    if (!proveedor) return reply.code(404).send({ error: 'PROVEEDOR_NO_ENCONTRADO' });
    const productos = await prisma.productoProveedor.findMany({
      where: { proveedorId: proveedor.id },
      orderBy: { codigoProveedor: 'asc' },
      include: { producto: { select: SELECT_PRODUCTO } },
    });
    return { proveedor, productos };
  });

  app.delete<{ Params: { id: string; mapeoId: string } }>('/proveedores/:id/productos/:mapeoId', encargado, async (req, reply) => {
    const m = await prisma.productoProveedor.findUnique({ where: { id: req.params.mapeoId } });
    if (!m || m.proveedorId !== req.params.id) return reply.code(404).send({ error: 'MAPEO_NO_ENCONTRADO' });
    await prisma.productoProveedor.delete({ where: { id: m.id } });
    await prisma.auditoria.create({
      data: { usuarioId: req.user.sub, entidad: 'producto_proveedor', entidadId: m.id, accion: 'editar', valorAnterior: m, valorNuevo: { eliminado: true } },
    });
    return reply.code(204).send();
  });

  // ---------- Leer un documento (§7.2) ----------
  interface CuerpoLeer {
    archivo?: unknown; // base64 del PDF
    nombre?: unknown;
    proveedorId?: unknown;
    tipoCambio?: unknown; // CLP por unidad de la moneda del documento (solo si no es CLP)
    gastosExtra?: unknown; // CLP: flete, aduana, IVA de importación
  }

  interface LineaPropuesta extends LineaCalculada {
    orden: number;
    productoId: string | null;
    producto: Prisma.ProductoGetPayload<{ select: typeof SELECT_PRODUCTO }> | null;
    aprendida: boolean; // la vinculación vino de ProductoProveedor
  }

  app.post<{ Body: CuerpoLeer }>('/compras/leer', { ...encargado, bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const b = req.body ?? {};
    const paginas = await paginasDelCuerpo(b.archivo, reply, req.log);
    if (!paginas) return;
    if (reconoceDin(paginas)) {
      return reply.code(422).send({ error: 'ES_DIN', detalle: 'Este PDF es una Declaración de Ingreso de Aduana, no una factura: se sube desde la compra en dólares, en «Importación».' });
    }

    // Lector: el del proveedor indicado si lo tiene; si no, el que reconozca el documento.
    let proveedorFijado: { id: string; nombre: string; rut: string | null; lector: LectorFactura } | null = null;
    if (typeof b.proveedorId === 'string' && b.proveedorId) {
      proveedorFijado = await prisma.proveedor.findUnique({ where: { id: b.proveedorId }, select: { id: true, nombre: true, rut: true, lector: true } });
      if (!proveedorFijado) return reply.code(422).send({ error: 'PROVEEDOR_NO_ENCONTRADO' });
    }
    // El documento manda (un proveedor puede mandar más de un formato: Nico, pedido web y factura);
    // el lector guardado en el proveedor solo se usa si ninguno reconoce el PDF.
    const lector = detectarLector(paginas) ?? (proveedorFijado && proveedorFijado.lector !== 'manual' ? lectorPorClave(proveedorFijado.lector) : null);
    if (!lector) {
      const muestra = paginas[0]?.slice(0, 12).map((f) => f.join(' · ')) ?? [];
      return reply.code(422).send({
        error: 'LECTOR_NO_DISPONIBLE',
        detalle: 'Ningún lector entiende este documento todavía. Se puede digitar a mano.',
        muestra,
        lectores: LECTORES.map((l) => ({ clave: l.clave, nombre: l.nombre })),
      });
    }
    const lectura: DocumentoLeido = lector.leer(paginas);

    // §6.6: documento en moneda extranjera → los CLP salen del tipo de cambio + gastos de importación.
    const moneda = lectura.moneda;
    const tipoCambio = moneda === 'CLP' ? null : tipoCambioDe(b.tipoCambio);
    const gastosExtra = moneda === 'CLP' ? 0 : Math.max(0, entero(b.gastosExtra));
    const requiereTipoCambio = moneda !== 'CLP' && tipoCambio === null;
    const lineasBase = moneda !== 'CLP' && tipoCambio !== null ? convertirLineasAClp(lectura.lineas, tipoCambio, gastosExtra) : lectura.lineas;
    const totalesDocumento =
      moneda === 'CLP'
        ? lectura.totales
        : tipoCambio !== null && lectura.totalOriginal != null
          ? (() => {
              const t = Math.round(lectura.totalOriginal * tipoCambio) + gastosExtra;
              return { neto: t, impuestos: 0, total: t };
            })()
          : null;

    // Proveedor: el fijado; si no, el del RUT que leyó el lector; si el documento no trae RUT
    // (Nico manda un pedido web), el proveedor activo que use ese lector.
    const proveedor =
      proveedorFijado ??
      (lectura.proveedor.rut
        ? await prisma.proveedor.findUnique({ where: { rut: lectura.proveedor.rut }, select: { id: true, nombre: true, rut: true, lector: true } })
        : null) ??
      (await prisma.proveedor.findFirst({ where: { lector: { in: lector.familia }, activo: true }, select: { id: true, nombre: true, rut: true, lector: true } }));
    const proveedorSugerido = proveedor ? null : { nombre: lectura.proveedor.nombre ?? '', rut: lectura.proveedor.rut, lector: lectura.lector };

    // Líneas: cálculo + vinculación aprendida por código.
    const codigos = lectura.lineas.map((l) => l.codigoProveedor).filter((c): c is string => !!c);
    const mapeos = proveedor ? await mapeosDelProveedor(proveedor.id, codigos) : new Map<string, { productoId: string; unidadesPorBulto: number }>();
    const productoIds = [...new Set([...mapeos.values()].map((m) => m.productoId))];
    const productos = productoIds.length
      ? await prisma.producto.findMany({ where: { id: { in: productoIds } }, select: SELECT_PRODUCTO })
      : [];
    const porId = new Map(productos.map((p) => [p.id, p]));
    const advertencias = [...lectura.advertencias];
    if (requiereTipoCambio) advertencias.push(`El documento está en ${moneda}: indica el tipo de cambio (y los gastos de importación, si los hay) para calcular los costos en pesos.`);
    const lineas: LineaPropuesta[] = [];
    lineasBase.forEach((l, i) => {
      const mapeo = l.codigoProveedor ? mapeos.get(l.codigoProveedor) : undefined;
      const conBulto = mapeo ? { ...l, unidadesPorBulto: mapeo.unidadesPorBulto } : l;
      const calc = calcularLinea(conBulto);
      if ('codigo' in calc) {
        advertencias.push(`Línea ${i + 1} «${l.descripcion}»: ${calc.detalle}`);
        return;
      }
      lineas.push({
        ...calc,
        orden: i + 1,
        productoId: mapeo?.productoId ?? null,
        producto: mapeo ? (porId.get(mapeo.productoId) ?? null) : null,
        aprendida: !!mapeo,
      });
    });
    const totales = cuadrarTotales(lineas, totalesDocumento);
    advertencias.push(...totales.advertencias);

    const yaCargada =
      proveedor && lectura.numeroDocumento
        ? await prisma.compra.findUnique({
            where: { proveedorId_numeroDocumento: { proveedorId: proveedor.id, numeroDocumento: lectura.numeroDocumento } },
            select: { id: true, estado: true },
          })
        : null;

    return {
      lector: lector.clave,
      lectorNombre: lector.nombre,
      archivoNombre: typeof b.nombre === 'string' ? b.nombre.slice(0, 191) : null,
      proveedor,
      proveedorSugerido,
      tipoDocumento: lectura.tipoDocumento,
      numeroDocumento: lectura.numeroDocumento,
      fechaDocumento: lectura.fechaDocumento,
      moneda,
      tipoCambio,
      gastosExtra,
      totalOriginal: lectura.totalOriginal ?? null,
      requiereTipoCambio,
      lineas,
      totales: { neto: totales.neto, impuestos: totales.impuestos, total: totales.total, sumaLineas: totales.sumaLineas },
      advertencias,
      yaCargada,
      sinVincular: lineas.filter((l) => !l.productoId).length,
    };
  });

  // ---------- C12b: leer una DIN (§6.7) ----------
  app.post<{ Body: { archivo?: unknown } }>('/compras/leer-din', { ...encargado, bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const paginas = await paginasDelCuerpo(req.body?.archivo, reply, req.log);
    if (!paginas) return;
    if (!reconoceDin(paginas)) {
      return reply.code(422).send({ error: 'NO_ES_DIN', detalle: 'Este PDF no parece una Declaración de Ingreso de Aduana.' });
    }
    const din = leerDin(paginas);
    const calculo =
      din.fob !== null && din.tipoCambio !== null
        ? calcularImportacion({ fob: din.fob, flete: din.flete ?? 0, seguro: din.seguro, arancelPct: din.arancelPct, tipoCambioAduana: din.tipoCambio })
        : null;
    return { din, calculo };
  });

  // ---------- Crear borrador (§7.3) ----------
  interface CuerpoCompra {
    proveedorId?: unknown;
    tipoDocumento?: unknown;
    numeroDocumento?: unknown;
    fechaDocumento?: unknown;
    ubicacionId?: unknown;
    origen?: unknown;
    lector?: unknown;
    archivoNombre?: unknown;
    nota?: unknown;
    totales?: unknown;
    advertencias?: unknown;
    lineas?: unknown;
    moneda?: unknown;
    tipoCambio?: unknown;
    gastosExtra?: unknown;
    totalOriginal?: unknown;
  }

  app.post<{ Body: CuerpoCompra }>('/compras', encargado, async (req, reply) => {
    const b = req.body ?? {};
    if (typeof b.proveedorId !== 'string') return reply.code(422).send({ error: 'PROVEEDOR_REQUERIDO' });
    const proveedor = await prisma.proveedor.findUnique({ where: { id: b.proveedorId } });
    if (!proveedor || !proveedor.activo) return reply.code(422).send({ error: 'PROVEEDOR_NO_ENCONTRADO' });
    const numeroDocumento = typeof b.numeroDocumento === 'string' ? b.numeroDocumento.trim() : '';
    if (!numeroDocumento) return reply.code(422).send({ error: 'NUMERO_REQUERIDO', detalle: 'Número del documento' });
    const fecha = typeof b.fechaDocumento === 'string' ? new Date(`${b.fechaDocumento.slice(0, 10)}T12:00:00.000Z`) : new Date(NaN);
    if (Number.isNaN(fecha.getTime())) return reply.code(422).send({ error: 'FECHA_INVALIDA', detalle: 'fechaDocumento: yyyy-mm-dd' });
    const tipoDocumento = TIPOS_DOCUMENTO.includes(b.tipoDocumento as TipoDocumentoCompra) ? (b.tipoDocumento as TipoDocumentoCompra) : 'factura';
    const origen = b.origen === 'pdf' ? 'pdf' : 'manual';
    const lector = typeof b.lector === 'string' && LECTORES_VALIDOS.includes(b.lector as LectorFactura) ? (b.lector as LectorFactura) : 'manual';
    const moneda = monedaDe(b.moneda);
    const tipoCambio = moneda === 'CLP' ? null : tipoCambioDe(b.tipoCambio);
    if (moneda !== 'CLP' && tipoCambio === null) return reply.code(422).send({ error: 'TIPO_CAMBIO_REQUERIDO', detalle: `El documento está en ${moneda}: falta el tipo de cambio.` });
    const gastosExtra = moneda === 'CLP' ? 0 : Math.max(0, entero(b.gastosExtra));
    const totalOriginal = typeof b.totalOriginal === 'number' && Number.isFinite(b.totalOriginal) ? b.totalOriginal : null;

    // Ubicación: la indicada, o la publicable (bodega) por defecto (D-E6-2).
    const ubicacion =
      typeof b.ubicacionId === 'string'
        ? await prisma.ubicacion.findUnique({ where: { id: b.ubicacionId } })
        : (await prisma.ubicacion.findFirst({ where: { publicable: true, activa: true }, orderBy: { orden: 'asc' } })) ??
          (await prisma.ubicacion.findFirst({ where: { activa: true }, orderBy: { orden: 'asc' } }));
    if (!ubicacion || !ubicacion.activa) return reply.code(422).send({ error: 'UBICACION_NO_ENCONTRADA' });

    // Líneas (pueden venir vacías: compra digitada que se completa en el detalle).
    const crudas = Array.isArray(b.lineas) ? b.lineas : [];
    const calculadas: (LineaCalculada & { productoId: string | null })[] = [];
    for (let i = 0; i < crudas.length; i++) {
      const leida = lineaDesdeCuerpo(crudas[i]);
      if (!leida) return reply.code(422).send({ error: 'LINEA_INVALIDA', detalle: `Línea ${i + 1}: falta la descripción`, indice: i });
      const calc = calcularLinea(leida);
      if ('codigo' in calc) return reply.code(422).send({ error: calc.codigo, detalle: `Línea ${i + 1}: ${calc.detalle}`, indice: i });
      const productoId = typeof (crudas[i] as { productoId?: unknown }).productoId === 'string' ? ((crudas[i] as { productoId: string }).productoId) : null;
      calculadas.push({ ...calc, productoId });
    }
    const productoIds = [...new Set(calculadas.map((l) => l.productoId).filter((x): x is string => !!x))];
    if (productoIds.length) {
      const existentes = await prisma.producto.findMany({ where: { id: { in: productoIds }, activo: true }, select: { id: true, tipo: true } });
      const porId = new Map(existentes.map((p) => [p.id, p]));
      for (const id of productoIds) {
        const p = porId.get(id);
        if (!p) return reply.code(422).send({ error: 'PRODUCTO_NO_ENCONTRADO', productoId: id });
        if (p.tipo === 'servicio') return reply.code(422).send({ error: 'PRODUCTO_SIN_STOCK', detalle: 'Un servicio no tiene stock', productoId: id });
      }
    }
    const totalesDoc =
      b.totales && typeof b.totales === 'object'
        ? { neto: entero((b.totales as Record<string, unknown>).neto), impuestos: entero((b.totales as Record<string, unknown>).impuestos), total: entero((b.totales as Record<string, unknown>).total) }
        : null;
    const totales = cuadrarTotales(calculadas, totalesDoc && totalesDoc.total > 0 ? totalesDoc : null);
    const advertencias = [
      ...(Array.isArray(b.advertencias) ? b.advertencias.filter((a): a is string => typeof a === 'string') : []),
      ...totales.advertencias,
    ];

    const existe = await prisma.compra.findUnique({
      where: { proveedorId_numeroDocumento: { proveedorId: proveedor.id, numeroDocumento } },
      select: { id: true, estado: true },
    });
    if (existe) return reply.code(409).send({ error: 'COMPRA_DUPLICADA', detalle: `El documento ${numeroDocumento} de ${proveedor.nombre} ya está cargado.`, compraId: existe.id, estado: existe.estado });

    const compra = await prisma.$transaction(async (tx) => {
      const c = await tx.compra.create({
        data: {
          proveedorId: proveedor.id,
          tipoDocumento,
          numeroDocumento,
          fechaDocumento: fecha,
          ubicacionId: ubicacion.id,
          origen,
          lector,
          archivoNombre: typeof b.archivoNombre === 'string' ? b.archivoNombre.slice(0, 191) : null,
          moneda,
          tipoCambio,
          gastosExtra,
          totalOriginal,
          neto: totales.neto,
          impuestos: totales.impuestos,
          total: totales.total,
          advertencias: advertencias.length ? advertencias : undefined,
          nota: typeof b.nota === 'string' && b.nota.trim() ? b.nota.trim() : null,
          usuarioId: req.user.sub,
          lineas: {
            create: calculadas.map((l, i) => ({
              orden: i + 1,
              codigoProveedor: l.codigoProveedor,
              descripcion: l.descripcion,
              productoId: l.productoId,
              bultos: l.bultos,
              unidadesPorBulto: l.unidadesPorBulto,
              sueltas: l.sueltas,
              cantidad: l.cantidad,
              neto: l.neto,
              impuestos: l.impuestos,
              total: l.total,
              costoUnitario: l.costoUnitario,
              totalOriginal: moneda === 'CLP' ? null : (l.totalOriginal ?? null),
            })),
          },
        },
        include: INCLUIR_COMPRA,
      });
      // Aprender las vinculaciones que vinieron con la lectura (§6.4).
      for (const l of calculadas) {
        if (l.productoId && l.codigoProveedor) await aprender(tx, proveedor.id, l.codigoProveedor, l.descripcion, l.productoId, l.unidadesPorBulto);
      }
      await tx.auditoria.create({
        data: {
          usuarioId: req.user.sub,
          entidad: 'compra',
          entidadId: c.id,
          accion: 'crear',
          valorNuevo: { proveedor: proveedor.nombre, numeroDocumento, origen, lector, lineas: c.lineas.length, total: c.total },
        },
      });
      return c;
    });
    return reply.code(201).send(compra);
  });

  async function aprender(tx: Prisma.TransactionClient, proveedorId: string, codigo: string, descripcion: string, productoId: string, unidadesPorBulto: number) {
    await tx.productoProveedor.upsert({
      where: { proveedorId_codigoProveedor: { proveedorId, codigoProveedor: codigo } },
      create: { proveedorId, codigoProveedor: codigo, descripcionProveedor: descripcion.slice(0, 191), productoId, unidadesPorBulto },
      update: { productoId, unidadesPorBulto, descripcionProveedor: descripcion.slice(0, 191) },
    });
  }

  // ---------- Listar y ver (§7.3) ----------
  app.get<{ Querystring: { estado?: string; proveedorId?: string; pagina?: string; pendientes?: string; q?: string } }>('/compras', encargado, async (req) => {
    const porPagina = 50;
    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    // Rediseño 1c (R-029): «Con pendientes» = recibidas con alguna línea sin movimiento.
    const conPendientes: Prisma.CompraWhereInput = { estado: 'recibida', lineas: { some: { movimientoId: null } } };
    const q = (req.query.q ?? '').trim();
    const where: Prisma.CompraWhereInput = {
      ...(req.query.pendientes === 'true'
        ? conPendientes
        : req.query.estado && ['borrador', 'recibida', 'anulada'].includes(req.query.estado)
          ? { estado: req.query.estado as 'borrador' | 'recibida' | 'anulada' }
          : {}),
      ...(req.query.proveedorId ? { proveedorId: req.query.proveedorId } : {}),
      ...(q ? { OR: [{ numeroDocumento: { contains: q } }, { proveedor: { nombre: { contains: q } } }] } : {}),
    };
    const inicioMes = new Date();
    inicioMes.setUTCDate(1);
    inicioMes.setUTCHours(0, 0, 0, 0);
    const [total, compras, porEstado, pendientes, mes] = await Promise.all([
      prisma.compra.count({ where }),
      prisma.compra.findMany({
        where,
        orderBy: [{ fechaDocumento: 'desc' }, { creadoEn: 'desc' }],
        skip: (pagina - 1) * porPagina,
        take: porPagina,
        include: {
          proveedor: { select: { id: true, nombre: true } },
          usuario: { select: { nombre: true } },
          lineas: { select: { productoId: true, cantidad: true, movimientoId: true } },
        },
      }),
      prisma.compra.groupBy({ by: ['estado'], _count: { _all: true } }),
      prisma.compra.count({ where: conPendientes }),
      prisma.compra.aggregate({ where: { estado: 'recibida', recibidaEn: { gte: inicioMes } }, _sum: { total: true }, _count: { _all: true } }),
    ]);
    const conteos = { borrador: 0, recibida: 0, anulada: 0, conPendientes: pendientes };
    for (const g of porEstado) conteos[g.estado] = g._count._all;
    return {
      total,
      pagina,
      porPagina,
      conteos,
      mes: { compras: mes._count._all, total: mes._sum.total ?? 0 },
      compras: compras.map((c) => ({
        ...c,
        lineas: undefined,
        totalLineas: c.lineas.length,
        sinVincular: c.lineas.filter((l) => !l.productoId && !l.movimientoId).length,
        pendientes: c.estado === 'recibida' ? c.lineas.filter((l) => !l.movimientoId).length : 0,
        unidades: c.lineas.reduce((a, l) => a + l.cantidad, 0),
      })),
    };
  });

  /** Detalle completo: líneas con stock vigente («pasará de X a Y») y, en moneda extranjera, el resumen de importación (§6.7). */
  async function detalleCompra(id: string) {
    const compra = await prisma.compra.findUnique({ where: { id }, include: INCLUIR_COMPRA });
    if (!compra) return null;
    const productoIds = compra.lineas.map((l) => l.productoId).filter((x): x is string => !!x);
    const stock = productoIds.length
      ? await prisma.stockActual.findMany({ where: { ubicacionId: compra.ubicacionId, productoId: { in: productoIds } }, select: { productoId: true, cantidad: true } })
      : [];
    const vigente = new Map(stock.map((s) => [s.productoId, s.cantidad]));
    return {
      ...compra,
      lineas: compra.lineas.map((l) => ({ ...l, stockVigente: l.productoId ? (vigente.get(l.productoId) ?? 0) : null })),
      resumenImportacion: compra.moneda === 'CLP' ? null : resumenImportacion(compra.lineas, compra, compra.gastos),
    };
  }

  app.get<{ Params: { id: string } }>('/compras/:id', encargado, async (req, reply) => {
    const compra = await detalleCompra(req.params.id);
    if (!compra) return reply.code(404).send({ error: 'COMPRA_NO_ENCONTRADA' });
    return compra;
  });

  // ---------- C12b: importación y gastos (§6.7) ----------
  /**
   * Vuelve a repartir entre las líneas el costo de importación (gastos sin documento + arancel + gastos
   * netos) y el IVA recuperable (IVA de importación + IVA de los gastos), y recalcula los totales.
   * En una compra recibida el costo de referencia de los productos que ya entraron se actualiza
   * (la DIN y las facturas del agente llegan después de la mercadería).
   */
  async function recalcularImportacion(tx: Prisma.TransactionClient, compraId: string) {
    const compra = await tx.compra.findUnique({ where: { id: compraId }, include: { lineas: { orderBy: { orden: 'asc' } }, gastos: true } });
    if (!compra || compra.moneda === 'CLP' || !compra.tipoCambio) return;
    const costoExtra = compra.gastosExtra + (compra.arancel ?? 0) + compra.gastos.reduce((a, g) => a + g.montoNeto, 0);
    const ivaExtra = (compra.ivaImportacion ?? 0) + compra.gastos.reduce((a, g) => a + g.iva, 0);
    const repartidas = convertirLineasAClp(compra.lineas, compra.tipoCambio, costoExtra, ivaExtra);
    const suma = { neto: 0, impuestos: 0, total: 0 };
    for (let i = 0; i < compra.lineas.length; i++) {
      const l = compra.lineas[i]!;
      const r = repartidas[i]!;
      const costoUnitario = l.cantidad > 0 ? Math.round(r.total / l.cantidad) : 0;
      await tx.compraLinea.update({ where: { id: l.id }, data: { neto: r.neto, impuestos: r.impuestos, total: r.total, costoUnitario } });
      if (l.movimientoId && l.productoId) await tx.producto.update({ where: { id: l.productoId }, data: { costoReferencia: costoUnitario } });
      suma.neto += r.neto;
      suma.impuestos += r.impuestos;
      suma.total += r.total;
    }
    await tx.compra.update({ where: { id: compraId }, data: suma });
  }

  async function compraImportable(id: string, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    const compra = await prisma.compra.findUnique({ where: { id }, include: { gastos: true } });
    if (!compra) {
      reply.code(404).send({ error: 'COMPRA_NO_ENCONTRADA' });
      return null;
    }
    if (compra.estado === 'anulada') {
      reply.code(409).send({ error: 'COMPRA_NO_EDITABLE', detalle: 'La compra está anulada.' });
      return null;
    }
    if (compra.moneda === 'CLP' || !compra.tipoCambio) {
      reply.code(422).send({ error: 'COMPRA_EN_CLP', detalle: 'Los costos de importación solo aplican a compras en moneda extranjera con tipo de cambio.' });
      return null;
    }
    return compra;
  }

  interface CuerpoImportacion {
    quitar?: unknown;
    fob?: unknown;
    flete?: unknown;
    seguro?: unknown; // null → presunto 2 %
    arancelPct?: unknown; // default 6
    tipoCambioAduana?: unknown; // default: el de la compra
    arancel?: unknown; // CLP; default: calculado
    ivaImportacion?: unknown; // CLP; default: calculado
    dinNumero?: unknown;
    dinFecha?: unknown;
  }

  app.put<{ Params: { id: string }; Body: CuerpoImportacion }>('/compras/:id/importacion', encargado, async (req, reply) => {
    const compra = await compraImportable(req.params.id, reply);
    if (!compra) return;
    const b = req.body ?? {};
    const anterior = { fob: compra.fob, flete: compra.flete, seguro: compra.seguro, cif: compra.cif, arancelPct: compra.arancelPct, tipoCambioAduana: compra.tipoCambioAduana, arancel: compra.arancel, ivaImportacion: compra.ivaImportacion, dinNumero: compra.dinNumero, dinFecha: compra.dinFecha };
    let data: { fob: number | null; flete: number | null; seguro: number | null; cif: number | null; arancelPct: number | null; tipoCambioAduana: number | null; arancel: number | null; ivaImportacion: number | null; dinNumero: string | null; dinFecha: Date | null };
    if (b.quitar === true) {
      data = { fob: null, flete: null, seguro: null, cif: null, arancelPct: null, tipoCambioAduana: null, arancel: null, ivaImportacion: null, dinNumero: null, dinFecha: null };
    } else {
      const fob = numeroOpcional(b.fob);
      if (fob === null) return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: 'fob: número ≥ 0 en la moneda del documento' });
      const flete = numeroOpcional(b.flete) ?? 0;
      const seguroDado = numeroOpcional(b.seguro);
      const arancelPct = numeroOpcional(b.arancelPct) ?? 6;
      const tipoCambioAduana = numeroOpcional(b.tipoCambioAduana) || compra.tipoCambio!;
      const calc = calcularImportacion({ fob, flete, seguro: seguroDado, arancelPct, tipoCambioAduana });
      const arancel = Number.isInteger(b.arancel) && (b.arancel as number) >= 0 ? (b.arancel as number) : calc.arancel;
      const ivaImportacion = Number.isInteger(b.ivaImportacion) && (b.ivaImportacion as number) >= 0 ? (b.ivaImportacion as number) : calc.ivaImportacion;
      let dinFecha: Date | null = null;
      if (typeof b.dinFecha === 'string' && b.dinFecha.trim()) {
        dinFecha = new Date(`${b.dinFecha.slice(0, 10)}T12:00:00.000Z`);
        if (Number.isNaN(dinFecha.getTime())) return reply.code(422).send({ error: 'FECHA_INVALIDA', detalle: 'dinFecha' });
      }
      data = {
        fob,
        flete,
        seguro: calc.seguro,
        cif: calc.cif,
        arancelPct,
        tipoCambioAduana,
        arancel,
        ivaImportacion,
        dinNumero: typeof b.dinNumero === 'string' && b.dinNumero.trim() ? b.dinNumero.trim().slice(0, 40) : null,
        dinFecha,
      };
    }
    await prisma.$transaction(async (tx) => {
      await tx.compra.update({ where: { id: compra.id }, data });
      await recalcularImportacion(tx, compra.id);
      await tx.auditoria.create({
        data: { usuarioId: req.user.sub, entidad: 'compra', entidadId: compra.id, accion: 'editar', valorAnterior: { importacion: anterior }, valorNuevo: { importacion: b.quitar === true ? null : { ...data, dinFecha: data.dinFecha?.toISOString() ?? null } } },
      });
    });
    return detalleCompra(compra.id);
  });

  interface CuerpoGasto {
    tipo?: unknown;
    descripcion?: unknown;
    montoNeto?: unknown;
    iva?: unknown;
    documento?: unknown;
    fecha?: unknown;
  }

  app.post<{ Params: { id: string }; Body: CuerpoGasto }>('/compras/:id/gastos', encargado, async (req, reply) => {
    const compra = await compraImportable(req.params.id, reply);
    if (!compra) return;
    const b = req.body ?? {};
    if (!TIPOS_GASTO.includes(b.tipo as TipoGasto)) return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: `tipo: ${TIPOS_GASTO.join(' | ')}` });
    const descripcion = typeof b.descripcion === 'string' ? b.descripcion.trim().slice(0, 191) : '';
    if (!descripcion) return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: 'descripcion: obligatoria' });
    const montoNeto = entero(b.montoNeto, -1);
    if (montoNeto < 0) return reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: 'montoNeto: entero ≥ 0 en CLP' });
    const iva = Math.max(0, entero(b.iva));
    let fecha: Date | null = null;
    if (typeof b.fecha === 'string' && b.fecha.trim()) {
      fecha = new Date(`${b.fecha.slice(0, 10)}T12:00:00.000Z`);
      if (Number.isNaN(fecha.getTime())) return reply.code(422).send({ error: 'FECHA_INVALIDA' });
    }
    const gasto = await prisma.$transaction(async (tx) => {
      const g = await tx.compraGasto.create({
        data: { compraId: compra.id, tipo: b.tipo as TipoGasto, descripcion, montoNeto, iva, documento: typeof b.documento === 'string' && b.documento.trim() ? b.documento.trim().slice(0, 100) : null, fecha },
      });
      await recalcularImportacion(tx, compra.id);
      await tx.auditoria.create({ data: { usuarioId: req.user.sub, entidad: 'compra', entidadId: compra.id, accion: 'editar', valorNuevo: { gasto: { id: g.id, tipo: g.tipo, descripcion, montoNeto, iva, documento: g.documento } } } });
      return g;
    });
    return reply.code(201).send({ gasto, compra: await detalleCompra(compra.id) });
  });

  app.delete<{ Params: { id: string; gastoId: string } }>('/compras/:id/gastos/:gastoId', encargado, async (req, reply) => {
    const compra = await compraImportable(req.params.id, reply);
    if (!compra) return;
    const gasto = compra.gastos.find((g) => g.id === req.params.gastoId);
    if (!gasto) return reply.code(404).send({ error: 'GASTO_NO_ENCONTRADO' });
    await prisma.$transaction(async (tx) => {
      await tx.compraGasto.delete({ where: { id: gasto.id } });
      await recalcularImportacion(tx, compra.id);
      await tx.auditoria.create({ data: { usuarioId: req.user.sub, entidad: 'compra', entidadId: compra.id, accion: 'editar', valorAnterior: { gasto: { id: gasto.id, tipo: gasto.tipo, descripcion: gasto.descripcion, montoNeto: gasto.montoNeto, iva: gasto.iva } }, valorNuevo: { gasto: null } } });
    });
    return detalleCompra(compra.id);
  });

  async function compraEditable(id: string, reply: { code: (n: number) => { send: (b: unknown) => unknown } }, permitirRecibida = false) {
    const compra = await prisma.compra.findUnique({ where: { id }, include: { lineas: true } });
    if (!compra) {
      reply.code(404).send({ error: 'COMPRA_NO_ENCONTRADA' });
      return null;
    }
    // §6.5: en una compra recibida solo se tocan las líneas que quedaron fuera (sin movimiento).
    if (compra.estado !== 'borrador' && !(permitirRecibida && compra.estado === 'recibida')) {
      reply.code(409).send({ error: 'COMPRA_NO_EDITABLE', detalle: `La compra está ${compra.estado}.` });
      return null;
    }
    return compra;
  }

  interface CuerpoEditarCompra {
    ubicacionId?: unknown;
    fechaDocumento?: unknown;
    numeroDocumento?: unknown;
    tipoDocumento?: unknown;
    nota?: unknown;
  }

  app.patch<{ Params: { id: string }; Body: CuerpoEditarCompra }>('/compras/:id', encargado, async (req, reply) => {
    const compra = await compraEditable(req.params.id, reply);
    if (!compra) return;
    const b = req.body ?? {};
    const data: Prisma.CompraUncheckedUpdateInput = {};
    if (typeof b.ubicacionId === 'string') {
      const u = await prisma.ubicacion.findUnique({ where: { id: b.ubicacionId } });
      if (!u?.activa) return reply.code(422).send({ error: 'UBICACION_NO_ENCONTRADA' });
      data.ubicacionId = u.id;
    }
    if (typeof b.fechaDocumento === 'string') {
      const f = new Date(`${b.fechaDocumento.slice(0, 10)}T12:00:00.000Z`);
      if (Number.isNaN(f.getTime())) return reply.code(422).send({ error: 'FECHA_INVALIDA' });
      data.fechaDocumento = f;
    }
    if (typeof b.numeroDocumento === 'string' && b.numeroDocumento.trim() && b.numeroDocumento.trim() !== compra.numeroDocumento) {
      const existe = await prisma.compra.findUnique({ where: { proveedorId_numeroDocumento: { proveedorId: compra.proveedorId, numeroDocumento: b.numeroDocumento.trim() } }, select: { id: true } });
      if (existe) return reply.code(409).send({ error: 'COMPRA_DUPLICADA', compraId: existe.id });
      data.numeroDocumento = b.numeroDocumento.trim();
    }
    if (TIPOS_DOCUMENTO.includes(b.tipoDocumento as TipoDocumentoCompra)) data.tipoDocumento = b.tipoDocumento as TipoDocumentoCompra;
    if (b.nota !== undefined) data.nota = typeof b.nota === 'string' && b.nota.trim() ? b.nota.trim() : null;
    const c = await prisma.compra.update({ where: { id: compra.id }, data, include: INCLUIR_COMPRA });
    return c;
  });

  // ---------- Líneas del borrador (§7.4) ----------
  interface CuerpoLinea {
    productoId?: unknown; // string | null
    codigoProveedor?: unknown;
    descripcion?: unknown;
    bultos?: unknown;
    unidadesPorBulto?: unknown;
    sueltas?: unknown;
    neto?: unknown;
    impuestos?: unknown;
    total?: unknown;
    aprender?: unknown; // default true
  }

  async function validarProductoLinea(productoId: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    if (productoId === null || productoId === undefined) return { productoId: null as string | null };
    if (typeof productoId !== 'string') {
      reply.code(422).send({ error: 'CUERPO_INVALIDO', detalle: 'productoId: string | null' });
      return null;
    }
    const p = await prisma.producto.findUnique({ where: { id: productoId }, select: { id: true, activo: true, tipo: true } });
    if (!p || !p.activo) {
      reply.code(422).send({ error: 'PRODUCTO_NO_ENCONTRADO' });
      return null;
    }
    if (p.tipo === 'servicio') {
      reply.code(422).send({ error: 'PRODUCTO_SIN_STOCK', detalle: 'Un servicio no tiene stock' });
      return null;
    }
    return { productoId: p.id };
  }

  /** Recalcula los totales de la compra cuando no vienen de un documento (o cuando se editan líneas). */
  async function recalcularTotales(tx: Prisma.TransactionClient, compraId: string, origen: string) {
    if (origen === 'pdf') return; // mandan los totales del documento (§6.2)
    const lineas = await tx.compraLinea.findMany({ where: { compraId }, select: { neto: true, impuestos: true, total: true } });
    const suma = lineas.reduce((a, l) => ({ neto: a.neto + l.neto, impuestos: a.impuestos + l.impuestos, total: a.total + l.total }), { neto: 0, impuestos: 0, total: 0 });
    await tx.compra.update({ where: { id: compraId }, data: suma });
  }

  app.post<{ Params: { id: string }; Body: CuerpoLinea }>('/compras/:id/lineas', encargado, async (req, reply) => {
    const compra = await compraEditable(req.params.id, reply);
    if (!compra) return;
    const leida = lineaDesdeCuerpo(req.body ?? {});
    if (!leida) return reply.code(422).send({ error: 'LINEA_INVALIDA', detalle: 'Falta la descripción' });
    const calc = calcularLinea(leida);
    if ('codigo' in calc) return reply.code(422).send({ error: calc.codigo, detalle: calc.detalle });
    const prod = await validarProductoLinea(req.body?.productoId, reply);
    if (!prod) return;
    const orden = (compra.lineas.reduce((m, l) => Math.max(m, l.orden), 0) ?? 0) + 1;
    const linea = await prisma.$transaction(async (tx) => {
      const l = await tx.compraLinea.create({
        data: { compraId: compra.id, orden, ...calc, productoId: prod.productoId },
        include: { producto: { select: SELECT_PRODUCTO } },
      });
      if (prod.productoId && calc.codigoProveedor && req.body?.aprender !== false) {
        await aprender(tx, compra.proveedorId, calc.codigoProveedor, calc.descripcion, prod.productoId, calc.unidadesPorBulto);
      }
      await recalcularTotales(tx, compra.id, compra.origen);
      return l;
    });
    return reply.code(201).send(linea);
  });

  app.patch<{ Params: { id: string; lineaId: string }; Body: CuerpoLinea }>('/compras/:id/lineas/:lineaId', encargado, async (req, reply) => {
    const compra = await compraEditable(req.params.id, reply, true);
    if (!compra) return;
    const actual = compra.lineas.find((l) => l.id === req.params.lineaId);
    if (!actual) return reply.code(404).send({ error: 'LINEA_NO_ENCONTRADA' });
    if (actual.movimientoId) return reply.code(409).send({ error: 'LINEA_YA_RECIBIDA', detalle: 'Esa línea ya entró al stock: se corrige con merma o ajuste (P9).' });
    const b = req.body ?? {};
    const leida: LineaLeida = {
      codigoProveedor: b.codigoProveedor === undefined ? actual.codigoProveedor : typeof b.codigoProveedor === 'string' && b.codigoProveedor.trim() ? b.codigoProveedor.trim() : null,
      descripcion: typeof b.descripcion === 'string' && b.descripcion.trim() ? b.descripcion.trim().slice(0, 191) : actual.descripcion,
      bultos: b.bultos === undefined ? actual.bultos : entero(b.bultos, -1),
      unidadesPorBulto: b.unidadesPorBulto === undefined ? actual.unidadesPorBulto : entero(b.unidadesPorBulto, 0),
      sueltas: b.sueltas === undefined ? actual.sueltas : entero(b.sueltas, -1),
      neto: b.neto === undefined ? actual.neto : entero(b.neto, -1),
      impuestos: b.impuestos === undefined ? actual.impuestos : entero(b.impuestos, -1),
      total: b.total === undefined ? actual.total : entero(b.total, -1),
    };
    const calc = calcularLinea(leida);
    if ('codigo' in calc) return reply.code(422).send({ error: calc.codigo, detalle: calc.detalle });
    const prod = b.productoId === undefined ? { productoId: actual.productoId } : await validarProductoLinea(b.productoId, reply);
    if (!prod) return;
    const linea = await prisma.$transaction(async (tx) => {
      const l = await tx.compraLinea.update({
        where: { id: actual.id },
        data: { ...calc, productoId: prod.productoId },
        include: { producto: { select: SELECT_PRODUCTO } },
      });
      if (prod.productoId && calc.codigoProveedor && b.aprender !== false) {
        await aprender(tx, compra.proveedorId, calc.codigoProveedor, calc.descripcion, prod.productoId, calc.unidadesPorBulto);
      }
      await recalcularTotales(tx, compra.id, compra.origen);
      return l;
    });
    return linea;
  });

  app.delete<{ Params: { id: string; lineaId: string } }>('/compras/:id/lineas/:lineaId', encargado, async (req, reply) => {
    const compra = await compraEditable(req.params.id, reply);
    if (!compra) return;
    const actual = compra.lineas.find((l) => l.id === req.params.lineaId);
    if (!actual) return reply.code(404).send({ error: 'LINEA_NO_ENCONTRADA' });
    await prisma.$transaction(async (tx) => {
      await tx.compraLinea.delete({ where: { id: actual.id } });
      await recalcularTotales(tx, compra.id, compra.origen);
    });
    return reply.code(204).send();
  });

  // ---------- Recibir (§6.5): entra al libro de stock ----------
  app.post<{ Params: { id: string }; Body: { omitirSinVincular?: unknown } }>('/compras/:id/recibir', encargado, async (req, reply) => {
    const compra = await prisma.compra.findUnique({
      where: { id: req.params.id },
      include: { lineas: { orderBy: { orden: 'asc' } }, proveedor: { select: { nombre: true } }, ubicacion: true },
    });
    if (!compra) return reply.code(404).send({ error: 'COMPRA_NO_ENCONTRADA' });
    if (compra.estado === 'anulada') return reply.code(409).send({ error: 'COMPRA_NO_EDITABLE', detalle: 'La compra está anulada.' });
    if (!compra.ubicacion.activa) return reply.code(422).send({ error: 'UBICACION_NO_ENCONTRADA' });
    // §6.5: en una compra ya recibida, solo entran las líneas pendientes (vinculadas después, sin movimiento).
    const recepcionAdicional = compra.estado === 'recibida';
    const sinVincular = compra.lineas.filter((l) => !l.productoId && !l.movimientoId);
    const conProducto = compra.lineas.filter((l) => l.productoId && !l.movimientoId);
    if (conProducto.length === 0) {
      return reply.code(recepcionAdicional ? 409 : 422).send({
        error: recepcionAdicional ? 'SIN_PENDIENTES' : 'SIN_LINEAS',
        detalle: recepcionAdicional ? 'No hay líneas pendientes con producto: todo lo vinculado ya entró.' : 'Ninguna línea tiene producto: no hay nada que ingresar.',
      });
    }
    if (sinVincular.length > 0 && req.body?.omitirSinVincular !== true) {
      return reply.code(422).send({
        error: 'LINEAS_SIN_VINCULAR',
        detalle: `${sinVincular.length} línea(s) no tienen producto. Vincularlas o recibir con omitirSinVincular:true (no entrarán al stock).`,
        lineas: sinVincular.map((l) => ({ id: l.id, descripcion: l.descripcion })),
      });
    }
    const productoIds = [...new Set(conProducto.map((l) => l.productoId!))];
    const productos = await prisma.producto.findMany({ where: { id: { in: productoIds } }, select: { id: true, nombre: true, activo: true, controlaStock: true, tipo: true } });
    const porId = new Map(productos.map((p) => [p.id, p]));
    for (const id of productoIds) {
      const p = porId.get(id);
      if (!p || !p.activo) return reply.code(422).send({ error: 'PRODUCTO_NO_ENCONTRADO', productoId: id });
      if (p.tipo === 'servicio') return reply.code(422).send({ error: 'PRODUCTO_SIN_STOCK', productoId: id });
    }
    const nota = `${compra.tipoDocumento} ${compra.numeroDocumento} · ${compra.proveedor.nombre}`;

    try {
      const resultado = await prisma.$transaction(async (tx) => {
        // Candados de StockActual en orden ascendente por productoId (§6.1 de E2): sin interbloqueos.
        const ordenadas = [...conProducto].sort((a, b) => (a.productoId! < b.productoId! ? -1 : a.productoId! > b.productoId! ? 1 : 0));
        const movimientos: { lineaId: string; productoId: string; movimientoId: string; cantidadAnterior: number; cantidadNueva: number }[] = [];
        const encendidos: string[] = [];
        for (const l of ordenadas) {
          const r = await registrarMovimiento(tx, {
            productoId: l.productoId!,
            ubicacionId: compra.ubicacionId,
            cantidad: l.cantidad,
            motivo: 'compra',
            referenciaTipo: 'compra',
            referenciaId: compra.id,
            nota,
            usuarioId: req.user.sub,
          });
          await tx.compraLinea.update({ where: { id: l.id }, data: { movimientoId: r.movimientoId } });
          movimientos.push({ lineaId: l.id, productoId: l.productoId!, movimientoId: r.movimientoId, cantidadAnterior: r.cantidadAnterior, cantidadNueva: r.cantidadNueva });
          // Costo de referencia = último costo unitario recibido (D-E6-1). M5: el ingreso enciende el control.
          const p = porId.get(l.productoId!)!;
          await tx.producto.update({ where: { id: p.id }, data: { costoReferencia: l.costoUnitario, ...(p.controlaStock ? {} : { controlaStock: true }) } });
          if (!p.controlaStock && !encendidos.includes(p.id)) {
            encendidos.push(p.id);
            await tx.auditoria.create({
              data: {
                usuarioId: req.user.sub,
                entidad: 'producto',
                entidadId: p.id,
                accion: 'ajustar_stock',
                valorAnterior: { controlaStock: false },
                valorNuevo: { controlaStock: true, motivo: 'primer ingreso por compra', compraId: compra.id, movimientoId: r.movimientoId },
              },
            });
            porId.set(p.id, { ...p, controlaStock: true });
          }
        }
        const c = await tx.compra.update({
          where: { id: compra.id },
          data: recepcionAdicional ? {} : { estado: 'recibida', recibidaEn: new Date(), recibidaPorId: req.user.sub },
          include: INCLUIR_COMPRA,
        });
        await tx.auditoria.create({
          data: {
            usuarioId: req.user.sub,
            entidad: 'compra',
            entidadId: compra.id,
            accion: 'editar',
            valorAnterior: { estado: compra.estado },
            valorNuevo: {
              estado: 'recibida',
              recepcionAdicional,
              ubicacion: compra.ubicacion.codigo,
              movimientos: movimientos.length,
              omitidas: sinVincular.length,
              unidades: conProducto.reduce((a, l) => a + l.cantidad, 0),
            },
          },
        });
        return { compra: c, movimientos, encendidos, omitidas: sinVincular.map((l) => l.id) };
      });
      return resultado;
    } catch (e) {
      if (e instanceof ErrorStock) return reply.code(e.status).send(e.cuerpo);
      throw e;
    }
  });

  // ---------- Anular un borrador (§7.3) ----------
  app.post<{ Params: { id: string }; Body: { nota?: unknown } }>('/compras/:id/anular', encargado, async (req, reply) => {
    const compra = await prisma.compra.findUnique({ where: { id: req.params.id } });
    if (!compra) return reply.code(404).send({ error: 'COMPRA_NO_ENCONTRADA' });
    if (compra.estado === 'recibida') {
      return reply.code(409).send({ error: 'COMPRA_RECIBIDA', detalle: 'Una compra recibida no se anula (P9): corregir el stock con una merma o un ajuste.' });
    }
    if (compra.estado === 'anulada') return reply.code(409).send({ error: 'COMPRA_NO_EDITABLE' });
    const nota = typeof req.body?.nota === 'string' ? req.body.nota.trim() : '';
    if (!nota) return reply.code(422).send({ error: 'NOTA_REQUERIDA' });
    const c = await prisma.$transaction(async (tx) => {
      const actualizada = await tx.compra.update({ where: { id: compra.id }, data: { estado: 'anulada', nota: compra.nota ? `${compra.nota}\n${nota}` : nota }, include: INCLUIR_COMPRA });
      await tx.auditoria.create({
        data: { usuarioId: req.user.sub, entidad: 'compra', entidadId: compra.id, accion: 'anular', valorAnterior: { estado: compra.estado }, valorNuevo: { estado: 'anulada', nota } },
      });
      return actualizada;
    });
    return c;
  });
}
