// V5 — Productos (05-SDD §7, ajustado por R-009): tabla o grilla paginadas por número de
// página, 50 por página, con total (§14 H5 resuelto en la API). NUNCA se carga el catálogo
// completo. Sin filtro por canal (§14 H4). Clic en un producto → modal con la ficha completa
// (imagen, datos, atributos, canales); el precio se cambia desde ahí o desde la fila.
// Stock: en E1/E4 solo existe `controlaStock`; la cantidad por ubicación llega en E2.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ErrorApi } from '../../api.js';
import { categorias } from '../../catalogo.js';
import { useEnLinea } from '../../tema.js';
import { ETIQUETA_TIPO, type ProductoAdmin, type TipoProducto } from '../../tipos.js';
import { clp, fecha } from '../../utils/formato.js';
import {
  Banner,
  Boton,
  Campo,
  CampoMonto,
  Cargando,
  ConmutadorVista,
  Dialogo,
  Insignia,
  Segmentado,
  Vacio,
  type Vista,
} from '../../components/base.js';
import { aplanarCategorias, Encabezado, Paginacion, Selecto, type OpcionCategoria } from './util.js';

interface CanalProducto {
  canalId: string;
  externoId: number | null;
  externoSku: string | null;
  publicado: boolean;
  precioCanal: number | null;
  sincronizadoEn: string | null;
}

interface DetalleProducto extends ProductoAdmin {
  atributos: Record<string, string> | null;
  categoria: { id: string; nombre: string } | null;
  canales: CanalProducto[];
  creadoEn: string;
}

interface RespuestaProductos {
  productos: ProductoAdmin[];
  total: number;
  pagina: number;
  porPagina: number;
}

const POR_PAGINA = 50;
const CLAVE_VISTA = 'onplay.productos-vista';

/** Nombre legible de los valores de `juego` (string libre en el dominio). */
const ETIQUETA_JUEGO: Record<string, string> = {
  magic: 'Magic',
  pokemon: 'Pokémon',
  one_piece: 'One Piece',
  star_wars: 'Star Wars',
  flesh_and_blood: 'Flesh and Blood',
  riftbound: 'Riftbound',
};

const OPCIONES_TIPO = (Object.keys(ETIQUETA_TIPO) as TipoProducto[]).map((t) => ({
  valor: t,
  etiqueta: ETIQUETA_TIPO[t],
}));

/** Etiquetas en castellano de las claves conocidas de `atributos` (02-SDD §4.2 + R-003). */
const ETIQUETA_ATRIBUTO: Record<string, string> = {
  variante: 'Variante',
  padreExternoId: 'Producto padre en el canal',
  set_code: 'Set',
  set_full_code: 'Set (código completo)',
  rarity: 'Rareza',
  rarity_code: 'Rareza (código)',
  is_foil: 'Foil',
  is_alt_art: 'Arte alternativo',
  color: 'Color',
  card_type: 'Tipo de carta',
  condicion: 'Condición',
  idioma: 'Idioma',
  scryfall_id: 'Scryfall',
  formato: 'Formato',
  sabor: 'Sabor',
};

function vistaGuardada(): Vista {
  try {
    return localStorage.getItem(CLAVE_VISTA) === 'grilla' ? 'grilla' : 'lista';
  } catch {
    return 'lista';
  }
}

/* ---------- piezas visuales ---------- */

