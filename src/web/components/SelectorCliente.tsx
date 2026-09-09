// V15 — Cliente en el cobro (07-SDD §8). El campo "Cliente (opcional)" es un
// buscador: elegir un resultado asocia el cliente a la venta; el texto libre
// sin elegir alimenta clienteNombre como en E1 (M3). "Crear cliente" abre un
// alta de DOS campos (nombre y teléfono) sin salir del cobro (M2).
// Sin monedero todavía: eso llega en la Fase 3.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ErrorApi } from '../api.js';
import type { ClienteResumen } from '../tipos.js';
import { clp } from '../utils/formato.js';
import { Boton, Campo } from './base.js';

interface Props {
  cliente: ClienteResumen | null;
  nombreLibre: string;
  enLinea: boolean;
  onElegir: (c: ClienteResumen) => void;
  onQuitar: () => void;
  onNombreLibre: (nombre: string) => void;
}

/** Saldo del resultado: solo si es distinto de cero; negativo en --peligro (§6.2). */
function EtiquetaSaldo({ saldo }: { saldo: number }) {
  if (saldo === 0) return null;
  if (saldo < 0) return <span className="num text-chico text-peligro">debe {clp(-saldo)}</span>;
  return <span className="num text-chico text-lab2">{clp(saldo)}</span>;
}

export function SelectorCliente({ cliente, nombreLibre, enLinea, onElegir, onQuitar, onNombreLibre }: Props) {
  const [resultados, setResultados] = useState<ClienteResumen[]>([]);
  const [abierta, setAbierta] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoTelefono, setNuevoTelefono] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorAlta, setErrorAlta] = useState('');
  const refNombre = useRef<HTMLInputElement>(null);

  // Búsqueda con debounce; sin conexión no se busca y el texto libre sigue sirviendo (M3).
  useEffect(() => {
    const q = nombreLibre.trim();
    if (cliente || creando || !enLinea || q.length < 2) {
      setResultados([]);
      return;
    }
    const id = setTimeout(() => {
      api<{ resultados: ClienteResumen[] }>(`/clientes/buscar?q=${encodeURIComponent(q)}`)
        .then((r) => {
          setResultados(r.resultados);
          setAbierta(true);
        })
        .catch(() => setResultados([]));
    }, 250);
    return () => clearTimeout(id);
  }, [nombreLibre, cliente, creando, enLinea]);

  const abrirAlta = () => {
    setCreando(true);
    setErrorAlta('');
    setNuevoNombre(nombreLibre.trim());
    setNuevoTelefono('');
    setAbierta(false);
    setTimeout(() => refNombre.current?.focus(), 0);
  };

  const crear = async () => {
    const nombre = nuevoNombre.trim();
    if (nombre === '') {
      setErrorAlta('El nombre es obligatorio.');
      return;
    }
    setGuardando(true);
    setErrorAlta('');
    try {
      const r = await api<{ cliente: ClienteResumen }>('/clientes', {
        method: 'POST',
        body: JSON.stringify({ nombre, ...(nuevoTelefono.trim() ? { telefono: nuevoTelefono.trim() } : {}) }),
      });
      onElegir(r.cliente);
      setCreando(false);
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'CLIENTE_DUPLICADO') {
        setErrorAlta('Ya existe un cliente con esos datos. Búscalo por nombre o RUT.');
      } else {
        setErrorAlta('No se pudo crear el cliente. Intenta de nuevo.');
      }
    } finally {
      setGuardando(false);
    }
  };

  // Cliente ya asociado: se muestra como chip con opción de quitarlo.
  if (cliente) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-campo border border-ac bg-ac-suave px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate text-cuerpo font-semibold text-lab">{cliente.nombre}</span>
          <span className="flex items-center gap-2 text-chico text-lab2">
            {cliente.rut ? <span className="num">{cliente.rut}</span> : null}
            <EtiquetaSaldo saldo={cliente.saldo} />
            <Link to={`/clientes/${cliente.id}`} className="underline">
              Ver ficha
            </Link>
          </span>
        </span>
        <button
          type="button"
          onClick={onQuitar}
          aria-label={`Quitar cliente ${cliente.nombre}`}
          className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded text-lab2"
        >
          ✕
        </button>
      </div>
    );
  }

  // Alta en dos campos, dentro del propio cobro (M2).
  if (creando) {
    return (
      <div className="mb-4 rounded-campo border border-sep p-3">
        <p className="mb-2 text-chico text-lab2">Nuevo cliente</p>
        <div className="grid grid-cols-2 gap-3">
          <Campo
            etiqueta="Nombre"
            value={nuevoNombre}
            onChange={(e) => setNuevoNombre(e.target.value)}
            refInput={refNombre}
            error={errorAlta || undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                void crear();
              }
            }}
          />
          <Campo
            etiqueta="Teléfono"
            value={nuevoTelefono}
            onChange={(e) => setNuevoTelefono(e.target.value)}
            inputMode="tel"
            ayuda="Opcional."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                void crear();
              }
            }}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Boton onClick={() => setCreando(false)} deshabilitado={guardando}>
            Cancelar
          </Boton>
          <Boton variante="principal" cargando={guardando} onClick={() => void crear()}>
            Crear y asociar
          </Boton>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mb-4">
      <Campo
        etiqueta="Cliente (opcional)"
        value={nombreLibre}
        onChange={(e) => onNombreLibre(e.target.value)}
        onFocus={() => resultados.length > 0 && setAbierta(true)}
        onBlur={() => setTimeout(() => setAbierta(false), 150)}
        onKeyDown={(e) => {
          // Enter aquí no debe agregar un pago del diálogo de cobro.
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const primero = resultados[0];
            if (abierta && primero) onElegir(primero);
          }
        }}
        ayuda={enLinea ? 'Escribe para buscar; el texto queda como nombre si no eliges a nadie.' : 'Sin conexión: el nombre queda escrito tal cual.'}
      />
      {abierta && resultados.length > 0 ? (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-campo border border-sep bg-bg shadow-tarjeta">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onElegir(c)}
                className="flex h-tactil w-full items-center justify-between gap-2 px-3 text-left hover:bg-bg3"
              >
                <span className="min-w-0 truncate text-cuerpo text-lab">
                  {c.nombre}
                  {c.rut ? <span className="num ml-2 text-chico text-lab3">{c.rut}</span> : null}
                </span>
                <EtiquetaSaldo saldo={c.saldo} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {enLinea && nombreLibre.trim().length >= 2 ? (
        <button type="button" onClick={abrirAlta} className="mt-1 text-chico text-lab2 underline">
          Crear cliente
        </button>
      ) : null}
    </div>
  );
}
