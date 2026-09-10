// Componentes base Cristal OnPlay (05-SDD §5.1). Sin librería externa.
import {
  useEffect,
  useId,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Icono, type NombreIcono } from './iconos.js';

/* ---------- Boton ---------- */

interface PropsBoton {
  variante?: 'principal' | 'secundario' | 'peligro' | 'fantasma';
  tamano?: 'normal' | 'grande';
  cargando?: boolean;
  deshabilitado?: boolean;
  /** I6: un botón deshabilitado siempre lleva el motivo visible, nunca en title. */
  motivoDeshabilitado?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  children: ReactNode;
  clase?: string;
  /** Rediseño R-029: el botón mide lo que mide su texto (no el 100 % del contenedor). */
  ajustado?: boolean;
  icono?: NombreIcono;
  /** Solo icono (44 × 44); `children` pasa a ser el aria-label. */
  soloIcono?: boolean;
}

export function Boton({
  variante = 'secundario',
  tamano = 'normal',
  cargando,
  deshabilitado,
  motivoDeshabilitado,
  onClick,
  type = 'button',
  children,
  clase = '',
  ajustado,
  icono,
  soloIcono,
}: PropsBoton) {
  const inactivo = deshabilitado || cargando;
  const estilos = {
    principal: 'bg-ac-relleno text-sobre-ac font-semibold',
    secundario: 'bg-bg3 text-lab border border-sep',
    peligro: 'bg-transparent text-peligro border border-peligro',
    fantasma: 'bg-transparent text-lab2',
  }[variante];
  const alto = tamano === 'grande' ? 'h-boton' : 'h-tactil';
  const boton = (
    <button
      type={type}
      onClick={onClick}
      disabled={inactivo}
      aria-label={soloIcono && typeof children === 'string' ? children : undefined}
      className={`${ajustado || soloIcono ? 'inline-flex items-center justify-center gap-2 whitespace-nowrap' : 'w-full'} rounded-campo num text-cuerpo ${alto} ${
        soloIcono ? 'w-tactil px-0' : tamano === 'grande' ? 'px-5' : 'px-4'
      } ${estilos} ${inactivo ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} transition-opacity duration-150`}
    >
      {cargando ? (
        'Un momento…'
      ) : (
        <>
          {icono ? <Icono nombre={icono} tamano={18} trazo={1.8} /> : null}
          {soloIcono ? null : children}
        </>
      )}
    </button>
  );
  if (ajustado || soloIcono) {
    return motivoDeshabilitado && inactivo ? (
      <span className={`inline-flex flex-col items-start gap-1 ${clase}`}>
        {boton}
        <span className="text-chico text-peligro">{motivoDeshabilitado}</span>
      </span>
    ) : clase ? (
      <span className={clase}>{boton}</span>
    ) : (
      boton
    );
  }
  return (
    <div className={clase}>
      {boton}
      {inactivo && motivoDeshabilitado ? (
        <p className="mt-1 text-chico text-peligro">{motivoDeshabilitado}</p>
      ) : null}
    </div>
  );
}

/* ---------- Campo ---------- */

interface PropsCampo extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  etiqueta: string;
  error?: string;
  ayuda?: string;
  prefijo?: string;
  refInput?: React.Ref<HTMLInputElement>;
}

export function Campo({ etiqueta, error, ayuda, prefijo, refInput, ...resto }: PropsCampo) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-chico text-lab2">
        {etiqueta}
      </label>
      <div
        className={`flex h-tactil items-center rounded-campo border bg-bg px-3 ${error ? 'border-peligro' : 'border-sep'}`}
      >
        {prefijo ? <span className="mr-1 text-lab3">{prefijo}</span> : null}
        <input
          id={id}
          ref={refInput}
          className="num w-full bg-transparent text-lab outline-none"
          aria-invalid={!!error}
          {...resto}
        />
      </div>
      {error ? (
        <p className="mt-1 flex items-center gap-[6px] text-chico font-medium text-peligro" role="alert">
          <Icono nombre="info" tamano={14} trazo={2} />
          {error}
        </p>
      ) : ayuda ? (
        <p className="mt-1 text-chico text-lab3">{ayuda}</p>
      ) : null}
    </div>
  );
}

/** Rediseño 1g: error de un diálogo o formulario, con icono, siempre a la vista junto a los botones. */
export function ErrorForm({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="flex items-start gap-[6px] text-chico font-medium text-peligro">
      <Icono nombre="info" tamano={14} trazo={2} clase="mt-[2px]" />
      <span>{children}</span>
    </p>
  );
}

