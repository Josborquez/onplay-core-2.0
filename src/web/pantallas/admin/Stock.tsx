// V19 — Stock (03-SDD §8): tabla de stock actual con filtros por ubicación, estado, categoría y
// texto; acciones por fila (Ajustar, Merma, Ingresar, Trasladar → V21). Solo productos con control,
// salvo el filtro «Sin control», que sirve para encender por ingreso.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, descargar } from '../../api.js';
import { categorias } from '../../catalogo.js';
import { Banner, Boton, Cargando, Insignia, Segmentado, Vacio } from '../../components/base.js';
import { DialogoMovimientoStock, type MotivoManual } from '../../components/DialogoMovimientoStock.js';
import { ETIQUETA_TIPO, type EstadoStock, type TipoProducto } from '../../tipos.js';
import { clp } from '../../utils/formato.js';
import { aplanarCategorias, Encabezado, Paginacion, Selecto, type OpcionCategoria } from './util.js';

interface FilaStock {
  id: string;
  sku: string;
  nombre: string;
  tipo: TipoProducto;
  imagenUrl: string | null;
  controlaStock: boolean;
  stockMinimo: number;
  precioVenta: number;
  stockTotal: number | null;
  stockVenta: number | null;
  stockCanalMin: number | null;
  estadoStock: EstadoStock;
  stockUbicacion?: number;
}

interface Respuesta {
  productos: FilaStock[];
  total: number;
  pagina: number;
  porPagina: number;
}

interface Ubicacion {
  id: string;
  codigo: string;
  nombre: string;
  esVenta: boolean;
}

const ESTADOS: { valor: EstadoStock; etiqueta: string }[] = [
  { valor: 'negativo', etiqueta: 'Negativo' },
  { valor: 'quiebre', etiqueta: 'Sin stock' },
  { valor: 'bajo', etiqueta: 'Bajo mínimo' },
  { valor: 'ok', etiqueta: 'OK' },
  { valor: 'sin_control', etiqueta: 'Sin control' },
];

function InsigniaEstado({ e }: { e: EstadoStock }) {
  if (e === 'negativo') return <Insignia tono="peligro">negativo</Insignia>;
  if (e === 'quiebre') return <Insignia tono="peligro">sin stock</Insignia>;
  if (e === 'bajo') return <Insignia tono="alerta">bajo</Insignia>;
  if (e === 'sin_control') return <Insignia>sin control</Insignia>;
  return <Insignia tono="ok">ok</Insignia>;
}

