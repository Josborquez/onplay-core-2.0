// V23 — Devolución (03-SDD §6.6, §8): líneas con vendida / ya devuelta / a devolver, casilla
// «repone stock», medio (efectivo, monedero si hay cliente, otro), motivo obligatorio y total.
// El servidor recalcula el monto (prorrateo del descuento); aquí se muestra una estimación.
import { useEffect, useMemo, useState } from 'react';
import { ErrorApi, api } from '../api.js';
import type { VentaCreada } from '../tipos.js';
import { clp } from '../utils/formato.js';
import { Banner, Boton, Campo, Dialogo, Segmentado } from './base.js';

type MedioDevolucion = 'efectivo' | 'monedero' | 'otro';

interface DevolucionCreada {
  id: string;
  folio: string;
  monto: number;
  medio: MedioDevolucion;
}

interface Props {
  abierto: boolean;
  venta: VentaCreada | null;
  /** true si la venta pertenece a un turno ya cerrado (aviso: el dinero sale de tu caja abierta). */
  turnoCerrado: boolean;
  onCerrar: () => void;
  onHecha: (d: DevolucionCreada) => void;
}

export function DialogoDevolucion({ abierto, venta, turnoCerrado, onCerrar, onHecha }: Props) {
  const [yaDevueltas, setYaDevueltas] = useState<Record<string, number>>({});
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [repone, setRepone] = useState<Record<string, boolean>>({});
  const [medio, setMedio] = useState<MedioDevolucion>('efectivo');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [hecha, setHecha] = useState<DevolucionCreada | null>(null);

  useEffect(() => {
    if (!abierto || !venta) return;
    setCantidades({});
    setRepone(Object.fromEntries(venta.lineas.map((l) => [l.id, true])));
    setMedio('efectivo');
    setMotivo('');
    setError('');
    setHecha(null);
    setYaDevueltas({});
    let vivo = true;
    api<{ yaDevueltas: Record<string, number> }>(`/ventas/${venta.id}/devoluciones`)
      .then((r) => {
        if (vivo) setYaDevueltas(r.yaDevueltas);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [abierto, venta]);

  // Estimación del monto (el servidor prorratea el descuento con resto mayor; aquí basta aproximar).
  const estimado = useMemo(() => {
    if (!venta) return 0;
    const factor = venta.subtotal > 0 ? venta.descuento / venta.subtotal : 0;
    return venta.lineas.reduce((s, l) => {
      const c = cantidades[l.id] ?? 0;
      if (c <= 0) return s;
      const pagado = l.totalLinea - Math.round(l.totalLinea * factor);
      return s + Math.round((pagado * c) / l.cantidad);
    }, 0);
  }, [venta, cantidades]);

  const algunaLinea = Object.values(cantidades).some((c) => c > 0);

  const confirmar = async () => {
    if (!venta) return;
    if (!algunaLinea) {
      setError('Indica cuántas unidades devuelves en al menos una línea.');
      return;
    }
    if (!motivo.trim()) {
      setError('El motivo es obligatorio.');
      return;
    }
    setEnviando(true);
    setError('');
    try {
      const d = await api<DevolucionCreada>(`/ventas/${venta.id}/devoluciones`, {
        method: 'POST',
        body: JSON.stringify({
          medio,
          motivo: motivo.trim(),
          lineas: Object.entries(cantidades)
            .filter(([, c]) => c > 0)
            .map(([ventaLineaId, cantidad]) => ({ ventaLineaId, cantidad, reponeStock: repone[ventaLineaId] !== false })),
        }),
      });
      setHecha(d);
      onHecha(d);
    } catch (e) {
      if (e instanceof ErrorApi) {
        const m: Record<string, string> = {
          TURNO_NO_ABIERTO: 'Abre tu caja primero: el dinero de la devolución sale de ella.',
          CANTIDAD_EXCEDE_VENTA: 'Estás devolviendo más unidades de las que quedan por devolver en una línea.',
          VENTA_ANULADA: 'Una venta anulada no admite devoluciones.',
          CLIENTE_REQUERIDO: 'La venta no tiene cliente: no hay monedero al que devolver.',
        };
        setError(m[e.codigo] ?? `No se pudo registrar (${e.codigo}).`);
      } else {
        setError('Sin conexión: las devoluciones necesitan el servidor.');
      }
    } finally {
      setEnviando(false);
    }
  };

  const clienteConMonedero = Boolean(venta?.clienteId);

  return (
    <Dialogo abierto={abierto} titulo={hecha ? 'Devolución registrada' : 'Devolver'} onCerrar={onCerrar} cerrable={!enviando} ancho={560}>
      {!venta ? null : hecha ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span aria-hidden="true" className="text-total text-ok">
            ✓
          </span>
          <p className="text-tit text-lab">{hecha.folio}</p>
          <p className="num text-total font-semibold text-lab">{clp(hecha.monto)}</p>
          <p className="text-chico text-lab2">
            {hecha.medio === 'efectivo' ? 'Entrega el efectivo al cliente: ya está descontado de tu caja.' : hecha.medio === 'monedero' ? 'Quedó como saldo en el monedero del cliente.' : 'Registrado como devolución fuera del sistema (débito/transferencia); la caja no cambia.'}
          </p>
          <div className="flex gap-2">
            <Boton onClick={() => window.print()}>Imprimir</Boton>
            <Boton variante="principal" onClick={onCerrar}>
              Listo
            </Boton>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-cuerpo text-lab">
            {venta.folio} · <span className="num">{clp(venta.total)}</span>
          </p>
          {turnoCerrado ? <Banner tono="alerta">El turno de esta venta ya cerró: el dinero sale de tu caja abierta, no del turno original.</Banner> : null}

          <div className="hidden items-center gap-2 px-1 text-chico text-lab3 sm:flex">
            <span className="flex-1">Producto</span>
            <span className="w-[72px] text-right">Vendida</span>
            <span className="w-[72px] text-right">Devuelta</span>
            <span className="w-[88px] text-right">A devolver</span>
            <span className="w-[72px] text-center">Repone</span>
          </div>
          <ul className="divide-y divide-sep rounded-campo border border-sep">
            {venta.lineas.map((l) => {
              const previa = yaDevueltas[l.id] ?? 0;
              const disponible = l.cantidad - previa;
              const c = cantidades[l.id] ?? 0;
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-2 px-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-cuerpo text-lab">{l.descripcion}</span>
                    <span className="num block text-chico text-lab3">{clp(l.precioUnitario)} c/u</span>
                  </span>
                  <span className="num w-[72px] text-right text-cuerpo text-lab2">{l.cantidad}</span>
                  <span className="num w-[72px] text-right text-cuerpo text-lab2">{previa}</span>
                  <span className="w-[88px] text-right">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={disponible}
                      value={c || ''}
                      placeholder="0"
                      disabled={disponible <= 0}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(disponible, Math.floor(Number(e.target.value) || 0)));
                        setCantidades((prev) => ({ ...prev, [l.id]: v }));
                      }}
                      aria-label={`Unidades a devolver de ${l.descripcion}`}
                      className="num h-[36px] w-[80px] rounded-campo border border-sep bg-bg px-2 text-right text-cuerpo text-lab outline-none disabled:opacity-50"
                    />
                  </span>
                  <span className="w-[72px] text-center">
                    <input
                      type="checkbox"
                      checked={repone[l.id] !== false}
                      onChange={(e) => setRepone((prev) => ({ ...prev, [l.id]: e.target.checked }))}
                      aria-label={`Repone stock ${l.descripcion}`}
                      title="Desmarca si el producto vuelve dañado: no entra al stock"
                    />
                  </span>
                </li>
              );
            })}
          </ul>

          <div>
            <span className="mb-1 block text-chico text-lab2">Cómo se devuelve</span>
            <Segmentado<MedioDevolucion>
              opciones={[
                { valor: 'efectivo', etiqueta: 'Efectivo' },
                ...(clienteConMonedero ? [{ valor: 'monedero' as const, etiqueta: 'Monedero' }] : []),
                { valor: 'otro', etiqueta: 'Otro (fuera del sistema)' },
              ]}
              valor={medio}
              onChange={(m) => m && setMedio(m)}
            />
            <p className="mt-1 text-chico text-lab3">
              {medio === 'efectivo' ? 'Sale de tu caja abierta y resta en el arqueo.' : medio === 'monedero' ? 'Queda como saldo del cliente (E4).' : 'Débito o transferencia devueltos fuera del sistema: la caja no cambia.'}
            </p>
          </div>

          <Campo etiqueta="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: producto equivocado" />

          <div className="num flex items-center justify-between rounded-campo bg-bg2 px-3 py-2 text-cuerpo">
            <span className="text-lab2">Total a devolver (estimado)</span>
            <span className="font-semibold text-lab">{clp(estimado)}</span>
          </div>

          {error ? <Banner tono="peligro">{error}</Banner> : null}
          <div className="flex justify-end gap-2">
            <Boton onClick={onCerrar} deshabilitado={enviando}>
              Cancelar
            </Boton>
            <Boton variante="peligro" cargando={enviando} deshabilitado={!algunaLinea || !motivo.trim()} motivoDeshabilitado={!algunaLinea ? 'Indica las unidades a devolver.' : 'Escribe el motivo.'} onClick={() => void confirmar()}>
              Confirmar devolución
            </Boton>
          </div>
        </div>
      )}
    </Dialogo>
  );
}