/** Pie de un diálogo: error (o nada) a la izquierda, botones a la derecha, sobre un filete. */
export function PieDialogo({ error, children }: { error?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-sep pt-4">
      <div className="min-w-0">{error ? <ErrorForm>{error}</ErrorForm> : null}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Solo enteros, prefijo `$`, selecciona todo al enfocar. */
export function CampoMonto({
  valor,
  onValor,
  ...resto
}: { valor: number | ''; onValor: (v: number | '') => void } & Omit<
  PropsCampo,
  'prefijo' | 'value' | 'onChange' | 'type'
>) {
  return (
    <Campo
      {...resto}
      prefijo="$"
      type="text"
      inputMode="numeric"
      value={valor === '' ? '' : valor.toLocaleString('es-CL')}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const limpio = e.target.value.replace(/\D/g, '');
        onValor(limpio === '' ? '' : Number(limpio));
      }}
    />
  );
}

/* ---------- Dialogo ---------- */

interface PropsDialogo {
  abierto: boolean;
  titulo: string;
  onCerrar?: () => void;
  cerrable?: boolean;
  /** Chico 480 · mediano 560 · grande 720 (rediseño R-029). */
  ancho?: number;
  /** Línea chica sobre el título («Paso 1 de 2 · línea 7») y bajo él (código, descripción). */
  sobreTitulo?: ReactNode;
  subtitulo?: ReactNode;
  rol?: 'dialog' | 'alertdialog';
  children: ReactNode;
}