function Imagen({ src, alt, clase }: { src: string | null; alt: string; clase: string }) {
  const [rota, setRota] = useState(false);
  useEffect(() => setRota(false), [src]);
  if (!src || rota) {
    return (
      <div aria-hidden="true" className={`flex items-center justify-center bg-bg2 text-lab3 ${clase}`}>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setRota(true)} className={`bg-bg2 object-cover ${clase}`} />;
}

function TextoStock({ p }: { p: ProductoAdmin }) {
  // E2 §6.2: total con insignia de estado; el espejo del canal se etiqueta «en la web» (RI3).
  if (!p.controlaStock || p.stockTotal == null) {
    return (
      <span className="text-lab3" title="No controla stock (P4). Se enciende con un recuento (M5).">
        No controla
      </span>
    );
  }
  const tono = p.estadoStock === 'negativo' || p.estadoStock === 'quiebre' ? 'text-peligro' : p.estadoStock === 'bajo' ? 'text-alerta' : 'text-lab';
  const etiqueta = { negativo: 'negativo', quiebre: 'sin stock', bajo: 'bajo', ok: '', sin_control: '' }[p.estadoStock];
  return (
    <span className={`num ${tono}`} title={p.stockMinimo > 0 ? `Mínimo ${p.stockMinimo}` : undefined}>
      {p.stockTotal}
      {etiqueta ? ` · ${etiqueta}` : ''}
      {p.stockCanalMin != null && p.stockCanalMin <= 0 ? ' · agotado en la web' : p.stockCanalMin === 1 ? ' · último en la web' : ''}
    </span>
  );
}

interface StockDetalle {
  ubicaciones: { id: string; codigo: string; nombre: string; esVenta: boolean; cantidad: number }[];
  canales: { canalId: string; publicado: boolean; stockCanal: number | null; manejaStockCanal: boolean | null; stockCanalEn: string | null }[];
}

interface MovimientoKardex {
  id: string;
  cantidad: number;
  motivo: string;
  referenciaTipo: string | null;
  nota: string | null;
  creadoEn: string;
  ubicacion: { codigo: string; nombre: string };
  usuario: { nombre: string };
}

const ETIQUETA_MOTIVO: Record<string, string> = {
  recuento_inicial: 'Recuento inicial',
  compra: 'Ingreso',
  venta: 'Venta',
  venta_online: 'Venta online',
  ajuste: 'Ajuste',
  merma: 'Merma',
  devolucion: 'Devolución',
  traslado: 'Traslado',
};

/** Kardex (C10): movimientos del producto, más nuevos primero, con saldo corriente por ubicación. */
function Kardex({ productoId }: { productoId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState<{ movimientos: MovimientoKardex[]; total: number } | null>(null);
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    api<{ movimientos: MovimientoKardex[]; total: number }>(`/productos/${productoId}/movimientos?limit=100`)
      .then((r) => {
        if (vivo) setDatos(r);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [abierto, productoId]);
  useEffect(() => {
    setAbierto(false);
    setDatos(null);
  }, [productoId]);
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="text-chico text-lab2 underline underline-offset-2">
        {abierto ? 'Ocultar movimientos' : 'Ver movimientos'}
      </button>
      {abierto ? (
        !datos ? (
          <Cargando texto="Cargando movimientos…" />
        ) : datos.movimientos.length === 0 ? (
          <p className="mt-1 text-chico text-lab3">Sin movimientos todavía.</p>
        ) : (
          <ul className="mt-2 max-h-[240px] divide-y divide-sep overflow-y-auto rounded-campo border border-sep">
            {datos.movimientos.map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-2 py-1 text-chico">
                <span className="w-[88px] shrink-0 text-lab3">{fecha(m.creadoEn)}</span>
                <span className="min-w-0 flex-1 truncate text-lab">
                  {ETIQUETA_MOTIVO[m.motivo] ?? m.motivo} · {m.ubicacion.nombre}
                  {m.nota ? ` · ${m.nota}` : ''}
                </span>
                <span className="shrink-0 text-lab3">{m.usuario.nombre}</span>
                <span className={`num w-[48px] shrink-0 text-right font-semibold ${m.cantidad < 0 ? 'text-peligro' : 'text-ok'}`}>
                  {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                </span>
              </li>
            ))}
            {datos.total > datos.movimientos.length ? (
              <li className="px-2 py-1 text-chico text-lab3">Se muestran {datos.movimientos.length} de {datos.total}.</li>
            ) : null}
          </ul>
        )
      ) : null}
    </div>
  );
}

/** Desglose por ubicación y espejo del canal (E2 §6.2, §6.8), solo si controla stock. */
function DesgloseStock({ productoId, controlaStock }: { productoId: string; controlaStock: boolean }) {
  const [d, setD] = useState<StockDetalle | null>(null);
  useEffect(() => {
    setD(null);
    let vivo = true;
    api<StockDetalle>(`/productos/${productoId}/stock`)
      .then((r) => {
        if (vivo) setD(r);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [productoId]);
  if (!d) return null;
  const conEspejo = d.canales.filter((c) => c.manejaStockCanal && c.stockCanal !== null);
  return (
    <>
      {controlaStock ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {d.ubicaciones.map((u) => (
            <span key={u.id} className="rounded border border-sep bg-bg2 px-2 py-1 text-chico text-lab">
              {u.nombre}
              {u.esVenta ? ' (venta)' : ''}: <span className={`num font-semibold ${u.cantidad < 0 ? 'text-peligro' : ''}`}>{u.cantidad}</span>
            </span>
          ))}
        </div>
      ) : null}
      {conEspejo.length > 0 ? (
        <p className="mt-2 text-chico text-lab3">
          En la web:{' '}
          {conEspejo.map((c) => `${c.canalId} ${c.stockCanal}${c.stockCanalEn ? ` (${fecha(c.stockCanalEn)})` : ''}`).join(' · ')}
          . Solo lectura: no se suma al stock propio.
        </p>
      ) : null}
      {controlaStock ? <Kardex productoId={productoId} /> : null}
    </>
  );
}

function Insignias({ p }: { p: ProductoAdmin }) {
  return (
    <>
      {p.posibleDuplicado ? <Insignia tono="alerta">⚠ posible duplicado</Insignia> : null}
      {!p.activo ? <Insignia>inactivo</Insignia> : null}
    </>
  );
}

function FilaProducto({
  producto: p,
  onAbrir,
  onCambiarPrecio,
}: {
  producto: ProductoAdmin;
  onAbrir: (p: ProductoAdmin) => void;
  onCambiarPrecio: (p: ProductoAdmin) => void;
}) {
  return (
    <li className="flex min-h-fila w-full items-center gap-3 px-3 py-2">
      <button
        type="button"
        onClick={() => onAbrir(p)}
        aria-label={`Ver ficha de ${p.nombre}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <Imagen src={p.imagenUrl} alt="" clase="h-[40px] w-[40px] shrink-0 rounded border border-sep" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`truncate text-cuerpo ${p.activo ? 'text-lab' : 'text-lab3'}`}>{p.nombre}</span>
            <Insignias p={p} />
          </span>
          <span className="block font-mono text-chico text-lab3">
            {p.sku}
            {p.cardNumber ? ` · ${p.cardNumber}` : ''}
            {p.codigoBarras ? ` · ${p.codigoBarras}` : ''}
          </span>
        </span>
      </button>
      <span className="hidden w-[112px] shrink-0 text-chico text-lab2 sm:block">{ETIQUETA_TIPO[p.tipo]}</span>
      <span className="hidden w-[128px] shrink-0 text-chico md:block">
        <TextoStock p={p} />
      </span>
      <button
        type="button"
        onClick={() => onCambiarPrecio(p)}
        className="num w-[96px] shrink-0 rounded px-1 text-right text-cuerpo text-lab underline decoration-dotted underline-offset-4"
        aria-label={`Cambiar el precio de ${p.nombre}`}
      >
        {clp(p.precioVenta)}
      </button>
    </li>
  );
}

function TarjetaProducto({ producto: p, onAbrir }: { producto: ProductoAdmin; onAbrir: (p: ProductoAdmin) => void }) {
  return (
    <button
      type="button"
      onClick={() => onAbrir(p)}
      aria-label={`Ver ficha de ${p.nombre}`}
      className="flex flex-col overflow-hidden rounded-tarjeta border border-sep bg-bg text-left transition-all active:scale-[0.98]"
    >
      <Imagen src={p.imagenUrl} alt="" clase="aspect-square w-full border-b border-sep" />
      <span className="flex flex-1 flex-col gap-1 p-2">
        <span className={`text-cuerpo font-medium leading-tight line-clamp-2 ${p.activo ? 'text-lab' : 'text-lab3'}`}>{p.nombre}</span>
        <span className="font-mono text-chico text-lab3">{p.sku}</span>
        <span className="mt-auto flex items-center justify-between gap-1">
          <span className="num font-semibold text-cuerpo text-lab">{clp(p.precioVenta)}</span>
          <span className="flex gap-1">
            <Insignias p={p} />
          </span>
        </span>
      </span>
    </button>
  );
}

/* ---------- modal de detalle ---------- */

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-sep py-1 last:border-b-0">
      <dt className="shrink-0 text-chico text-lab3">{etiqueta}</dt>
      <dd className="min-w-0 text-right text-chico text-lab">{children}</dd>
    </div>
  );
}

function DetalleProductoModal({
  producto,
  categoriaNombre,
  onCerrar,
  onCambiarPrecio,
}: {
  producto: ProductoAdmin | null;
  categoriaNombre: (id: string | null) => string;
  onCerrar: () => void;
  onCambiarPrecio: (p: ProductoAdmin) => void;
}) {
  const [detalle, setDetalle] = useState<DetalleProducto | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    setDetalle(null);
    setFallo(false);
    if (!producto) return;
    let vivo = true;
    api<DetalleProducto>(`/productos/${producto.id}`)
      .then((d) => {
        if (vivo) setDetalle(d);
      })
      .catch(() => {
        if (vivo) setFallo(true);
      });
    return () => {
      vivo = false;
    };
  }, [producto]);

  const p = detalle ?? producto;
  const atributos = Object.entries(detalle?.atributos ?? {});

  return (
    <Dialogo abierto={producto !== null} titulo="Ficha del producto" onCerrar={onCerrar} ancho={720}>
      {p ? (
        <div className="flex flex-col gap-4 sm:flex-row">
          <Imagen src={p.imagenUrl} alt={p.nombre} clase="aspect-square w-full shrink-0 rounded-tarjeta border border-sep sm:w-[240px]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-cuerpo font-semibold text-lab">{p.nombre}</h2>
              <Insignias p={p} />
            </div>
            <p className="mt-1 font-mono text-chico text-lab3">{p.sku}</p>

            <div className="mt-3 flex items-center justify-between rounded-campo bg-bg2 px-3 py-2">
              <span className="text-chico text-lab2">Precio de venta</span>
              <span className="flex items-center gap-2">
                <span className="num text-tit text-lab">{clp(p.precioVenta)}</span>
                <Boton clase="w-[112px]" onClick={() => onCambiarPrecio(p)}>
                  Cambiar
                </Boton>
              </span>
            </div>

            <dl className="mt-3">
              <Dato etiqueta="Tipo">{ETIQUETA_TIPO[p.tipo]}</Dato>
              {p.juego ? <Dato etiqueta="Juego">{p.juego}</Dato> : null}
              <Dato etiqueta="Categoría">{detalle?.categoria?.nombre ?? categoriaNombre(p.categoriaId)}</Dato>
              <Dato etiqueta="Stock">
                <TextoStock p={p} />
              </Dato>
              <DesgloseStock productoId={p.id} controlaStock={p.controlaStock} />
              {p.codigoBarras ? (
                <Dato etiqueta="Código de barras">
                  <span className="font-mono">{p.codigoBarras}</span>
                </Dato>
              ) : null}
              {p.cardNumber ? (
                <Dato etiqueta="Nº de carta">
                  <span className="font-mono">{p.cardNumber}</span>
                </Dato>
              ) : null}
              {atributos.map(([clave, valor]) => (
                <Dato key={clave} etiqueta={ETIQUETA_ATRIBUTO[clave] ?? clave}>
                  {String(valor)}
                </Dato>
              ))}
              <Dato etiqueta="Estado">{p.activo ? 'Activo' : 'Inactivo'}</Dato>
              <Dato etiqueta="Actualizado">{fecha(p.actualizadoEn)}</Dato>
            </dl>

            <p className="mb-1 mt-3 text-chico text-lab3">Canales</p>
            {fallo ? (
              <p className="text-chico text-peligro">No se pudo cargar el detalle. Revisa la conexión.</p>
            ) : !detalle ? (
              <Cargando texto="Cargando canales…" />
            ) : detalle.canales.length === 0 ? (
              <p className="text-chico text-lab2">Solo en la tienda física: no está publicado en ningún canal.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {detalle.canales.map((c) => (
                  <li key={c.canalId} className="flex flex-wrap items-center gap-2 text-chico text-lab2">
                    <Insignia tono={c.publicado ? 'ok' : 'neutro'}>{c.canalId}</Insignia>
                    {c.externoSku ? <span className="font-mono">{c.externoSku}</span> : null}
                    {c.externoId !== null ? <span className="text-lab3">id {c.externoId}</span> : null}
                    {c.precioCanal !== null ? <span className="num">{clp(c.precioCanal)}</span> : null}
                    {!c.publicado ? <span className="text-lab3">despublicado</span> : null}
                    {c.sincronizadoEn ? <span className="text-lab3">sync {fecha(c.sincronizadoEn)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </Dialogo>
  );
}

/* ---------- pantalla ---------- */

export function Productos() {
  const [parametros] = useSearchParams();
  const [q, setQ] = useState(parametros.get('q') ?? '');
  const [tipo, setTipo] = useState('');
  const [juego, setJuego] = useState('');
  const [juegos, setJuegos] = useState<{ juego: string; productos: number }[]>([]);
  const [categoriaId, setCategoriaId] = useState('');
  const [soloDuplicados, setSoloDuplicados] = useState<'si' | null>(null);
  const [actividad, setActividad] = useState<'activos' | 'inactivos' | null>(null);
  const [opcionesCategoria, setOpcionesCategoria] = useState<OpcionCategoria[]>([]);
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<RespuestaProductos | null>(null);
  const [vista, setVista] = useState<Vista>(vistaGuardada);
  const [error, setError] = useState(false);
  const [abierto, setAbierto] = useState<ProductoAdmin | null>(null);
  const [editando, setEditando] = useState<ProductoAdmin | null>(null);
  const [precioNuevo, setPrecioNuevo] = useState<number | ''>('');
  const [guardando, setGuardando] = useState(false);
  const enLinea = useEnLinea();

  useEffect(() => {
    void categorias().then((arbol) => setOpcionesCategoria(aplanarCategorias(arbol)));
    void api<{ juegos: { juego: string; productos: number }[] }>('/productos/juegos')
      .then((r) => setJuegos(r.juegos))
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_VISTA, vista);
    } catch {
      /* sin almacenamiento: la preferencia dura la sesión */
    }
  }, [vista]);

  const consulta = useCallback(
    (pag: number) => {
      const p = new URLSearchParams({ limit: String(POR_PAGINA), pagina: String(pag) });
      if (q.trim().length >= 2) p.set('q', q.trim());
      if (tipo) p.set('tipo', tipo);
      if (juego) p.set('juego', juego);
      if (categoriaId) p.set('categoriaId', categoriaId);
      if (soloDuplicados) p.set('posibleDuplicado', 'true');
      if (actividad) p.set('activo', actividad === 'activos' ? 'true' : 'false');
      return api<RespuestaProductos>(`/productos?${p}`);
    },
    [q, tipo, juego, categoriaId, soloDuplicados, actividad],
  );

  // Cualquier filtro vuelve a la página 1.
  useEffect(() => setPagina(1), [consulta]);

  // Carga de la página actual, con debounce por el texto.
  const generacion = useRef(0);
  const cargar = useCallback(() => {
    const mia = ++generacion.current;
    setError(false);
    const id = setTimeout(() => {
      consulta(pagina)
        .then((r) => {
          if (generacion.current === mia) setDatos(r);
        })
        .catch(() => {
          if (generacion.current === mia) setError(true);
        });
    }, 300);
    return () => clearTimeout(id);
  }, [consulta, pagina]);
  useEffect(cargar, [cargar]);

  const categoriaNombre = (id: string | null) =>
    (id && opcionesCategoria.find((c) => c.id === id)?.etiqueta) || 'Sin clasificar';

  const abrirCambioPrecio = (p: ProductoAdmin) => {
    setEditando(p);
    setPrecioNuevo(p.precioVenta);
  };

  // Cambiar el precio pide confirmación con valor anterior y nuevo: acción auditada (V5).
  const confirmarPrecio = async () => {
    if (!editando || precioNuevo === '') return;
    setGuardando(true);
    try {
      const actualizado = await api<ProductoAdmin>(`/productos/${editando.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ precioVenta: precioNuevo }),
      });
      const aplicar = (p: ProductoAdmin) => (p.id === actualizado.id ? { ...p, precioVenta: actualizado.precioVenta } : p);
      setDatos((prev) => (prev ? { ...prev, productos: prev.productos.map(aplicar) } : prev));
      setAbierto((prev) => (prev ? aplicar(prev) : prev));
      setEditando(null);
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'PRECIO_INVALIDO') setPrecioNuevo('');
      else setError(true);
    } finally {
      setGuardando(false);
    }
  };

  const desde = datos ? (datos.pagina - 1) * datos.porPagina + 1 : 0;
  const hasta = datos ? Math.min(datos.total, desde + datos.productos.length - 1) : 0;

  return (
    <div className="p-4">
      <Encabezado titulo="Productos" extra={<ConmutadorVista vista={vista} onChange={setVista} />} />

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-[256px]">
          <Campo etiqueta="Buscar" placeholder="Nombre del producto…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="w-[176px]">
          <Selecto etiqueta="Tipo" valor={tipo} onValor={setTipo} opciones={OPCIONES_TIPO} vacia="Todos" />
        </div>
        <div className="w-[176px]">
          <Selecto
            etiqueta="Juego"
            valor={juego}
            onValor={setJuego}
            opciones={juegos.map((j) => ({ valor: j.juego, etiqueta: `${ETIQUETA_JUEGO[j.juego] ?? j.juego} · ${j.productos}` }))}
            vacia="Todos"
          />
        </div>
        <div className="w-[224px]">
          <Selecto
            etiqueta="Categoría"
            valor={categoriaId}
            onValor={setCategoriaId}
            opciones={opcionesCategoria.map((c) => ({ valor: c.id, etiqueta: c.etiqueta }))}
            vacia="Todas"
          />
        </div>
        <Segmentado
          opciones={[{ valor: 'si', etiqueta: '⚠ Duplicados' }]}
          valor={soloDuplicados}
          onChange={setSoloDuplicados}
        />
        <Segmentado
          opciones={[
            { valor: 'activos', etiqueta: 'Activos' },
            { valor: 'inactivos', etiqueta: 'Inactivos' },
          ]}
          valor={actividad}
          onChange={setActividad}
        />
      </div>

      {error ? (
        <div className="mb-3">
          <Banner tono="peligro" accion={<Boton onClick={cargar}>Reintentar</Boton>}>
            No se pudo cargar el listado. Revisa la conexión y vuelve a intentar.
          </Banner>
        </div>
      ) : null}

      {datos === null ? (
        <Cargando />
      ) : datos.productos.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio
            mensaje={
              tipo === 'sellado' && categoriaId && opcionesCategoria.find((c) => c.id === categoriaId)?.etiqueta.startsWith('Cartas')
                ? 'El sellado no vive bajo «Cartas»: está en la categoría «Sellado» y su juego va aparte. Para el sellado de un juego usa Tipo = Sellado y el filtro Juego.'
                : 'No hay productos con estos filtros. Ajusta la búsqueda o los filtros.'
            }
          />
        </div>
      ) : (
        <>
          <p className="mb-2 text-chico text-lab3" aria-live="polite">
            Mostrando {desde}–{hasta} de {datos.total} productos
          </p>
          {vista === 'lista' ? (
            <>
              <div className="hidden items-center gap-3 px-3 pb-1 text-chico text-lab3 sm:flex">
                <span className="flex-1">Producto</span>
                <span className="w-[112px] shrink-0">Tipo</span>
                <span className="hidden w-[128px] shrink-0 md:block">Stock</span>
                <span className="w-[96px] shrink-0 text-right">Precio</span>
              </div>
              <ul className="divide-y divide-sep overflow-hidden rounded-tarjeta bg-bg shadow-tarjeta">
                {datos.productos.map((p) => (
                  <FilaProducto key={p.id} producto={p} onAbrir={setAbierto} onCambiarPrecio={abrirCambioPrecio} />
                ))}
              </ul>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {datos.productos.map((p) => (
                <TarjetaProducto key={p.id} producto={p} onAbrir={setAbierto} />
              ))}
            </div>
          )}
          <Paginacion pagina={datos.pagina} porPagina={datos.porPagina} total={datos.total} onPagina={setPagina} />
        </>
      )}

      <DetalleProductoModal
        producto={abierto}
        categoriaNombre={categoriaNombre}
        onCerrar={() => setAbierto(null)}
        onCambiarPrecio={abrirCambioPrecio}
      />

      <Dialogo
        abierto={editando !== null}
        titulo="Cambiar el precio"
        onCerrar={() => setEditando(null)}
        ancho={420}
      >
        {editando ? (
          <div className="flex flex-col gap-4">
            <p className="text-cuerpo text-lab">{editando.nombre}</p>
            <p className="text-cuerpo text-lab2">
              Precio actual: <span className="num text-lab">{clp(editando.precioVenta)}</span>
            </p>
            <CampoMonto etiqueta="Precio nuevo" valor={precioNuevo} onValor={setPrecioNuevo} autoFocus />
            <p className="text-chico text-lab3">El cambio queda registrado en la auditoría con el valor anterior y el nuevo.</p>
            <Boton
              variante="principal"
              cargando={guardando}
              deshabilitado={precioNuevo === '' || precioNuevo === editando.precioVenta || !enLinea}
              motivoDeshabilitado={
                !enLinea
                  ? 'Necesitas conexión para esto.'
                  : precioNuevo === ''
                    ? 'Escribe el precio nuevo.'
                    : precioNuevo === editando.precioVenta
                      ? 'El precio nuevo es igual al actual.'
                      : undefined
              }
              onClick={() => void confirmarPrecio()}
            >
              {precioNuevo === '' ? 'Confirmar cambio' : `Cambiar a ${clp(precioNuevo)}`}
            </Boton>
          </div>
        ) : null}
      </Dialogo>
    </div>
  );
}
