// R-036 — Análisis comercial e inventario (docs/14 §8). Solo lectura, encargado+.
// Los costos NO salen por rutas de mostrador ni por el catálogo offline: viven solo aquí.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ErrorRango, periodoAnterior, type Agrupar } from '../fechas.js';
import { reporteCanales, type FiltrosReporte } from '../reportes/consolidado.js';
import { reporteInventario, type FiltrosInventario } from '../reportes/inventario.js';

/** CSV para Excel: BOM, CRLF y protección de fórmulas (un texto con = o + no se ejecuta). */
function csv(reply: FastifyReply, nombre: string, cabecera: string[], filas: (string | number | null)[][]) {
  const celda = (v: string | number | null): string => {
    if (v === null) return '';
    if (typeof v === 'number') return String(v);
    const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${seguro.replace(/"/g, '""')}"`;
  };
  const texto = [cabecera.map(celda).join(','), ...filas.map((f) => f.map(celda).join(','))].join('\r\n');
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${nombre}"`)
    .send(`﻿${texto}\r\n`);
}

const lista = (v: string | undefined): string[] | undefined => {
  const partes = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return partes.length ? partes : undefined;
};

interface QueryCanales {
  desde?: string;
  hasta?: string;
  agrupar?: string;
  canales?: string;
  categorias?: string;
  juego?: string;
  tipo?: string;
  comparar?: string;
  costoActual?: string;
}

export default async function rutasReportes(app: FastifyInstance) {
  const encargado = { preHandler: app.requiereRol('encargado') };

  function filtros(q: QueryCanales): { f: FiltrosReporte; agrupar: Agrupar } {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    const desde = q.desde ?? `${hoy.slice(0, 7)}-01`;
    const hasta = q.hasta ?? hoy;
    const agrupar: Agrupar = q.agrupar === 'semana' || q.agrupar === 'mes' ? q.agrupar : 'dia';
    return {
      f: { desde, hasta, canalIds: lista(q.canales), categoriaIds: lista(q.categorias), juego: q.juego || undefined, tipo: q.tipo || undefined, costoActual: q.costoActual === 'true' },
      agrupar,
    };
  }

  async function conRango<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErrorRango) {
        reply.code(422).send({ error: e.message, detalle: e.message === 'RANGO_DEMASIADO_GRANDE' ? 'máximo 400 días' : 'revisa las fechas del rango' });
        return undefined;
      }
      throw e;
    }
  }

  // ---------- GET /reportes/canales ----------
  app.get<{ Querystring: QueryCanales }>('/reportes/canales', encargado, async (req, reply) => {
    const { f, agrupar } = filtros(req.query);
    return conRango(reply, async () => {
      const actual = await reporteCanales(f, agrupar);
      if (req.query.comparar !== 'true') return actual;
      const previo = periodoAnterior(f.desde, f.hasta);
      const anterior = await reporteCanales({ ...f, ...previo }, agrupar);
      return {
        ...actual,
        anterior: { desde: previo.desde, hasta: previo.hasta, consolidado: anterior.consolidado },
      };
    });
  });

  app.get<{ Querystring: QueryCanales }>('/reportes/canales.csv', encargado, async (req, reply) => {
    const { f, agrupar } = filtros(req.query);
    return conRango(reply, async () => {
      const r = await reporteCanales(f, agrupar);
      const nombre = new Map(r.canales.map((c) => [c.id, c.nombre]));
      const filas = [...r.consolidado.filas, r.consolidado.total].map((x) => [
        x.canalId === 'total' ? 'Total' : (nombre.get(x.canalId) ?? x.canalId),
        x.operaciones,
        x.unidadesNetas,
        x.importeBruto,
        x.reembolsos,
        x.importeAjustado,
        x.aportePorcentaje === null ? 'No calculable' : x.aportePorcentaje.toFixed(2),
        x.ticketPromedio === null ? '' : x.ticketPromedio,
        x.operacionesAnuladas,
        x.operacionesReembolsadasTotal,
        x.operacionesEnRevision,
        x.cargasMonedero,
      ]);
      return csv(
        reply,
        `canales_${f.desde}_${f.hasta}.csv`,
        ['canal', 'operaciones', 'unidades_netas', 'importe_antes_de_reembolsos', 'reembolsos', 'importe_ajustado', 'aporte_%', 'ticket_promedio', 'anuladas', 'reembolsadas_total', 'en_revision', 'cargas_monedero'],
        filas,
      );
    });
  });

  // ---------- GET /reportes/canales/categorias ----------
  app.get<{ Querystring: QueryCanales }>('/reportes/canales/categorias', encargado, async (req, reply) => {
    const { f, agrupar } = filtros(req.query);
    return conRango(reply, async () => {
      const r = await reporteCanales(f, agrupar);
      return { desde: r.desde, hasta: r.hasta, categorias: r.categorias, canales: r.canales, noAtribuible: r.noAtribuible, margen: r.margen };
    });
  });

  app.get<{ Querystring: QueryCanales }>('/reportes/canales/categorias.csv', encargado, async (req, reply) => {
    const { f, agrupar } = filtros(req.query);
    return conRango(reply, async () => {
      const r = await reporteCanales(f, agrupar);
      const nombre = new Map(r.canales.map((c) => [c.id, c.nombre]));
      return csv(
        reply,
        `canales-categorias_${f.desde}_${f.hasta}.csv`,
        ['canal', 'categoria', 'unidades_netas', 'importe', 'porcentaje'],
        r.categorias.map((c) => [nombre.get(c.canalId) ?? c.canalId, c.categoria, c.unidadesNetas, c.importe, c.porcentaje === null ? '' : c.porcentaje.toFixed(2)]),
      );
    });
  });

  // ---------- GET /reportes/inventario-valorizado ----------
  app.get<{ Querystring: FiltrosInventario }>('/reportes/inventario-valorizado', encargado, async (req) => reporteInventario(req.query));

  app.get<{ Querystring: FiltrosInventario }>('/reportes/inventario-valorizado.csv', encargado, async (req, reply) => {
    const r = await reporteInventario(req.query);
    return csv(
      reply,
      `inventario-valorizado_${r.cortadoEn.slice(0, 10)}.csv`,
      ['sku', 'producto', 'categoria', 'juego', 'ubicacion', 'estado', 'cantidad', 'costo_unitario', 'valor_a_costo', 'precio_venta', 'valor_a_precio', 'diferencia_potencial', 'calidad'],
      r.filas.map((f) => [
        f.sku,
        f.nombre,
        f.categoria,
        f.juego,
        f.ubicacion,
        f.activo ? 'activo' : 'inactivo',
        f.cantidad,
        f.costoReferencia,
        f.valorCosto,
        f.precioVenta,
        f.valorPrecio,
        f.diferenciaPotencial,
        f.calidad,
      ]),
    );
  });

  // ---------- GET /reportes/calidad-datos ----------
  app.get<{ Querystring: QueryCanales }>('/reportes/calidad-datos', encargado, async (req, reply) => {
    const { f, agrupar } = filtros(req.query);
    return conRango(reply, async () => {
      const r = await reporteCanales(f, agrupar);
      const inv = await reporteInventario({});
      return {
        consultadoEn: r.consultadoEn,
        criterio: r.criterio,
        cobertura: r.cobertura,
        margen: {
          coberturaLineas: r.margen.coberturaLineas,
          coberturaImporte: r.margen.coberturaImporte,
          lineasConCosto: r.margen.lineasConCosto,
          lineasTotales: r.margen.lineasTotales,
        },
        inventario: {
          coberturaUnidades: inv.resumen.coberturaUnidades,
          coberturaSkus: inv.resumen.coberturaSkus,
          skusSinCosto: inv.resumen.skusSinCosto,
          unidadesNegativas: inv.resumen.unidadesNegativas,
          skusSinControl: inv.resumen.skusSinControl,
        },
        noAtribuible: r.noAtribuible,
        operacionesEnRevision: r.consolidado.total.operacionesEnRevision,
        operacionesOtraMoneda: r.consolidado.total.operacionesOtraMoneda,
        // Lo que falta cargar para cerrar cobertura (§10): se enumera, no se da por hecho.
        pendientes: [
          'Historial de pedidos web anterior a la primera ingesta (carga analítica, agendada)',
          'Costo de compra de los productos sin `costoReferencia`',
          'Mapeo de las líneas de pedidos web sin producto',
          'Recuento inicial de los productos sin control de stock',
        ],
      };
    });
  });
}
