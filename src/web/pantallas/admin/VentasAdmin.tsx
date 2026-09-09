// V7 — /admin/ventas (05-SDD §7): filtros de fecha y estado. Sin filtro por
// vendedor (§14 H3) ni total agregado del rango (§14 H5). Anuladas tachadas,
// nunca ocultas (P9). Anular exige motivo y solo con el turno abierto.
import { useCallback, useEffect, useState } from 'react';
import { api, ErrorApi } from '../../api.js';
import { useEnLinea } from '../../tema.js';
import { ETIQUETA_MEDIO, type TurnoConUsuario, type VentaCreada } from '../../tipos.js';
import { clp, hora } from '../../utils/formato.js';
import { Banner, Boton, Cargando, Dialogo, Insignia, Segmentado, Vacio } from '../../components/base.js';
import { DialogoDevolucion } from '../../components/DialogoDevolucion.js';
import { Encabezado, Paginacion } from './util.js';

const MENSAJE_TURNO_CERRADO =
  'No se puede anular una venta de un turno cerrado. Usa «Devolver…»: el dinero sale de tu caja abierta.';

function hoyIso(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function FilaVenta({
  venta,
  turnoAbierto,
  onAnular,
  onDevolver,
}: {
  venta: VentaCreada;
  turnoAbierto: boolean;
  onAnular: (v: VentaCreada) => void;
  onDevolver: (v: VentaCreada) => void;
}) {
  const [abierta, setAbierta] = useState(false);
  const anulada = venta.estado === 'anulada';
  return (
    <li>
      <button
        type="button"
        onClick={() => setAbierta((a) => !a)}
        aria-expanded={abierta}
        className="flex h-fila w-full items-center justify-between px-4 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={`font-mono text-cuerpo ${anulada ? 'text-lab3 line-through' : 'text-lab'}`}>
            {venta.folio}
          </span>
          {anulada ? <Insignia tono="peligro">anulada</Insignia> : null}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="text-chico text-lab3">{hora(venta.creadoEn)}</span>
          <span className={`num font-semibold ${anulada ? 'text-lab3 line-through' : 'text-lab'}`}>
            {clp(venta.total)}
          </span>
        </span>
      </button>
      {abierta ? (
        <div className="border-t border-sep bg-bg2 px-4 py-3">
          <ul className="flex flex-col gap-1">
            {venta.lineas.map((l) => (
              <li key={l.id} className="num flex justify-between text-cuerpo text-lab">
                <span className="min-w-0 truncate text-lab2">
                  {l.cantidad} × {l.descripcion}
                </span>
                <span>{clp(l.totalLinea)}</span>
              </li>
            ))}
            {venta.descuento > 0 ? (
              <li className="num flex justify-between text-cuerpo text-lab2">
                <span>Descuento</span>
                <span>−{clp(venta.descuento)}</span>
              </li>
            ) : null}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-sep pt-2">
            {venta.pagos.map((p) => (
              <Insignia key={p.id}>
                {ETIQUETA_MEDIO[p.medio]} · {clp(p.monto)}
                {p.referencia ? ` · ${p.referencia}` : ''}
              </Insignia>
            ))}
          </div>
          {anulada ? (
            venta.motivoAnulacion ? (
              <p className="mt-2 text-chico text-lab2">Motivo de la anulación: {venta.motivoAnulacion}</p>
            ) : null
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="w-[200px]">
                <Boton onClick={() => onDevolver(venta)}>Devolver…</Boton>
              </div>
              <div className="w-[200px]">
                <Boton
                  variante="peligro"
                  deshabilitado={!turnoAbierto}
                  motivoDeshabilitado={!turnoAbierto ? MENSAJE_TURNO_CERRADO : undefined}
                  onClick={() => onAnular(venta)}
                >
                  Anular…
                </Boton>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function VentasAdmin() {
  const [dia, setDia] = useState(hoyIso());
  const [estado, setEstado] = useState<'completada' | 'anulada' | null>(null);
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<{ total: number; porPagina: number; ventas: VentaCreada[] } | null>(null);
  const [turnosAbiertos, setTurnosAbiertos] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const [anulando, setAnulando] = useState<VentaCreada | null>(null);
  const [motivo, setMotivo] = useState('');
  const [errorAnular, setErrorAnular] = useState<string | null>(null);
  const [devolviendo, setDevolviendo] = useState<VentaCreada | null>(null);
  const [avisoDevolucion, setAvisoDevolucion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enLinea = useEnLinea();

  const cargar = useCallback(async () => {
    setError(false);
    const p = new URLSearchParams({ pagina: String(pagina) });
    p.set('desde', new Date(`${dia}T00:00:00`).toISOString());
    p.set('hasta', new Date(`${dia}T23:59:59.999`).toISOString());
    if (estado) p.set('estado', estado);
    try {
      const [r, t] = await Promise.all([
        api<{ total: number; porPagina: number; ventas: VentaCreada[] }>(`/ventas?${p}`),
        // Los turnos abiertos determinan qué ventas se pueden anular (§5.3).
        api<{ turnos: TurnoConUsuario[] }>('/turnos?pagina=1'),
      ]);
      setDatos(r);
      setTurnosAbiertos(new Set(t.turnos.filter((x) => x.estado === 'abierto').map((x) => x.id)));
    } catch {
      setError(true);
    }
  }, [dia, estado, pagina]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const confirmarAnulacion = async () => {
    if (!anulando || !motivo.trim()) return;
    setEnviando(true);
    setErrorAnular(null);
    try {
      const anulada = await api<VentaCreada>(`/ventas/${anulando.id}/anular`, {
        method: 'POST',
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      setDatos((prev) =>
        prev ? { ...prev, ventas: prev.ventas.map((v) => (v.id === anulada.id ? anulada : v)) } : prev,
      );
      setAnulando(null);
      setMotivo('');
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'TURNO_CERRADO') {
        setErrorAnular('Este turno ya se cerró. No se pueden anular sus ventas; corresponde una devolución, que llega en la Etapa 2.');
      } else if (e instanceof ErrorApi && e.codigo === 'VENTA_YA_ANULADA') {
        setErrorAnular('Esta venta ya estaba anulada.');
      } else if (e instanceof ErrorApi && e.codigo === 'VENTA_CON_DEVOLUCIONES') {
        setErrorAnular('Esta venta ya tiene devoluciones: devuelve el resto en vez de anular.');
        void cargar();
      } else {
        setErrorAnular('Algo salió mal. Si vuelve a pasar, anota la hora y avisa.');
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="p-4">
      <Encabezado titulo="Ventas" />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={dia}
          onChange={(e) => {
            setDia(e.target.value || hoyIso());
            setPagina(1);
          }}
          aria-label="Día"
          className="h-tactil rounded-campo border border-sep bg-bg px-3 text-cuerpo text-lab outline-none"
        />
        <Segmentado
          opciones={[
            { valor: 'completada', etiqueta: 'Completadas' },
            { valor: 'anulada', etiqueta: 'Anuladas' },
          ]}
          valor={estado}
          onChange={(v) => {
            setEstado(v);
            setPagina(1);
          }}
        />
      </div>

      {error ? (
        <div className="mb-3">
          <Banner tono="peligro" accion={<Boton onClick={() => void cargar()}>Reintentar</Boton>}>
            No se pudieron cargar las ventas. Revisa la conexión y vuelve a intentar.
          </Banner>
        </div>
      ) : null}

      {datos === null ? (
        <Cargando />
      ) : datos.ventas.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje="No hay ventas ese día con estos filtros. Cambia el día o el estado." />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-sep overflow-hidden rounded-tarjeta bg-bg shadow-tarjeta">
            {datos.ventas.map((v) => (
              <FilaVenta
                key={v.id}
                venta={v}
                turnoAbierto={turnosAbiertos.has(v.turnoCajaId)}
                onDevolver={(venta) => setDevolviendo(venta)}
                onAnular={(venta) => {
                  setAnulando(venta);
                  setMotivo('');
                  setErrorAnular(null);
                }}
              />
            ))}
          </ul>
          <Paginacion pagina={pagina} porPagina={datos.porPagina} total={datos.total} onPagina={setPagina} />
        </>
      )}

      {avisoDevolucion ? (
        <div className="mb-3">
          <Banner tono="ok">{avisoDevolucion}</Banner>
        </div>
      ) : null}
      <DialogoDevolucion
        abierto={devolviendo !== null}
        venta={devolviendo}
        turnoCerrado={devolviendo ? !turnosAbiertos.has(devolviendo.turnoCajaId) : false}
        onCerrar={() => setDevolviendo(null)}
        onHecha={(d) => setAvisoDevolucion(`Devolución ${d.folio} registrada por ${clp(d.monto)}.`)}
      />
      <Dialogo abierto={anulando !== null} titulo="Anular la venta" onCerrar={() => setAnulando(null)} ancho={420}>
        {anulando ? (
          <div className="flex flex-col gap-4">
            <p className="text-cuerpo text-lab">
              {anulando.folio} · <span className="num">{clp(anulando.total)}</span>
            </p>
            <Banner tono="alerta">Esto no devuelve el dinero ni repone stock. Solo marca la venta como anulada.</Banner>
            <div>
              <label htmlFor="motivo-anulacion" className="mb-1 block text-chico text-lab2">
                Motivo
              </label>
              <textarea
                id="motivo-anulacion"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                className="w-full rounded-campo border border-sep bg-bg p-3 text-cuerpo text-lab outline-none"
              />
            </div>
            {errorAnular ? <Banner tono="peligro">{errorAnular}</Banner> : null}
            <Boton
              variante="peligro"
              cargando={enviando}
              deshabilitado={motivo.trim() === '' || !enLinea}
              motivoDeshabilitado={
                !enLinea ? 'Necesitas conexión para esto.' : motivo.trim() === '' ? 'Escribe el motivo de la anulación.' : undefined
              }
              onClick={() => void confirmarAnulacion()}
            >
              Anular la venta
            </Boton>
          </div>
        ) : null}
      </Dialogo>
    </div>
  );
}