export function Dialogo({ abierto, titulo, onCerrar, cerrable = true, ancho = 480, sobreTitulo, subtitulo, rol = 'dialog', children }: PropsDialogo) {
  const ref = useRef<HTMLDivElement>(null);
  const abridor = useRef<HTMLElement | null>(null);

  // Atrapa el foco y lo devuelve al abridor al cerrarse (05-SDD §9).
  useEffect(() => {
    if (!abierto) return;
    abridor.current = document.activeElement as HTMLElement;
    const nodo = ref.current;
    const enfocables = () =>
      Array.from(
        nodo?.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])') ?? [],
      ).filter((e) => !e.hasAttribute('disabled'));
    enfocables()[0]?.focus();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && cerrable) {
        e.stopPropagation();
        onCerrar?.();
      }
      if (e.key === 'Tab') {
        const lista = enfocables();
        if (lista.length === 0) return;
        const primero = lista[0]!;
        const ultimo = lista[lista.length - 1]!;
        if (e.shiftKey && document.activeElement === primero) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primero.focus();
        }
      }
    };
    nodo?.addEventListener('keydown', alTeclear);
    return () => {
      nodo?.removeEventListener('keydown', alTeclear);
      abridor.current?.focus();
    };
  }, [abierto, cerrable, onCerrar]);

  if (!abierto) return null;
  return (
    <div className="no-imprimir fixed inset-0 z-40 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-velo" onClick={cerrable ? onCerrar : undefined} />
      <div
        ref={ref}
        role={rol}
        aria-modal="true"
        aria-label={titulo}
        className="relative max-h-[92vh] w-full overflow-y-auto rounded-tarjeta bg-bg p-6 shadow-tarjeta"
        style={{ maxWidth: ancho }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            {sobreTitulo ? <span className="text-chico text-lab3">{sobreTitulo}</span> : null}
            <h2 className="text-tit text-lab">{titulo}</h2>
            {subtitulo ? <span className="text-chico text-lab2">{subtitulo}</span> : null}
          </div>
          {cerrable ? (
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar"
              className="flex h-tactil w-tactil shrink-0 items-center justify-center rounded text-lab2"
            >
              <Icono nombre="cerrar" tamano={18} />
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- Segmentado ---------- */

export function Segmentado<T extends string>({
  opciones,
  valor,
  onChange,
  fijo,
}: {
  opciones: { valor: T; etiqueta: string; conteo?: number | null }[];
  valor: T | null;
  onChange: (v: T | null) => void;
  /** Sin alternar a null al volver a tocar la activa (pestañas de filtro). */
  fijo?: boolean;
}) {
  return (
    <div role="tablist" className="inline-flex max-w-full overflow-x-auto rounded-campo border border-sep bg-bg p-1">
      {opciones.map((o) => {
        const activa = o.valor === valor;
        return (
          <button
            key={o.valor}
            role="tab"
            type="button"
            aria-selected={activa}
            onClick={() => onChange(activa && !fijo ? null : o.valor)}
            className={`flex h-[34px] shrink-0 items-center gap-[6px] whitespace-nowrap rounded px-3 text-cuerpo ${activa ? 'bg-bg3 font-semibold text-lab shadow-tarjeta' : 'text-lab2'}`}
          >
            {o.etiqueta}
            {o.conteo !== undefined && o.conteo !== null ? <span className="num text-chico">{o.conteo}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Insignia · Banner · Vacio · Cargando ---------- */

export function Insignia({ tono = 'neutro', children }: { tono?: 'neutro' | 'ok' | 'alerta' | 'peligro'; children: ReactNode }) {
  const color = { neutro: 'text-lab2 border-sep', ok: 'text-ok border-ok', alerta: 'text-alerta border-alerta', peligro: 'text-peligro border-peligro' }[tono];
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-chico ${color}`}>{children}</span>;
}

export function Banner({ tono, children, accion }: { tono: 'ok' | 'alerta' | 'peligro'; children: ReactNode; accion?: ReactNode }) {
  const color = { ok: 'border-ok text-ok', alerta: 'border-alerta text-alerta', peligro: 'border-peligro text-peligro' }[tono];
  return (
    <div role="status" className={`flex items-center justify-between gap-3 rounded-campo border bg-bg px-4 py-3 text-cuerpo ${color}`}>
      <span className="text-lab">{children}</span>
      {accion}
    </div>
  );
}

export function Vacio({ mensaje, accion }: { mensaje: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-cuerpo text-lab2">{mensaje}</p>
      {accion}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <p className="py-6 text-center text-cuerpo text-lab3">{texto}</p>;
}

/* ---------- ConmutadorVista (grilla / lista) ---------- */

export type Vista = 'grilla' | 'lista';

export function ConmutadorVista({ vista, onChange }: { vista: Vista; onChange: (v: Vista) => void }) {
  const opciones: { valor: Vista; etiqueta: string; icono: ReactNode }[] = [
    {
      valor: 'grilla',
      etiqueta: 'Grilla',
      icono: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      ),
    },
    {
      valor: 'lista',
      etiqueta: 'Lista',
      icono: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 6h13M8 12h13M8 18h13" />
          <circle cx="4" cy="6" r="1" />
          <circle cx="4" cy="12" r="1" />
          <circle cx="4" cy="18" r="1" />
        </svg>
      ),
    },
  ];
  return (
    <div role="group" aria-label="Vista de productos" className="inline-flex rounded-campo border border-sep bg-bg p-1">
      {opciones.map((o) => {
        const activa = o.valor === vista;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={activa}
            title={o.etiqueta}
            onClick={() => onChange(o.valor)}
            className={`flex h-[36px] items-center gap-1 rounded px-3 text-chico ${
              activa ? 'bg-bg3 font-semibold text-lab shadow-tarjeta' : 'text-lab2'
            }`}
          >
            {o.icono}
            <span className="hidden sm:inline">{o.etiqueta}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- EtiquetaStock (E2 §6.2 / §6.8) ---------- */

export interface StockMostrable {
  controlaStock?: boolean;
  stockTotal?: number | null;
  stockVenta?: number | null;
  stockCanalMin?: number | null;
  estadoStock?: 'sin_control' | 'negativo' | 'quiebre' | 'bajo' | 'ok';
}

/**
 * Texto corto de stock para listas y tarjetas. No dice nada si el producto no controla stock.
 * El espejo del canal se etiqueta SIEMPRE «en la web», nunca «stock» a secas (RI3).
 */
export function EtiquetaStock({ p, clase = '' }: { p: StockMostrable; clase?: string }) {
  if (!p.controlaStock || p.stockTotal == null || !p.estadoStock || p.estadoStock === 'sin_control') return null;
  // R-025: el número que ve el vendedor es el que PUEDE vender (ubicación de venta), que es el
  // mismo tope del carro (R-014). Lo que hay en otras ubicaciones se dice aparte, «en bodega».
  const aqui = p.stockVenta ?? p.stockTotal;
  const otras = Math.max(0, p.stockTotal - aqui);
  const tono = aqui <= 0 ? 'text-peligro' : p.estadoStock === 'bajo' || p.estadoStock === 'negativo' ? 'text-alerta' : 'text-lab2';
  const web =
    p.stockCanalMin != null && p.stockCanalMin <= 0
      ? ' · agotado en la web'
      : p.stockCanalMin === 1
        ? ' · último en la web'
        : '';
  return (
    <span className={`num inline-block rounded border border-sep bg-bg3 px-[6px] text-chico font-semibold ${tono} ${clase}`}>
      {aqui <= 0 ? 'sin stock aquí' : `quedan ${aqui}`}
      {otras > 0 ? ` · ${otras} en bodega` : ''}
      {web}
    </span>
  );
}
