// Barra lateral agrupada (rediseño 1a, R-029; 05-SDD §3.1/§3.2): 2 accesos + grupos plegables,
// un solo grupo abierto (el de la ruta actual), iconos SVG de 20 px, pie con conexión, tiendas,
// tema y salir. Plegada (72 px, y siempre en 640–1023): cada grupo es un icono que abre un
// desplegable accesible. Bajo 640: barra inferior de 4 pestañas y «Más» abre la lista agrupada.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useCola } from '../cola.js';
import { useSesion } from '../sesion.js';
import { useEnLinea } from '../tema.js';
import { useEstadoTiendas } from '../tiendas.js';
import { rolAlcanza, type RolUsuario } from '../tipos.js';
import { Icono, type NombreIcono } from './iconos.js';

interface Entrada {
  a: string;
  etiqueta: string;
  rol: RolUsuario;
  fin?: boolean;
}

interface Grupo {
  id: string;
  etiqueta: string;
  icono: NombreIcono;
  rol: RolUsuario;
  /** Enlace directo (sin hijos). */
  a?: string;
  hijos?: Entrada[];
}

const ACCESOS: Grupo[] = [
  { id: 'mostrador', etiqueta: 'Mostrador', icono: 'mostrador', rol: 'vendedor', a: '/' },
  { id: 'mis-ventas', etiqueta: 'Mis ventas', icono: 'misVentas', rol: 'vendedor', a: '/mis-ventas' },
];

const GRUPOS: Grupo[] = [
  {
    id: 'inventario',
    etiqueta: 'Inventario',
    icono: 'inventario',
    rol: 'encargado',
    hijos: [
      { a: '/admin/productos', etiqueta: 'Productos', rol: 'encargado' },
      { a: '/admin/snacks', etiqueta: 'Alta de snack', rol: 'encargado' },
      { a: '/admin/stock', etiqueta: 'Stock', rol: 'encargado' },
      { a: '/admin/recuentos', etiqueta: 'Recuentos', rol: 'encargado' },
      { a: '/admin/duplicados', etiqueta: 'Duplicados', rol: 'encargado' },
    ],
  },
  { id: 'compras', etiqueta: 'Compras', icono: 'compras', rol: 'encargado', a: '/admin/compras' },
  {
    id: 'ventas',
    etiqueta: 'Ventas',
    icono: 'ventas',
    rol: 'encargado',
    hijos: [
      { a: '/admin/ventas', etiqueta: 'Ventas', rol: 'encargado' },
      { a: '/admin/turnos', etiqueta: 'Turnos', rol: 'encargado' },
      { a: '/admin/reportes', etiqueta: 'Reportes', rol: 'encargado' },
    ],
  },
  { id: 'clientes', etiqueta: 'Clientes', icono: 'clientes', rol: 'encargado', a: '/admin/clientes' },
  {
    id: 'tiendas',
    etiqueta: 'Tiendas web',
    icono: 'tiendas',
    rol: 'encargado',
    hijos: [
      { a: '/admin/sync', etiqueta: 'Sincronización', rol: 'encargado' },
      { a: '/admin/pedidos', etiqueta: 'Pedidos online', rol: 'encargado' },
      { a: '/admin/discrepancias', etiqueta: 'Discrepancias', rol: 'encargado' },
    ],
  },
  {
    id: 'administracion',
    etiqueta: 'Administración',
    icono: 'administracion',
    rol: 'encargado',
    hijos: [
      { a: '/admin/auditoria', etiqueta: 'Auditoría', rol: 'encargado' },
      { a: '/admin/sistema', etiqueta: 'Sistema', rol: 'admin' },
    ],
  },
];

function grupoDeRuta(ruta: string): string | null {
  for (const g of GRUPOS) {
    if (g.a && (ruta === g.a || ruta.startsWith(`${g.a}/`))) return g.id;
    if (g.hijos?.some((h) => ruta === h.a || ruta.startsWith(`${h.a}/`))) return g.id;
  }
  return null;
}

