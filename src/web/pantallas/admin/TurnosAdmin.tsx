// V8 — Turnos (05-SDD §7): Fecha · Vendedor · Apertura · Esperado · Declarado ·
// Diferencia. Al expandir, la nota del cierre y el resumen por medio. Un turno
// abierto muestra Esperado en vivo y las tres últimas columnas vacías.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { ETIQUETA_MEDIO, type ResumenTurno, type TurnoConUsuario } from '../../tipos.js';
import { clp, fecha, hora } from '../../utils/formato.js';
import { Banner, Boton, Cargando, Insignia, Vacio } from '../../components/base.js';
import { Encabezado, Paginacion } from './util.js';

function CeldaDiferencia({ diferencia }: { diferencia: number | null }) {
  if (diferencia === null) return <span className="text-lab3">—</span>;
  if (diferencia === 0) return <Insignia tono="ok">$0</Insignia>;
  return (
    <Insignia tono="alerta">
      {clp(diferencia)} ({diferencia < 0 ? 'falta' : 'sobra'})
    </Insignia>
  );
}

function FilaTurno({ turno, esperadoVivo }: { turno: TurnoConUsuario; esperadoVivo: number | null }) {
  const [resumen, setResumen] = useState<ResumenTurno | 'cargando' | null>(null);
  const abierta = resumen !== null;
  const enCurso = turno.estado === 'abierto';

  const conmutar = async () => {
    if (abierta) {
      setResumen(null);
      return;
    }
    setResumen('cargando');
    try {
      setResumen(await api<ResumenTurno>(`/turnos/${turno.id}/resumen`));
    } catch {
      setResumen(null);
    }
  };

  const esperado = enCurso ? esperadoVivo : turno.montoEsperado;

  return (
    <li>
      <button
        type="button"
        onClick={() => void conmutar()}
        aria-expanded={abierta}
        className="grid min-h-fila w-full grid-cols-[1fr_1fr_auto] items-center gap-2 px-4 py-2 text-left sm:grid-cols-[130px_1fr_100px_100px_100px_130px]"
      >
        <span className="text-cuerpo text-lab">
          {fecha(turno.abiertoEn)} <span className="text-chico text-lab3">{hora(turno.abiertoEn)}</span>
        </span>
        <span className="min-w-0 truncate text-cuerpo text-lab2">
          {turno.usuario.nombre}
          {enCurso ? (
            <>
              {' '}
              <Insignia tono="ok">abierto</Insignia>
            </>
          ) : null}
        </span>
        <span className="num hidden text-right text-cuerpo text-lab2 sm:block">{clp(turno.montoApertura)}</span>
        <span className="num hidden text-right text-cuerpo text-lab2 sm:block">
          {esperado === null ? <span className="text-lab3">…</span> : clp(esperado)}
        </span>
        <span className="num hidden text-right text-cuerpo text-lab2 sm:block">
          {turno.montoDeclarado === null ? '—' : clp(turno.montoDeclarado)}
        </span>
        <span className="text-right">
          <CeldaDiferencia diferencia={turno.diferencia} />
        </span>
      </button>
      {abierta ? (
        <div className="border-t border-sep bg-bg2 px-4 py-3 text-cuerpo">
          {resumen === 'cargando' ? (
            <Cargando texto="Cargando el resumen…" />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {resumen.totalesPorMedio.map((m) => (
                  <Insignia key={m.medio}>
                    {ETIQUETA_MEDIO[m.medio]} · {clp(m.total)}
                  </Insignia>
                ))}
                {resumen.totalesPorMedio.length === 0 ? <span className="text-lab3">Sin ventas.</span> : null}
              </div>
              <p className="mt-2 text-chico text-lab2">
                {resumen.cantidadVentas} venta(s) · total {clp(resumen.totalVendido)} · ticket promedio{' '}
                {clp(resumen.ticketPromedio)}
                {resumen.devolucionesEfectivo || resumen.ingresosCaja || resumen.retirosCaja ? (
                  <>
                    {' · '}
                    {resumen.devolucionesEfectivo ? `devoluciones en efectivo −${clp(resumen.devolucionesEfectivo)} ` : ''}
                    {resumen.ingresosCaja ? `ingresos de caja +${clp(resumen.ingresosCaja)} ` : ''}
                    {resumen.retirosCaja ? `retiros de caja −${clp(resumen.retirosCaja)}` : ''}
                  </>
                ) : null}
              </p>
              {turno.notas ? <p className="mt-2 text-chico text-lab2">Nota del cierre: {turno.notas}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function TurnosAdmin() {
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<{ total: number; porPagina: number; turnos: TurnoConUsuario[] } | null>(null);
  const [esperadosVivos, setEsperadosVivos] = useState<Record<string, number>>({});
  const [error, setError] = useState(false);

  const cargar = useCallback(async () => {
    setError(false);
    try {
      const r = await api<{ total: number; porPagina: number; turnos: TurnoConUsuario[] }>(`/turnos?pagina=${pagina}`);
      setDatos(r);
      // Esperado en vivo de los turnos abiertos: apertura + efectivo del resumen.
      const abiertos = r.turnos.filter((t) => t.estado === 'abierto');
      const pares = await Promise.all(
        abiertos.map(async (t) => {
          try {
            const resumen = await api<ResumenTurno>(`/turnos/${t.id}/resumen`);
            // E2 §6.7: el servidor ya descuenta devoluciones y aplica ingresos/retiros.
            return [t.id, resumen.montoEsperado] as const;
          } catch {
            return null;
          }
        }),
      );
      setEsperadosVivos(Object.fromEntries(pares.filter((p): p is readonly [string, number] => p !== null)));
    } catch {
      setError(true);
    }
  }, [pagina]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="p-4">
      <Encabezado titulo="Turnos" />
      {error ? (
        <div className="mb-3">
          <Banner tono="peligro" accion={<Boton onClick={() => void cargar()}>Reintentar</Boton>}>
            No se pudieron cargar los turnos. Revisa la conexión y vuelve a intentar.
          </Banner>
        </div>
      ) : null}
      {datos === null ? (
        <Cargando />
      ) : datos.turnos.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje="Todavía no hay turnos registrados." />
        </div>
      ) : (
        <>
          <div className="hidden grid-cols-[130px_1fr_100px_100px_100px_130px] gap-2 px-4 pb-1 text-chico text-lab3 sm:grid">
            <span>Fecha</span>
            <span>Vendedor</span>
            <span className="text-right">Apertura</span>
            <span className="text-right">Esperado</span>
            <span className="text-right">Declarado</span>
            <span className="text-right">Diferencia</span>
          </div>
          <ul className="divide-y divide-sep overflow-hidden rounded-tarjeta bg-bg shadow-tarjeta">
            {datos.turnos.map((t) => (
              <FilaTurno key={t.id} turno={t} esperadoVivo={esperadosVivos[t.id] ?? null} />
            ))}
          </ul>
          <Paginacion pagina={pagina} porPagina={datos.porPagina} total={datos.total} onPagina={setPagina} />
        </>
      )}
    </div>
  );
}
