// V21 — Diálogo de movimiento de stock (03-SDD §8): Ajuste / Merma / Ingreso / Traslado,
// ubicación (y destino), cantidad, nota obligatoria y vista previa «pasará de X a Y».
// Reutiliza la estructura de V17 de E4. Hace el POST y avisa al padre para recargar.
import { useEffect, useState } from 'react';
import { ErrorApi, api } from '../api.js';
import { Boton, Campo, Dialogo, Segmentado } from './base.js';

export type MotivoManual = 'ajuste' | 'merma' | 'compra' | 'traslado';

export interface UbicacionResumen {
  id: string;
  codigo: string;
  nombre: string;
  esVenta: boolean;
}

interface StockProducto {
  controlaStock: boolean;
  ubicaciones: { id: string; codigo: string; nombre: string; esVenta: boolean; cantidad: number }[];
}

interface Props {
  abierto: boolean;
  producto: { id: string; nombre: string; sku: string } | null;
  motivoInicial: MotivoManual;
  /** Ubicación preseleccionada (la del filtro de V19, o la de venta). */
  ubicacionInicialId?: string | null;
  onCerrar: () => void;
  /** Movimiento registrado: el padre recarga su lista. */
  onHecho: (mensaje: string) => void;
}

const ETIQUETA: Record<MotivoManual, string> = {
  ajuste: 'Ajuste',
  merma: 'Merma',
  compra: 'Ingreso',
  traslado: 'Traslado',
};

