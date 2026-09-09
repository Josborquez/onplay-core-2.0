// V22 — Alertas de stock (03-SDD §8, C6): Negativos, Sin stock, Bajo mínimo y Web
// («último en la web» / «reservado para pedido web pagado», §6.9). Cada fila tiene acción directa:
// Ajustar (V21) o Recontar (nuevo recuento con ese producto).
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { Banner, Boton, Cargando, Insignia, Vacio } from '../../components/base.js';
import { DialogoMovimientoStock, type MotivoManual } from '../../components/DialogoMovimientoStock.js';
import { fecha } from '../../utils/formato.js';
import { Encabezado } from './util.js';

interface Fila {
  id: string;
  sku: string;
  nombre: string;
  stockMinimo: number;
  stockTotal: number | null;
  stockVenta: number | null;
  stockCanalMin: number | null;
}

interface FilaWeb extends Fila {
  canalId: string;
  stockCanal: number | null;
  stockCanalEn: string | null;
  nivel: 'reservado' | 'ultimo';
}

interface Respuesta {
  conteos: { negativos: number; quiebres: number; bajos: number; web: number };
  negativos: Fila[];
  quiebres: Fila[];
  bajos: Fila[];
  web: FilaWeb[];
}

export function Alertas() {
  const navigate = useNavigate();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState(false);
  const [aviso, setAviso] = useState('');
  const [dialogo, setDialogo] = useState<{ producto: Fila; motivo: MotivoManual } | null>(null);
  const [ubicacionVentaId, setUbicacionVentaId] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setError(false);
    api<Respuesta>('/stock/alertas')
      .then(setDatos)
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    cargar();
    void api<{ ubicaciones: { id: string; esVenta: boolean }[] }>('/ubicaciones')
      .then((r) => setUbicacionVentaId(r.ubicaciones.find((u) => u.esVenta)?.id ?? null))
      .catch(() => {});
  }, [cargar]);

  useEffect(() => {
    if (!aviso) return;
    const id = setTimeout(() => setAviso(''), 5000);
    return () => clearTimeout(id);
  }, [aviso]);

  // Recontar: crea un recuento en la ubicación de venta con solo ese producto y abre el detalle.
  const recontar = async (p: Fila) => {
    if (!ubicacionVentaId) return;
    try {
      const r = await api<{ id: string }>('/recuentos', {
        method: 'POST',
        body: JSON.stringify({ nombre: `Recuento ${p.sku} ${new Date().toISOString().slice(0, 10)}`, ubicacionId: ubicacionVentaId, productoIds: [p.id] }),
      });
      navigate(`/admin/recuentos/${r.id}`);
    } catch {
      setError(true);
    }
  };

  const Seccion = ({ titulo, tono, filas, vacio, extra }: { titulo: string; tono: 'peligro' | 'alerta' | 'neutro'; filas: Fila[]; vacio: string; extra?: (f: Fila) => React.ReactNode }) => (
    <section className="mb-4">
      <h2 className="mb-1 flex items-center gap-2 text-cuerpo font-semibold text-lab">
        {titulo}
        <Insignia tono={filas.length > 0 ? tono : 'ok'}>{filas.length}</Insignia>
      </h2>
      {filas.length === 0 ? (
        <p className="text-chico text-lab3">{vacio}</p>
      ) : (
        <ul className="divide-y divide-sep overflow-hidden rounded-tarjeta bg-bg shadow-tarjeta">
          {filas.map((f) => (
            <li key={`${f.id}-${(f as FilaWeb).canalId ?? ''}`} className="flex min-h-fila flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <Link to={`/admin/productos?q=${encodeURIComponent(f.nombre)}`} className="block truncate text-cuerpo text-lab underline-offset-2 hover:underline">
                  {f.nombre}
                </Link>
                <span className="block font-mono text-chico text-lab3">
                  {f.sku} · stock {f.stockTotal ?? '—'}
                  {f.stockMinimo > 0 ? ` · mínimo ${f.stockMinimo}` : ''}
                  {extra ? extra(f) : null}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <BotonChico onClick={() => void recontar(f)}>Recontar</BotonChico>
                <BotonChico onClick={() => setDialogo({ producto: f, motivo: 'ajuste' })}>Ajustar</BotonChico>
                <BotonChico onClick={() => setDialogo({ producto: f, motivo: 'compra' })}>Ingresar</BotonChico>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="p-4">
      <Encabezado
        titulo="Alertas de stock"
        extra={
          <Link to="/admin/stock" className="text-chico text-lab2 underline underline-offset-2">
            ← Stock
          </Link>
        }
      />
      {aviso ? (
        <div className="mb-3">
          <Banner tono="ok">{aviso}</Banner>
        </div>
      ) : null}
      {error ? (
        <div className="mb-3">
          <Banner tono="peligro" accion={<Boton onClick={cargar}>Reintentar</Boton>}>
            No se pudieron cargar las alertas.
          </Banner>
        </div>
      ) : null}
      {!datos ? (
        <Cargando />
      ) : datos.conteos.negativos + datos.conteos.quiebres + datos.conteos.bajos + datos.conteos.web === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje="Sin alertas. Todo lo que controla stock está en orden." />
        </div>
      ) : (
        <>
          <Seccion titulo="Negativos" tono="peligro" filas={datos.negativos} vacio="Ningún producto en negativo." />
          <Seccion titulo="Sin stock" tono="peligro" filas={datos.quiebres} vacio="Ningún quiebre." />
          <Seccion titulo="Bajo mínimo" tono="alerta" filas={datos.bajos} vacio="Nada bajo el mínimo." />
          <Seccion
            titulo="En la web"
            tono="alerta"
            filas={datos.web}
            vacio="La web no marca últimas unidades."
            extra={(f) => {
              const w = f as FilaWeb;
              return (
                <span className={w.nivel === 'reservado' ? 'text-peligro' : 'text-alerta'}>
                  {' · '}
                  {w.nivel === 'reservado' ? `agotado en ${w.canalId} con ${w.stockVenta} en tienda: reservado para un pedido web pagado` : `último en ${w.canalId}`}
                  {w.stockCanalEn ? ` (${fecha(w.stockCanalEn)})` : ''}
                </span>
              );
            }}
          />
        </>
      )}

      <DialogoMovimientoStock
        abierto={dialogo !== null}
        producto={dialogo?.producto ?? null}
        motivoInicial={dialogo?.motivo ?? 'ajuste'}
        ubicacionInicialId={ubicacionVentaId}
        onCerrar={() => setDialogo(null)}
        onHecho={(m) => {
          setAviso(m);
          cargar();
        }}
      />
    </div>
  );
}

function BotonChico({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-[32px] rounded border border-sep bg-bg px-2 text-chico text-lab2 hover:border-ac hover:text-lab">
      {children}
    </button>
  );
}
