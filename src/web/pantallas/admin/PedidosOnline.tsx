// V14 — Pedidos online (06-SDD §10, encargado+). PedidoCanal con número, canal, fecha,
// total, reembolsado, estado y cuántas líneas quedaron sin mapear. Al expandir, las líneas
// con su producto o el aviso, y «Vincular a un producto» → POST …/lineas/:lineaId/mapear.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ErrorApi, api } from '../../api.js';
import { Banner, Boton, Campo, Cargando, Dialogo, Insignia, Segmentado, Vacio } from '../../components/base.js';
import { clp, fecha, hora } from '../../utils/formato.js';
import { ETIQUETA_ESTADO_PEDIDO, NOMBRE_CANAL, type LineaPedido, type PedidoOnline, type RespuestaPedidos } from '../../tiposSync.js';
import { Encabezado, Paginacion } from './util.js';

interface ResultadoBusqueda {
  id: string;
  sku: string;
  nombre: string;
  precioVenta: number;
  controlaStock?: boolean;
}

export function PedidosOnline() {
  const [params, setParams] = useSearchParams();
  const [datos, setDatos] = useState<RespuestaPedidos | null>(null);
  const [canal, setCanal] = useState<string | null>(params.get('canalId'));
  const [soloSinMapear, setSoloSinMapear] = useState<'si' | null>(params.get('sinMapear') === 'true' ? 'si' : null);
  const [pagina, setPagina] = useState(1);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [mapeando, setMapeando] = useState<{ pedido: PedidoOnline; linea: LineaPedido } | null>(null);

  const cargar = useCallback(async () => {
    const p = new URLSearchParams({ pagina: String(pagina) });
    if (canal) p.set('canalId', canal);
    if (soloSinMapear) p.set('sinMapear', 'true');
    try {
      setDatos(await api<RespuestaPedidos>(`/sync/pedidos?${p}`));
      setError(null);
    } catch {
      setError('No se pudieron cargar los pedidos online.');
    }
  }, [pagina, canal, soloSinMapear]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (canal) p.set('canalId', canal);
    if (soloSinMapear) p.set('sinMapear', 'true');
    setParams(p, { replace: true });
  }, [canal, soloSinMapear, setParams]);

  return (
    <div className="p-4">
      <Encabezado titulo="Pedidos online" extra={datos ? <span className="num text-chico text-lab3">{datos.total} pedidos</span> : null} />
      {error ? (
        <div className="mb-3">
          <Banner tono="peligro">{error}</Banner>
        </div>
      ) : null}
      {aviso ? (
        <div className="mb-3">
          <Banner tono="ok">{aviso}</Banner>
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmentado
          opciones={[
            { valor: 'onplay_cl', etiqueta: 'onplay.cl' },
            { valor: 'onplaygames_cl', etiqueta: 'onplaygames.cl' },
          ]}
          valor={canal}
          onChange={(v) => {
            setCanal(v);
            setPagina(1);
          }}
        />
        <Segmentado
          opciones={[{ valor: 'si', etiqueta: 'Con líneas sin mapear' }]}
          valor={soloSinMapear}
          onChange={(v) => {
            setSoloSinMapear(v);
            setPagina(1);
          }}
        />
      </div>

      {datos === null ? (
        <Cargando />
      ) : datos.pedidos.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje={soloSinMapear ? 'Todas las líneas ingeridas tienen producto.' : 'Todavía no se ingirió ningún pedido. La ingesta se enciende por canal en Sincronización.'} />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-tarjeta bg-bg shadow-tarjeta">
            <table className="w-full text-cuerpo">
              <thead>
                <tr className="text-left text-chico text-lab3">
                  <th className="px-4 py-2">Pedido</th>
                  <th className="px-2 py-2">Canal</th>
                  <th className="px-2 py-2">Fecha</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2 text-right">Reembolsado</th>
                  <th className="px-2 py-2">Estado</th>
                  <th className="px-2 py-2">Cliente</th>
                  <th className="px-4 py-2 text-right">Sin mapear</th>
                </tr>
              </thead>
              <tbody>
                {datos.pedidos.map((p) => (
                  <Fila key={p.id} p={p} abierto={abierto === p.id} onToggle={() => setAbierto(abierto === p.id ? null : p.id)} onMapear={(linea) => setMapeando({ pedido: p, linea })} />
                ))}
              </tbody>
            </table>
          </div>
          <Paginacion pagina={pagina} porPagina={datos.porPagina} total={datos.total} onPagina={setPagina} />
        </>
      )}

      <DialogoMapear
        objetivo={mapeando}
        onCerrar={() => setMapeando(null)}
        onHecho={(msg) => {
          setAviso(msg);
          setMapeando(null);
          void cargar();
        }}
      />
    </div>
  );
}