export function DialogoMovimientoStock({ abierto, producto, motivoInicial, ubicacionInicialId, onCerrar, onHecho }: Props) {
  const [motivo, setMotivo] = useState<MotivoManual>(motivoInicial);
  const [stock, setStock] = useState<StockProducto | null>(null);
  const [ubicacionId, setUbicacionId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [cantidad, setCantidad] = useState<number | ''>('');
  const [resta, setResta] = useState(false);
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto || !producto) return;
    setMotivo(motivoInicial);
    setCantidad('');
    setResta(false);
    setNota('');
    setError('');
    setStock(null);
    let vivo = true;
    api<StockProducto>(`/productos/${producto.id}/stock`)
      .then((s) => {
        if (!vivo) return;
        setStock(s);
        const venta = s.ubicaciones.find((u) => u.esVenta)?.id ?? s.ubicaciones[0]?.id ?? '';
        const inicial = ubicacionInicialId && s.ubicaciones.some((u) => u.id === ubicacionInicialId) ? ubicacionInicialId : venta;
        setUbicacionId(inicial);
        setDestinoId(s.ubicaciones.find((u) => u.id !== inicial)?.id ?? '');
      })
      .catch(() => {
        if (vivo) setError('No se pudo leer el stock del producto.');
      });
    return () => {
      vivo = false;
    };
  }, [abierto, producto, motivoInicial, ubicacionInicialId]);

  const actualEn = (id: string) => stock?.ubicaciones.find((u) => u.id === id)?.cantidad ?? 0;
  const nombreDe = (id: string) => stock?.ubicaciones.find((u) => u.id === id)?.nombre ?? '';
  const n = cantidad === '' ? 0 : cantidad;
  // Signo automático (§6.5): merma resta, ingreso suma, ajuste elige, traslado resta origen / suma destino.
  const firmado = motivo === 'merma' ? -n : motivo === 'ajuste' && resta ? -n : n;
  const origenNuevo = actualEn(ubicacionId) + (motivo === 'traslado' ? -n : firmado);
  const destinoNuevo = actualEn(destinoId) + n;

  const guardar = async () => {
    if (!producto) return;
    if (cantidad === '' || cantidad <= 0) {
      setError('La cantidad debe ser mayor que 0.');
      return;
    }
    if (nota.trim() === '') {
      setError('La nota es obligatoria: sin ella el movimiento no se puede auditar (M3).');
      return;
    }
    if (motivo === 'traslado' && (!destinoId || destinoId === ubicacionId)) {
      setError('Elige una ubicación de destino distinta del origen.');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      if (motivo === 'traslado') {
        await api('/stock/traslados', {
          method: 'POST',
          body: JSON.stringify({ productoId: producto.id, desdeUbicacionId: ubicacionId, hastaUbicacionId: destinoId, cantidad, nota: nota.trim() }),
        });
        onHecho(`Traslado de ${cantidad} × ${producto.nombre}: ${nombreDe(ubicacionId)} → ${nombreDe(destinoId)}.`);
      } else {
        const r = await api<{ cantidadNueva: number; encendido: boolean }>('/stock/movimientos', {
          method: 'POST',
          body: JSON.stringify({ productoId: producto.id, ubicacionId, cantidad: firmado, motivo, nota: nota.trim() }),
        });
        onHecho(
          `${ETIQUETA[motivo]} registrado: ${producto.nombre} queda en ${r.cantidadNueva} en ${nombreDe(ubicacionId)}.` +
            (r.encendido ? ' El producto ahora controla stock.' : ''),
        );
      }
      onCerrar();
    } catch (e) {
      if (e instanceof ErrorApi) {
        const codigo = e.codigo;
        setError(
          codigo === 'STOCK_INSUFICIENTE'
            ? `No hay stock suficiente: quedan ${String((e.cuerpo as { disponible?: number }).disponible ?? 0)}.`
            : codigo === 'SIN_CONTROL_STOCK'
            ? 'Este producto todavía no controla stock: primero un recuento o un ingreso.'
            : codigo === 'NOTA_REQUERIDA'
              ? 'La nota es obligatoria.'
              : `No se pudo registrar (${codigo}).${typeof e.cuerpo.detalle === 'string' ? ' ' + e.cuerpo.detalle : ''}`,
        );
      } else {
        setError('Sin conexión: los movimientos de stock necesitan el servidor.');
      }
    } finally {
      setGuardando(false);
    }
  };

  const opcionesUbic = (stock?.ubicaciones ?? []).map((u) => ({ valor: u.id, etiqueta: `${u.nombre} · ${u.cantidad}` }));

  return (
    <Dialogo abierto={abierto} titulo={producto ? `Stock · ${producto.nombre}` : 'Stock'} onCerrar={onCerrar} cerrable={!guardando} ancho={520}>
      {producto ? (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-chico text-lab3">{producto.sku}</p>
          <Segmentado<MotivoManual>
            opciones={(['ajuste', 'merma', 'compra', 'traslado'] as MotivoManual[]).map((m) => ({ valor: m, etiqueta: ETIQUETA[m] }))}
            valor={motivo}
            onChange={(m) => m && setMotivo(m)}
          />
          {stock && !stock.controlaStock && motivo !== 'compra' ? (
            <p className="text-chico text-alerta">
              Este producto no controla stock. Un <strong>Ingreso</strong> lo enciende; ajuste, merma y traslado exigen que ya controle.
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <SelectoLocal etiqueta={motivo === 'traslado' ? 'Desde' : 'Ubicación'} valor={ubicacionId} onValor={setUbicacionId} opciones={opcionesUbic} />
            {motivo === 'traslado' ? (
              <SelectoLocal etiqueta="Hacia" valor={destinoId} onValor={setDestinoId} opciones={opcionesUbic.filter((o) => o.valor !== ubicacionId)} />
            ) : (
              <div />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Campo
              etiqueta="Cantidad"
              type="number"
              inputMode="numeric"
              min={1}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
              autoFocus
            />
            {motivo === 'ajuste' ? (
              <div>
                <span className="mb-1 block text-chico text-lab2">Sentido</span>
                <Segmentado<'suma' | 'resta'>
                  opciones={[
                    { valor: 'suma', etiqueta: 'Sumar' },
                    { valor: 'resta', etiqueta: 'Restar' },
                  ]}
                  valor={resta ? 'resta' : 'suma'}
                  onChange={(v) => setResta(v === 'resta')}
                />
              </div>
            ) : (
              <div />
            )}
          </div>

          <Campo etiqueta="Nota (obligatoria)" value={nota} onChange={(e) => setNota(e.target.value)} placeholder={motivo === 'merma' ? 'Ej.: caja dañada' : motivo === 'compra' ? 'Ej.: llegó pedido proveedor' : 'Motivo del movimiento'} />

          {stock && n > 0 ? (
            <p className="text-chico text-lab2">
              {motivo === 'traslado' ? (
                <>
                  {nombreDe(ubicacionId)} pasará de <span className="num">{actualEn(ubicacionId)}</span> a{' '}
                  <span className={`num font-semibold ${origenNuevo < 0 ? 'text-peligro' : 'text-lab'}`}>{origenNuevo}</span>; {nombreDe(destinoId)} de{' '}
                  <span className="num">{actualEn(destinoId)}</span> a <span className="num font-semibold text-lab">{destinoNuevo}</span>.
                </>
              ) : (
                <>
                  {nombreDe(ubicacionId)} pasará de <span className="num">{actualEn(ubicacionId)}</span> a{' '}
                  <span className={`num font-semibold ${origenNuevo < 0 ? 'text-peligro' : 'text-lab'}`}>{origenNuevo}</span>.
                </>
              )}
              {origenNuevo < 0 ? ' No se puede: el stock no queda en negativo (R-014).' : ''}
            </p>
          ) : null}

          {error ? <p className="text-chico text-peligro">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Boton onClick={onCerrar} deshabilitado={guardando}>
              Cancelar
            </Boton>
            <Boton variante="principal" cargando={guardando} deshabilitado={!stock} onClick={() => void guardar()}>
              Registrar {ETIQUETA[motivo].toLowerCase()}
            </Boton>
          </div>
        </div>
      ) : null}
    </Dialogo>
  );
}

function SelectoLocal({ etiqueta, valor, onValor, opciones }: { etiqueta: string; valor: string; onValor: (v: string) => void; opciones: { valor: string; etiqueta: string }[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-chico text-lab2">{etiqueta}</span>
      <select value={valor} onChange={(e) => onValor(e.target.value)} className="h-tactil w-full rounded-campo border border-sep bg-bg px-3 text-cuerpo text-lab outline-none">
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>
    </label>
  );
}