export function Stock() {
  const [q, setQ] = useState('');
  const [ubicacionId, setUbicacionId] = useState('');
  const [estado, setEstado] = useState<EstadoStock | null>(null);
  const [categoriaId, setCategoriaId] = useState('');
  const [pagina, setPagina] = useState(1);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [opcionesCategoria, setOpcionesCategoria] = useState<OpcionCategoria[]>([]);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState(false);
  const [aviso, setAviso] = useState('');
  const [dialogo, setDialogo] = useState<{ producto: FilaStock; motivo: MotivoManual } | null>(null);
  const [conteoAlertas, setConteoAlertas] = useState<number | null>(null);

  useEffect(() => {
    void categorias().then((arbol) => setOpcionesCategoria(aplanarCategorias(arbol)));
    void api<{ ubicaciones: Ubicacion[] }>('/ubicaciones').then((r) => setUbicaciones(r.ubicaciones)).catch(() => {});
    void api<{ conteos: { negativos: number; quiebres: number; bajos: number; web: number } }>('/stock/alertas')
      .then((r) => setConteoAlertas(r.conteos.negativos + r.conteos.quiebres + r.conteos.bajos + r.conteos.web))
      .catch(() => {});
  }, []);

  useEffect(() => setPagina(1), [q, ubicacionId, estado, categoriaId]);

  const cargar = useCallback(() => {
    const p = new URLSearchParams({ pagina: String(pagina), limit: '50' });
    if (q.trim().length >= 2) p.set('q', q.trim());
    if (ubicacionId) p.set('ubicacionId', ubicacionId);
    if (estado) p.set('estado', estado);
    if (categoriaId) p.set('categoriaId', categoriaId);
    setError(false);
    const id = setTimeout(() => {
      api<Respuesta>(`/stock?${p}`)
        .then(setDatos)
        .catch(() => setError(true));
    }, 250);
    return () => clearTimeout(id);
  }, [q, ubicacionId, estado, categoriaId, pagina]);
  useEffect(cargar, [cargar]);

  useEffect(() => {
    if (!aviso) return;
    const id = setTimeout(() => setAviso(''), 5000);
    return () => clearTimeout(id);
  }, [aviso]);

  const abrir = (producto: FilaStock, motivo: MotivoManual) => setDialogo({ producto, motivo });
  const ubicacionNombre = ubicaciones.find((u) => u.id === ubicacionId)?.nombre;

  return (
    <div className="p-4">
      <Encabezado
        titulo="Stock"
        extra={
          <span className="flex items-center gap-3">
            <Link to="/admin/stock/alertas" className="text-chico text-lab2 underline underline-offset-2">
              Alertas{conteoAlertas !== null ? ` (${conteoAlertas})` : ''}
            </Link>
            <button
              type="button"
              onClick={() =>
                void descargar(`/stock/export.csv${ubicacionId ? `?ubicacionId=${ubicacionId}` : ''}`, `stock-${new Date().toISOString().slice(0, 10)}.csv`).catch(() =>
                  setError(true),
                )
              }
              className="text-chico text-lab2 underline underline-offset-2"
            >
              Exportar CSV
            </button>
            <Link to="/admin/recuentos" className="text-chico text-lab2 underline underline-offset-2">
              Recuentos →
            </Link>
          </span>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-[240px]">
          <label className="mb-1 block text-chico text-lab2" htmlFor="buscar-stock">
            Buscar
          </label>
          <input
            id="buscar-stock"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre del producto…"
            className="h-tactil w-full rounded-campo border border-sep bg-bg px-3 text-cuerpo text-lab outline-none"
          />
        </div>
        <div className="w-[180px]">
          <Selecto etiqueta="Ubicación" valor={ubicacionId} onValor={setUbicacionId} opciones={ubicaciones.map((u) => ({ valor: u.id, etiqueta: u.nombre }))} vacia="Todas (total)" />
        </div>
        <div className="w-[220px]">
          <Selecto etiqueta="Categoría" valor={categoriaId} onValor={setCategoriaId} opciones={opcionesCategoria.map((c) => ({ valor: c.id, etiqueta: c.etiqueta }))} vacia="Todas" />
        </div>
        <div className="max-w-full overflow-x-auto">
          <Segmentado<EstadoStock> opciones={ESTADOS} valor={estado} onChange={setEstado} />
        </div>
      </div>

      {aviso ? (
        <div className="mb-3">
          <Banner tono="ok">{aviso}</Banner>
        </div>
      ) : null}
      {error ? (
        <div className="mb-3">
          <Banner tono="peligro" accion={<Boton onClick={cargar}>Reintentar</Boton>}>
            No se pudo cargar el stock. Revisa la conexión y vuelve a intentar.
          </Banner>
        </div>
      ) : null}

      {datos === null ? (
        <Cargando />
      ) : datos.productos.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio
            mensaje={
              estado === 'sin_control'
                ? 'Todos los productos de este filtro ya controlan stock.'
                : 'Ningún producto controla stock con estos filtros. Haz un recuento para empezar (activación gradual, P4).'
            }
            accion={
              <Link to="/admin/recuentos" className="text-cuerpo text-lab underline">
                Nuevo recuento
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <p className="mb-2 text-chico text-lab3" aria-live="polite">
            {datos.total} producto{datos.total === 1 ? '' : 's'}
            {ubicacionNombre ? ` · cantidad en ${ubicacionNombre}` : ' · cantidad total (todas las ubicaciones)'}
          </p>
          <div className="hidden items-center gap-3 px-3 pb-1 text-chico text-lab3 sm:flex">
            <span className="flex-1">Producto</span>
            <span className="w-[80px] shrink-0 text-right">Cantidad</span>
            <span className="w-[64px] shrink-0 text-right">Mínimo</span>
            <span className="w-[104px] shrink-0">Estado</span>
            <span className="w-[300px] shrink-0">Acciones</span>
          </div>
          <ul className="divide-y divide-sep overflow-hidden rounded-tarjeta bg-bg shadow-tarjeta">
            {datos.productos.map((p) => {
              const cantidad = ubicacionId ? p.stockUbicacion ?? 0 : p.stockTotal;
              return (
                <li key={p.id} className="flex min-h-fila flex-wrap items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-cuerpo ${p.controlaStock ? 'text-lab' : 'text-lab3'}`}>{p.nombre}</span>
                    <span className="block font-mono text-chico text-lab3">
                      {p.sku} · {ETIQUETA_TIPO[p.tipo]} · {clp(p.precioVenta)}
                      {p.stockCanalMin != null ? ` · en la web: ${p.stockCanalMin}` : ''}
                    </span>
                  </span>
                  <span className={`num w-[80px] shrink-0 text-right text-cuerpo font-semibold ${cantidad != null && cantidad < 0 ? 'text-peligro' : 'text-lab'}`}>
                    {cantidad ?? '—'}
                  </span>
                  <span className="num w-[64px] shrink-0 text-right text-chico text-lab3">{p.stockMinimo || '—'}</span>
                  <span className="w-[104px] shrink-0">
                    <InsigniaEstado e={p.estadoStock} />
                  </span>
                  <span className="flex w-[300px] shrink-0 flex-wrap gap-1">
                    {p.controlaStock ? (
                      <>
                        <BotonChico onClick={() => abrir(p, 'ajuste')}>Ajustar</BotonChico>
                        <BotonChico onClick={() => abrir(p, 'merma')}>Merma</BotonChico>
                        <BotonChico onClick={() => abrir(p, 'compra')}>Ingresar</BotonChico>
                        <BotonChico onClick={() => abrir(p, 'traslado')}>Trasladar</BotonChico>
                      </>
                    ) : (
                      <BotonChico onClick={() => abrir(p, 'compra')}>Ingresar y encender</BotonChico>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <Paginacion pagina={datos.pagina} porPagina={datos.porPagina} total={datos.total} onPagina={setPagina} />
        </>
      )}

      <DialogoMovimientoStock
        abierto={dialogo !== null}
        producto={dialogo?.producto ?? null}
        motivoInicial={dialogo?.motivo ?? 'ajuste'}
        ubicacionInicialId={ubicacionId || null}
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
