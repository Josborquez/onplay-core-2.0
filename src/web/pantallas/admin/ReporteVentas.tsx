// R-026 — Reportes: ventas por usuario por día, semana o mes (pedido del dueño, 2026-09-10).
// Solo ventas completadas; las anuladas se cuentan aparte y no suman. Fechas en hora Chile.
import { useCallback, useEffect, useState } from 'react';
import { api, descargar } from '../../api.js';
import { Banner, Boton, Campo, Cargando, Segmentado, Vacio } from '../../components/base.js';
import { clp } from '../../utils/formato.js';
import { Encabezado } from './util.js';

type Agrupar = 'dia' | 'semana' | 'mes';

interface Fila {
  periodo: string;
  etiqueta: string;
  usuarioId: string;
  ventas: number;
  total: number;
  anuladas: number;
}

interface Reporte {
  agrupar: Agrupar;
  desde: string;
  hasta: string;
  usuarios: { id: string; nombre: string }[];
  filas: Fila[];
  totales: { ventas: number; total: number; anuladas: number };
}

function iso(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // YYYY-MM-DD
}

function primerDiaDelMes(): string {
  const hoy = iso(new Date());
  return `${hoy.slice(0, 7)}-01`;
}

export function ReporteVentas() {
  const [agrupar, setAgrupar] = useState<Agrupar>('dia');
  const [desde, setDesde] = useState(primerDiaDelMes());
  const [hasta, setHasta] = useState(iso(new Date()));
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setReporte(await api<Reporte>(`/ventas/resumen-usuarios?desde=${desde}&hasta=${hasta}&agrupar=${agrupar}`));
    } catch {
      setError('No se pudo cargar el reporte.');
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, agrupar]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const periodos = reporte ? [...new Map(reporte.filas.map((f) => [f.periodo, f.etiqueta])).entries()].sort((a, b) => a[0].localeCompare(b[0])) : [];
  const celda = (periodo: string, usuarioId: string) => reporte?.filas.find((f) => f.periodo === periodo && f.usuarioId === usuarioId);
  const totalUsuario = (usuarioId: string) => (reporte?.filas ?? []).filter((f) => f.usuarioId === usuarioId).reduce((a, f) => ({ ventas: a.ventas + f.ventas, total: a.total + f.total }), { ventas: 0, total: 0 });
  const totalPeriodo = (periodo: string) => (reporte?.filas ?? []).filter((f) => f.periodo === periodo).reduce((a, f) => ({ ventas: a.ventas + f.ventas, total: a.total + f.total }), { ventas: 0, total: 0 });

  return (
    <div className="p-4">
      <Encabezado
        titulo="Reportes"
        extra={
          <div className="w-[160px]">
            <Boton deshabilitado={!reporte || reporte.filas.length === 0} onClick={() => void descargar(`/ventas/resumen-usuarios.csv?desde=${desde}&hasta=${hasta}&agrupar=${agrupar}`, `ventas-por-usuario_${desde}_${hasta}_${agrupar}.csv`)}>
              Exportar CSV
            </Boton>
          </div>
        }
      />
      <p className="mb-3 text-chico text-lab3">Ventas completadas por usuario. Las anuladas no suman y se cuentan aparte. Fechas en hora de Chile.</p>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Segmentado<Agrupar>
          opciones={[
            { valor: 'dia', etiqueta: 'Por día' },
            { valor: 'semana', etiqueta: 'Por semana' },
            { valor: 'mes', etiqueta: 'Por mes' },
          ]}
          valor={agrupar}
          onChange={(v) => setAgrupar(v ?? 'dia')}
        />
        <div className="w-[170px]">
          <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="w-[170px]">
          <Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>
      {error ? (
        <div className="mb-3">
          <Banner tono="peligro">{error}</Banner>
        </div>
      ) : null}
      {cargando || !reporte ? (
        <Cargando />
      ) : reporte.filas.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje="No hay ventas en ese rango." />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-tarjeta bg-bg shadow-tarjeta">
          <table className="w-full text-chico">
            <thead>
              <tr className="border-b border-sep text-left text-lab2">
                <th className="px-3 py-2 font-medium">{agrupar === 'dia' ? 'Día' : agrupar === 'semana' ? 'Semana' : 'Mes'}</th>
                {reporte.usuarios.map((u) => (
                  <th key={u.id} className="px-3 py-2 text-right font-medium">
                    {u.nombre}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-semibold text-lab">Total</th>
              </tr>
            </thead>
            <tbody>
              {periodos.map(([periodo, etiqueta]) => {
                const tp = totalPeriodo(periodo);
                return (
                  <tr key={periodo} className="border-b border-sep">
                    <td className="px-3 py-2 text-lab">{etiqueta}</td>
                    {reporte.usuarios.map((u) => {
                      const c = celda(periodo, u.id);
                      return (
                        <td key={u.id} className="num px-3 py-2 text-right text-lab2">
                          {c ? (
                            <>
                              <span className="text-lab">{clp(c.total)}</span>
                              <span className="block text-lab3">
                                {c.ventas} venta{c.ventas === 1 ? '' : 's'}
                                {c.anuladas > 0 ? ` · ${c.anuladas} anulada${c.anuladas === 1 ? '' : 's'}` : ''}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      );
                    })}
                    <td className="num px-3 py-2 text-right font-semibold text-lab">
                      {clp(tp.total)}
                      <span className="block font-normal text-lab3">{tp.ventas} ventas</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-bg3">
                <td className="px-3 py-2 font-semibold text-lab">Total del rango</td>
                {reporte.usuarios.map((u) => {
                  const t = totalUsuario(u.id);
                  return (
                    <td key={u.id} className="num px-3 py-2 text-right font-semibold text-lab">
                      {clp(t.total)}
                      <span className="block font-normal text-lab3">{t.ventas} ventas</span>
                    </td>
                  );
                })}
                <td className="num px-3 py-2 text-right font-semibold text-lab">
                  {clp(reporte.totales.total)}
                  <span className="block font-normal text-lab3">
                    {reporte.totales.ventas} ventas{reporte.totales.anuladas > 0 ? ` · ${reporte.totales.anuladas} anuladas` : ''}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