function Fila({ p, abierto, onToggle, onMapear }: { p: PedidoOnline; abierto: boolean; onToggle: () => void; onMapear: (l: LineaPedido) => void }) {
  const tonoEstado = p.estadoCanal === 'completed' || p.estadoCanal === 'processing' ? 'ok' : p.estadoCanal === 'cancelled' || p.estadoCanal === 'refunded' ? 'peligro' : 'neutro';
  const anulado = p.discrepancias.some((d) => d.tipo === 'pedido_anulado');
  const sinStock = p.discrepancias.some((d) => d.tipo === 'pedido_sin_stock');
  return (
    <>
      <tr className="cursor-pointer border-t border-sep hover:bg-bg2" onClick={onToggle}>
        <td className="px-4 py-2 font-mono text-lab">#{p.numero}</td>
        <td className="px-2 py-2 text-lab2">{NOMBRE_CANAL[p.canalId] ?? p.canalId}</td>
        <td className="px-2 py-2 text-lab2">
          {fecha(p.creadoEnCanal)} {hora(p.creadoEnCanal)}
        </td>
        <td className="num px-2 py-2 text-right text-lab">{clp(p.total)}</td>
        <td className="num px-2 py-2 text-right text-lab2">{p.montoReembolsado > 0 ? clp(p.montoReembolsado) : '—'}</td>
        <td className="px-2 py-2">
          <div className="flex flex-wrap gap-1">
            <Insignia tono={tonoEstado}>{ETIQUETA_ESTADO_PEDIDO[p.estadoCanal] ?? p.estadoCanal}</Insignia>
            {anulado ? <Insignia tono="peligro">revisar anulación</Insignia> : null}
            {sinStock ? <Insignia tono="alerta">sin stock</Insignia> : null}
            {!p.ingeridoEn ? <Insignia>no ingerido</Insignia> : null}
          </div>
        </td>
        <td className="px-2 py-2 text-lab2">{p.cliente?.nombre ?? p.clienteEmail ?? 'invitado'}</td>
        <td className="num px-4 py-2 text-right">{p.sinMapear > 0 ? <Insignia tono="alerta">{p.sinMapear}</Insignia> : <span className="text-lab3">0</span>}</td>
      </tr>
      {abierto ? (
        <tr className="border-t border-sep bg-bg2">
          <td colSpan={8} className="px-4 py-3">
            <ul className="flex flex-col gap-2">
              {p.lineas.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-cuerpo text-lab">
                      <span className="num">{l.cantidad}×</span> {l.descripcion}
                      {l.cantidadDevuelta > 0 ? <span className="text-chico text-peligro"> · {l.cantidadDevuelta} devuelta(s)</span> : null}
                    </p>
                    <p className="text-chico text-lab3">
                      {l.externoSku ? `sku ${l.externoSku} · ` : ''}
                      {clp(l.precioUnitario)} c/u ·{' '}
                      {l.producto ? (
                        <span className="text-lab2">
                          {l.producto.sku} {l.producto.nombre}
                          {l.producto.controlaStock ? '' : ' · sin control de stock'}
                        </span>
                      ) : (
                        <span className="text-alerta">sin producto en el maestro</span>
                      )}
                    </p>
                  </div>
                  {!l.producto ? (
                    <Boton onClick={() => onMapear(l)} clase="w-[200px]">
                      Vincular a un producto
                    </Boton>
                  ) : null}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DialogoMapear({ objetivo, onCerrar, onHecho }: { objetivo: { pedido: PedidoOnline; linea: LineaPedido } | null; onCerrar: () => void; onHecho: (msg: string) => void }) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([]);
  const [elegido, setElegido] = useState<ResultadoBusqueda | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!objetivo) return;
    setQ(objetivo.linea.externoSku ?? '');
    setResultados([]);
    setElegido(null);
    setError('');
  }, [objetivo]);

  useEffect(() => {
    if (!objetivo || q.trim().length < 2) {
      setResultados([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ resultados: ResultadoBusqueda[] }>(`/productos/buscar?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setResultados(r.resultados.slice(0, 8)))
        .catch(() => setResultados([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, objetivo]);

  const confirmar = async () => {
    if (!objetivo || !elegido) return;
    setEnviando(true);
    setError('');
    try {
      const r = await api<{ movimientoId: string | null; cantidadNueva: number | null }>(
        `/sync/pedidos/${objetivo.pedido.id}/lineas/${objetivo.linea.id}/mapear`,
        { method: 'POST', body: JSON.stringify({ productoId: elegido.id }) },
      );
      onHecho(
        r.movimientoId
          ? `Línea vinculada a ${elegido.sku}. Se descontó el stock del pedido: queda ${r.cantidadNueva} en la ubicación online.`
          : `Línea vinculada a ${elegido.sku}.`,
      );
    } catch (e) {
      setError(e instanceof ErrorApi ? (e.codigo === 'LINEA_YA_MAPEADA' ? 'Esa línea ya tiene producto.' : `No se pudo vincular (${e.codigo}).`) : 'Sin conexión.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo abierto={objetivo !== null} titulo="Vincular a un producto" onCerrar={onCerrar} cerrable={!enviando} ancho={520}>
      {objetivo ? (
        <div className="flex flex-col gap-3">
          <p className="text-cuerpo text-lab">
            <span className="num">{objetivo.linea.cantidad}×</span> {objetivo.linea.descripcion}
            {objetivo.linea.externoSku ? <span className="text-chico text-lab3"> · sku {objetivo.linea.externoSku}</span> : null}
          </p>
          <Campo etiqueta="Buscar producto del maestro" value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="SKU, nombre o código de barras" />
          {resultados.length > 0 ? (
            <ul className="max-h-[260px] divide-y divide-sep overflow-y-auto rounded-campo border border-sep">
              {resultados.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setElegido(r)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left ${elegido?.id === r.id ? 'bg-bg3 font-semibold' : ''}`}
                  >
                    <span className="text-cuerpo text-lab">
                      <span className="font-mono text-chico text-lab3">{r.sku}</span> {r.nombre}
                    </span>
                    <span className="num text-chico text-lab2">{clp(r.precioVenta)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : q.trim().length >= 2 ? (
            <p className="text-chico text-lab3">Sin resultados.</p>
          ) : null}
          {elegido ? (
            <p className="text-chico text-lab2">
              Se vinculará a <span className="font-mono">{elegido.sku}</span>.{' '}
              {elegido.controlaStock === false ? 'El producto no controla stock: no se descuenta nada.' : 'Si el producto controla stock y el pedido está pagado, se descuenta ahora lo que la ingesta no pudo.'}
            </p>
          ) : null}
          {error ? <p className="text-chico text-peligro">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Boton onClick={onCerrar} deshabilitado={enviando}>
              Cancelar
            </Boton>
            <Boton variante="principal" cargando={enviando} deshabilitado={!elegido} onClick={() => void confirmar()}>
              Vincular
            </Boton>
          </div>
        </div>
      ) : null}
    </Dialogo>
  );
}
