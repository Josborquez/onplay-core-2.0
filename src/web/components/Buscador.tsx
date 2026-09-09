// Buscador con foco permanente (I2) y navegación por teclado (05-SDD V2).
// Caché local SIEMPRE primero; el servidor solo si no hay resultados locales y hay conexión.
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { buscarLocal, catalogoListo, porCodigoBarras, type ProductoCache } from '../catalogo.js';
import { useEnLinea } from '../tema.js';
import { clp } from '../utils/formato.js';
import { EtiquetaStock, Insignia, Vacio } from './base.js';

export const ResultadoBusqueda = memo(function ResultadoBusqueda({
  producto,
  resaltado,
  enCarrito,
  onElegir,
}: {
  producto: ProductoCache;
  resaltado: boolean;
  enCarrito: number;
  onElegir: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onElegir}
        className={`flex h-fila w-full items-center justify-between px-4 text-left ${resaltado ? 'bg-ac-suave' : ''}`}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-lab">{producto.nombre}</span>
          <span className="block truncate font-mono text-chico text-lab3">
            {producto.sku}
            {producto.cardNumber ? ` · ${producto.cardNumber}` : ''}
            <EtiquetaStock p={producto} clase="ml-2 font-sans" />
          </span>
        </span>
        <span className="ml-3 flex shrink-0 items-center gap-2">
          {enCarrito > 0 ? <Insignia>en carrito · {enCarrito}</Insignia> : null}
          <span className="num font-semibold text-lab">{clp(producto.precioVenta)}</span>
        </span>
      </button>
    </li>
  );
});

interface Props {
  bloqueado: boolean; // con un diálogo abierto, el buscador no roba el foco
  cantidadEnCarrito: (productoId: string) => number;
  onAgregar: (p: ProductoCache) => void;
  onItemSuelto: (termino: string) => void;
}

export function Buscador({ bloqueado, cantidadEnCarrito, onAgregar, onItemSuelto }: Props) {
  const [texto, setTexto] = useState('');
  const [consulta, setConsulta] = useState('');
  const [indice, setIndice] = useState(0);
  const [remotos, setRemotos] = useState<ProductoCache[] | null>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const enLinea = useEnLinea();
  const consultaDiferida = useDeferredValue(consulta);

  // Debounce 150 ms, mínimo 2 caracteres.
  useEffect(() => {
    const id = setTimeout(() => setConsulta(texto), 150);
    return () => clearTimeout(id);
  }, [texto]);

  const locales = useMemo(
    () => (consultaDiferida.trim().length >= 2 ? buscarLocal(consultaDiferida) : []),
    [consultaDiferida],
  );

  // Respaldo remoto solo sin resultados locales, con conexión y caché ya hidratado.
  useEffect(() => {
    setRemotos(null);
    if (consultaDiferida.trim().length < 2 || locales.length > 0 || !enLinea) return;
    let vigente = true;
    void api<{ resultados: (ProductoCache & { precioVenta: number })[] }>(
      `/productos/buscar?q=${encodeURIComponent(consultaDiferida.trim())}`,
    )
      .then((r) => {
        if (vigente) setRemotos(r.resultados);
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [consultaDiferida, locales.length, enLinea]);

  const resultados = locales.length > 0 ? locales : (remotos ?? []);
  const haySinResultados = consultaDiferida.trim().length >= 2 && resultados.length === 0 && remotos !== null;

  useEffect(() => setIndice(0), [consultaDiferida]);

  // Foco permanente (I2): vuelve solo salvo diálogo abierto o campo del carrito en edición.
  useEffect(() => {
    if (bloqueado) return;
    const devolver = () => {
      const activo = document.activeElement;
      if (activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement) return;
      refInput.current?.focus();
    };
    devolver();
    const id = setInterval(devolver, 400);
    return () => clearInterval(id);
  }, [bloqueado]);

  const limpiar = () => {
    setTexto('');
    setConsulta('');
    setRemotos(null);
    refInput.current?.focus();
  };

  const agregar = (p: ProductoCache) => {
    onAgregar(p);
    limpiar();
  };

  const alTeclear = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndice((i) => Math.min(i + 1, resultados.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndice((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      limpiar();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Lector de código de barras: coincidencia exacta agrega sin mostrar la lista.
      const exacto = porCodigoBarras(texto);
      if (exacto) {
        agregar(exacto);
        return;
      }
      const elegido = resultados[indice] ?? resultados[0];
      if (elegido) agregar(elegido);
    }
  };

  return (
    <div>
      <div className="flex h-tactil items-center rounded-campo border border-sep bg-bg px-3">
        <span aria-hidden="true" className="mr-2 text-lab3">
          ⌕
        </span>
        <input
          id="buscador"
          ref={refInput}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={alTeclear}
          placeholder="Buscar o escanear…"
          aria-label="Buscar por nombre, código, número de carta o código de barras"
          className="w-full bg-transparent text-lab outline-none"
          autoComplete="off"
        />
      </div>
      <p aria-live="polite" className="sr-only">
        {resultados.length} resultados
      </p>

      {resultados.length > 0 ? (
        <ul className="mt-3 overflow-hidden rounded-tarjeta bg-bg shadow-tarjeta divide-y divide-sep">
          {resultados.map((p, i) => (
            <ResultadoBusqueda
              key={p.id}
              producto={p}
              resaltado={i === indice}
              enCarrito={cantidadEnCarrito(p.id)}
              onElegir={() => agregar(p)}
            />
          ))}
        </ul>
      ) : haySinResultados ? (
        <div className="mt-3 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio
            mensaje={`No hay resultados para «${consultaDiferida.trim()}».`}
            accion={
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => onItemSuelto(consultaDiferida.trim())}
                  className="h-tactil rounded-campo border border-sep bg-bg3 px-4 text-cuerpo text-lab"
                >
                  Vender como ítem suelto
                </button>
                <p className="text-chico text-lab3">
                  Si el producto no está, pídele a un encargado que lo dé de alta.
                </p>
              </div>
            }
          />
        </div>
      ) : consultaDiferida.trim().length >= 2 && !catalogoListo() && remotos === null ? (
        <p className="mt-3 text-chico text-lab3">Buscando…</p>
      ) : null}
    </div>
  );
}