/** Estados de 05-SDD §8.1: en línea · sin conexión · sin conexión con N pendientes · enviando N. */
export function IndicadorConexion({ soloPunto = false }: { soloPunto?: boolean }) {
  const enLinea = useEnLinea();
  const { pendientes, enviando } = useCola();
  const punto = enviando ? 'bg-ac pulso' : enLinea ? 'bg-ok' : 'bg-alerta';
  const texto = enviando
    ? `enviando ${pendientes}…`
    : !enLinea && pendientes > 0
      ? `sin conexión · ${pendientes} venta${pendientes > 1 ? 's' : ''} pendiente${pendientes > 1 ? 's' : ''}`
      : enLinea
        ? 'en línea'
        : 'sin conexión';
  if (soloPunto) {
    return (
      <div aria-live="polite" aria-label={texto} title={texto} className="flex h-6 items-center justify-center">
        <span className={`inline-block h-2 w-2 rounded-full ${punto}`} aria-hidden="true" />
      </div>
    );
  }
  return (
    <div aria-live="polite" className="flex h-6 items-center gap-2 px-5 text-chico text-lab2">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${punto}`} aria-hidden="true" />
      <span className="truncate">{texto}</span>
    </div>
  );
}

/** R-024: marca para todos los roles de si las tiendas web responden y cuándo se leyó su catálogo. */
export function IndicadorTiendas() {
  const estado = useEstadoTiendas();
  if (!estado || estado.tiendas.length === 0) return null;
  const relativo = (iso: string | null) => {
    if (!iso) return 'sin catálogo';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return min < 60 ? `catálogo hace ${Math.max(0, min)} min` : `catálogo hace ${Math.round(min / 60)} h`;
  };
  return (
    <div className="flex flex-col gap-[2px] px-5 text-chico text-lab2">
      {estado.tiendas.map((t) => (
        <div key={t.id} className="flex h-[22px] items-center gap-2" title={t.enLinea === null ? 'Sin claves en el servidor' : t.enLinea ? 'En línea' : 'Sin conexión'}>
          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${t.enLinea === true ? 'bg-ok' : t.enLinea === false ? 'bg-peligro' : 'bg-lab3'}`} aria-hidden="true" />
          <span className="truncate">
            {t.nombre} · {t.enLinea === true ? relativo(t.ultimoCatalogoEn) : t.enLinea === false ? 'sin conexión' : 'sin claves'}
          </span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  plegada: boolean;
  /** En tablet la barra va siempre plegada y no se puede desplegar. */
  bloqueada?: boolean;
  onPlegar: () => void;
  tema: 'claro' | 'oscuro';
  onTema: () => void;
}

const CLASE_ITEM = 'mx-2 flex h-item-barra items-center gap-3 rounded px-3 text-cuerpo';
const CLASE_HIJO = 'mx-2 flex h-item-barra items-center rounded pl-[44px] pr-3 text-cuerpo';

function Punto() {
  return <span aria-hidden="true" className="absolute left-[-9px] top-1/2 h-[5px] w-[5px] -translate-y-1/2 rounded-full bg-rosa" />;
}

