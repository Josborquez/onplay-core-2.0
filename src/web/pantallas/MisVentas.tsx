// V7 (lite) — /mis-ventas (05-SDD §7): solo el turno propio abierto, sin filtros.
// Filas expandibles con líneas y pagos; anuladas tachadas, nunca ocultas (P9).
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ETIQUETA_MEDIO, type Turno, type VentaCreada } from '../tipos.js';
import { clp, hora } from '../utils/formato.js';
import { Cargando, Insignia, Vacio } from '../components/base.js';

function FilaVenta({ venta }: { venta: VentaCreada }) {
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
          <div className="mt-2 flex flex-wrap gap-2 border-t border-sep pt-2">
            {venta.pagos.map((p) => (
              <Insignia key={p.id}>
                {ETIQUETA_MEDIO[p.medio]} · {clp(p.monto)}
                {p.referencia ? ` · ${p.referencia}` : ''}
              </Insignia>
            ))}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function MisVentas() {
  const [estado, setEstado] = useState<'cargando' | 'sin-turno' | 'listo'>('cargando');
  const [ventas, setVentas] = useState<VentaCreada[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const turno = await api<Turno | null>('/turnos/actual');
        if (!turno) {
          setEstado('sin-turno');
          return;
        }
        const r = await api<{ ventas: VentaCreada[] }>(`/ventas?turnoCajaId=${turno.id}`);
        setVentas(r.ventas);
        setEstado('listo');
      } catch {
        setEstado('sin-turno');
      }
    })();
  }, []);

  return (
    <div className="p-4">
      <h1 className="mb-4 text-tit text-lab">Mis ventas</h1>
      {estado === 'cargando' ? (
        <Cargando />
      ) : estado === 'sin-turno' ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje="No tienes un turno abierto. Las ventas se ven mientras el turno está abierto." />
        </div>
      ) : ventas.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje="Todavía no hay ventas en este turno." />
        </div>
      ) : (
        <ul className="divide-y divide-sep overflow-hidden rounded-tarjeta bg-bg shadow-tarjeta">
          {ventas.map((v) => (
            <FilaVenta key={v.id} venta={v} />
          ))}
        </ul>
      )}
    </div>
  );
}