export function BarraLateral({ plegada, bloqueada, onPlegar, tema, onTema }: Props) {
  const { usuario, salir } = useSesion();
  const { pathname } = useLocation();
  const navegar = useNavigate();
  const rol = usuario?.rol ?? 'vendedor';
  const visibles = useMemo(() => GRUPOS.filter((g) => rolAlcanza(rol, g.rol)), [rol]);
  const accesos = useMemo(() => ACCESOS.filter((g) => rolAlcanza(rol, g.rol)), [rol]);

  const grupoActual = grupoDeRuta(pathname);
  const [abierto, setAbierto] = useState<string | null>(grupoActual);
  useEffect(() => setAbierto(grupoActual), [grupoActual]);

  // Desplegable de un grupo cuando la barra está plegada.
  const [flotante, setFlotante] = useState<{ id: string; top: number } | null>(null);
  const raiz = useRef<HTMLElement>(null);
  useEffect(() => setFlotante(null), [pathname, plegada]);
  useEffect(() => {
    if (!flotante) return;
    const alClic = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setFlotante(null);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFlotante(null);
    };
    document.addEventListener('mousedown', alClic);
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('mousedown', alClic);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [flotante]);

  const etiqueta = (texto: ReactNode) => (
    <span className="min-w-0 flex-1 truncate transition-opacity duration-150" style={{ opacity: plegada ? 0 : 1, pointerEvents: plegada ? 'none' : undefined }}>
      {texto}
    </span>
  );

  const enlace = (a: string, texto: string, icono: NombreIcono | null, fin?: boolean) => (
    <NavLink
      key={a}
      to={a}
      end={fin ?? a === '/'}
      aria-label={texto}
      className={({ isActive }) => `${icono ? CLASE_ITEM : CLASE_HIJO} relative ${isActive ? 'bg-ac-suave font-semibold text-lab' : 'text-lab2'} ${plegada ? 'justify-center' : ''}`}
    >
      {({ isActive }) => (
        <>
          {icono ? (
            <span className="relative flex shrink-0 items-center">
              {isActive ? <Punto /> : null}
              <Icono nombre={icono} />
            </span>
          ) : isActive ? (
            <span className="absolute left-[32px] top-1/2 h-[5px] w-[5px] -translate-y-1/2 rounded-full bg-rosa" aria-hidden="true" />
          ) : null}
          {icono ? etiqueta(texto) : <span className="truncate">{texto}</span>}
        </>
      )}
    </NavLink>
  );

  const hijosVisibles = (g: Grupo) => (g.hijos ?? []).filter((h) => rolAlcanza(rol, h.rol));

  const grupo = (g: Grupo) => {
    if (g.a) return enlace(g.a, g.etiqueta, g.icono);
    const hijos = hijosVisibles(g);
    if (hijos.length === 0) return null;
    const activo = grupoActual === g.id;
    const expandido = abierto === g.id && !plegada;
    return (
      <div key={g.id} className="flex flex-col gap-[2px]">
        <button
          type="button"
          aria-expanded={plegada ? flotante?.id === g.id : expandido}
          aria-label={g.etiqueta}
          onClick={(e) => {
            if (plegada) {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setFlotante((f) => (f?.id === g.id ? null : { id: g.id, top: r.top }));
            } else {
              setAbierto((a) => (a === g.id ? null : g.id));
            }
          }}
          className={`${CLASE_ITEM} relative w-[calc(100%-16px)] ${activo ? 'font-semibold text-lab' : 'text-lab2'} ${plegada ? 'justify-center' : ''} ${plegada && activo ? 'bg-ac-suave' : ''}`}
        >
          <span className="relative flex shrink-0 items-center">
            {activo && plegada ? <Punto /> : null}
            <Icono nombre={g.icono} />
          </span>
          {etiqueta(g.etiqueta)}
          {!plegada ? <Icono nombre={expandido ? 'chevronAbajo' : 'chevronDerecha'} tamano={16} clase="text-lab3" /> : null}
        </button>
        {expandido ? hijos.map((h) => enlace(h.a, h.etiqueta, null, h.fin)) : null}
      </div>
    );
  };

  const grupoFlotante = flotante ? visibles.find((g) => g.id === flotante.id) : null;

  return (
    <nav ref={raiz} className="material-barra no-imprimir relative flex h-full flex-col gap-[2px] border-r border-sep py-4">
      <a href="#buscador" className="sr-only focus:not-sr-only focus:mx-3 focus:block focus:rounded focus:px-2 focus:py-1 focus:text-chico">
        Saltar al buscador
      </a>
      <div className={`mb-2 flex h-item-barra items-center px-3 ${plegada ? 'justify-center' : 'justify-between'}`}>
        {!plegada ? <span className="text-tit text-lab">OnPlay</span> : null}
        {!bloqueada ? (
          <button type="button" onClick={onPlegar} aria-label={plegada ? 'Desplegar la barra' : 'Plegar la barra'} className="flex h-item-barra w-item-barra items-center justify-center rounded text-lab2">
            <Icono nombre={plegada ? 'desplegar' : 'plegar'} />
          </button>
        ) : null}
      </div>

      {accesos.map((g) => enlace(g.a!, g.etiqueta, g.icono))}
      {visibles.length > 0 ? <div className={`my-2 border-t border-sep ${plegada ? 'mx-4' : 'mx-5'}`} /> : null}
      <div className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto">{visibles.map(grupo)}</div>

      {grupoFlotante ? (
        <div
          role="menu"
          aria-label={grupoFlotante.etiqueta}
          className="absolute left-[80px] z-30 w-[212px] rounded-tarjeta border border-sep bg-bg3 p-[6px] shadow-tarjeta"
          style={{ top: Math.max(8, flotante!.top - 8) }}
        >
          <div className="flex h-8 items-center px-3 text-rot font-semibold uppercase tracking-[.06em] text-lab3">{grupoFlotante.etiqueta}</div>
          {hijosVisibles(grupoFlotante).map((h) => {
            const activo = pathname === h.a || pathname.startsWith(`${h.a}/`);
            return (
              <button
                key={h.a}
                type="button"
                role="menuitem"
                onClick={() => navegar(h.a)}
                className={`relative flex h-tactil w-full items-center rounded px-3 text-left text-cuerpo ${activo ? 'bg-ac-suave font-semibold text-lab' : 'text-lab2 hover:bg-ac-suave'}`}
              >
                {activo ? <span className="absolute left-[3px] top-1/2 h-[5px] w-[5px] -translate-y-1/2 rounded-full bg-rosa" aria-hidden="true" /> : null}
                {h.etiqueta}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-[2px] border-t border-sep pt-3">
        {plegada ? <IndicadorConexion soloPunto /> : <IndicadorConexion />}
        {!plegada ? <IndicadorTiendas /> : null}
        <button
          type="button"
          onClick={onTema}
          aria-pressed={tema === 'oscuro'}
          aria-label={tema === 'claro' ? 'Modo oscuro' : 'Modo claro'}
          className={`${CLASE_ITEM} mt-1 text-lab2 ${plegada ? 'justify-center' : ''}`}
        >
          <Icono nombre={tema === 'claro' ? 'luna' : 'sol'} />
          {etiqueta(tema === 'claro' ? 'Modo oscuro' : 'Modo claro')}
        </button>
        <button type="button" onClick={() => void salir()} aria-label="Salir" className={`${CLASE_ITEM} text-lab2 ${plegada ? 'justify-center' : ''}`}>
          <Icono nombre="salir" />
          {etiqueta(`Salir · ${usuario?.nombre ?? ''}`)}
        </button>
      </div>
    </nav>
  );
}

/** Bajo 640 px (rediseño 1a): 4 pestañas y «Más» con la misma lista agrupada en una hoja inferior. */
export function BarraInferior({ tema, onTema }: { tema: 'claro' | 'oscuro'; onTema: () => void }) {
  const { usuario, salir } = useSesion();
  const { pathname } = useLocation();
  const navegar = useNavigate();
  const [hoja, setHoja] = useState(false);
  useEffect(() => setHoja(false), [pathname]);
  const rol = usuario?.rol ?? 'vendedor';
  const encargado = rolAlcanza(rol, 'encargado');
  const pestanas: { a: string; etiqueta: string; icono: NombreIcono }[] = [
    { a: '/', etiqueta: 'Mostrador', icono: 'mostrador' },
    encargado ? { a: '/admin/ventas', etiqueta: 'Ventas', icono: 'ventas' } : { a: '/mis-ventas', etiqueta: 'Mis ventas', icono: 'misVentas' },
    ...(encargado ? [{ a: '/admin/clientes', etiqueta: 'Clientes', icono: 'clientes' as NombreIcono }] : []),
  ];
  const activa = (a: string) => (a === '/' ? pathname === '/' : pathname === a || pathname.startsWith(`${a}/`));
  const enHoja = !pestanas.some((p) => activa(p.a));

  return (
    <>
      {hoja ? (
        <div className="fixed inset-0 z-30" role="presentation">
          <div className="absolute inset-0 bg-velo" onClick={() => setHoja(false)} />
          <div role="dialog" aria-label="Más secciones" className="absolute bottom-[72px] left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-[16px] bg-bg3 px-2 pb-3 pt-2 shadow-tarjeta">
            <div className="mx-auto mb-3 mt-1 h-1 w-9 rounded-full bg-sep" />
            {encargado
              ? GRUPOS.filter((g) => rolAlcanza(rol, g.rol)).map((g) => (
                  <div key={g.id}>
                    <div className="flex h-8 items-center px-3 text-rot font-semibold uppercase tracking-[.06em] text-lab3">{g.etiqueta}</div>
                    {(g.a ? [{ a: g.a, etiqueta: g.etiqueta, rol: g.rol }] : g.hijos ?? [])
                      .filter((h) => rolAlcanza(rol, h.rol))
                      .map((h) => (
                        <button key={h.a} type="button" onClick={() => navegar(h.a)} className={`flex h-12 w-full items-center rounded px-3 text-left text-cuerpo ${activa(h.a) ? 'bg-ac-suave font-semibold text-lab' : 'text-lab2'}`}>
                          {h.etiqueta}
                        </button>
                      ))}
                  </div>
                ))
              : null}
            <div className="mt-2 border-t border-sep pt-2">
              <IndicadorConexion />
              <IndicadorTiendas />
              <button type="button" onClick={onTema} className="flex h-12 w-full items-center gap-3 rounded px-3 text-left text-cuerpo text-lab2">
                <Icono nombre={tema === 'claro' ? 'luna' : 'sol'} />
                {tema === 'claro' ? 'Modo oscuro' : 'Modo claro'}
              </button>
              <button type="button" onClick={() => void salir()} className="flex h-12 w-full items-center gap-3 rounded px-3 text-left text-cuerpo text-lab2">
                <Icono nombre="salir" />
                Salir · {usuario?.nombre ?? ''}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <nav className="no-imprimir grid h-[72px] shrink-0 border-t border-sep bg-barra-solida text-rot" style={{ gridTemplateColumns: `repeat(${pestanas.length + 1}, 1fr)` }}>
        {pestanas.map((p) => (
          <NavLink key={p.a} to={p.a} end={p.a === '/'} className={`relative flex flex-col items-center justify-center gap-1 ${activa(p.a) ? 'font-semibold text-lab' : 'text-lab2'}`}>
            {activa(p.a) ? <span className="absolute top-[10px] h-[5px] w-[5px] rounded-full bg-rosa" aria-hidden="true" /> : null}
            <Icono nombre={p.icono} tamano={22} />
            {p.etiqueta}
          </NavLink>
        ))}
        <button type="button" onClick={() => setHoja((v) => !v)} aria-expanded={hoja} className={`relative flex flex-col items-center justify-center gap-1 ${enHoja ? 'font-semibold text-lab' : 'text-lab2'}`}>
          {enHoja ? <span className="absolute top-[10px] h-[5px] w-[5px] rounded-full bg-rosa" aria-hidden="true" /> : null}
          <Icono nombre="mas" tamano={22} />
          Más
        </button>
      </nav>
    </>
  );
}
