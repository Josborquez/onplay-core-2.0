// V18 (E4 Fase 4) — Clientes del encargado (07-SDD §8): tabla con saldo,
// crédito y última compra; filtros con saldo / con deuda / con crédito y
// candidatos a duplicado con ⚠ filtrables; y la sección de candidatos de la
// última importación (§7.3): vincular es SIEMPRE una decisión del encargado,
// y una cuenta sin coincidencia se crea a mano, nunca sola.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorApi, api } from '../../api.js';
import { Banner, Boton, Campo, Cargando, Dialogo, Insignia, Vacio } from '../../components/base.js';
import {
  ETIQUETA_ORIGEN,
  type CandidatosCanal,
  type ClienteAdmin,
  type PropuestaVinculo,
  type RespuestaClientes,
} from '../../tipos.js';
import { clp, fecha } from '../../utils/formato.js';
import { Encabezado, Selecto } from './util.js';

type Filtro = 'todos' | 'conSaldo' | 'conDeuda' | 'conCredito' | 'duplicados';

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'conSaldo', etiqueta: 'Con saldo' },
  { valor: 'conDeuda', etiqueta: 'Con deuda' },
  { valor: 'conCredito', etiqueta: 'Con crédito' },
  { valor: 'duplicados', etiqueta: '⚠ Duplicados' },
];

/** Candidatos a duplicado (§6.6, versión de lista): rut, correo o teléfono
 * repetido entre las filas cargadas. Volumen chico → en memoria. */
function idsDuplicados(clientes: ClienteAdmin[]): Set<string> {
  const porClave = new Map<string, string[]>();
  for (const c of clientes) {
    for (const clave of [c.rut, c.email?.toLowerCase(), c.telefono]) {
      if (!clave) continue;
      const ids = porClave.get(clave) ?? [];
      ids.push(c.id);
      porClave.set(clave, ids);
    }
  }
  const marcados = new Set<string>();
  for (const ids of porClave.values()) {
    if (ids.length > 1) ids.forEach((id) => marcados.add(id));
  }
  return marcados;
}

/** R-008: alta de cliente desde el backoffice. Mismo `POST /clientes` que el mostrador (C1),
 * con RUT y correo opcionales; al crear, va a la ficha, donde vive «Cargar saldo». */
function DialogoNuevoCliente({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const navigate = useNavigate();
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setNombre('');
    setRut('');
    setTelefono('');
    setEmail('');
    setError('');
  }, [abierto]);

  const crear = async () => {
    const n = nombre.trim();
    if (n === '') {
      setError('El nombre es obligatorio.');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      const r = await api<{ cliente: { id: string } }>('/clientes', {
        method: 'POST',
        body: JSON.stringify({
          nombre: n,
          ...(rut.trim() ? { rut: rut.trim() } : {}),
          ...(telefono.trim() ? { telefono: telefono.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
        }),
      });
      onCerrar();
      navigate(`/clientes/${r.cliente.id}`);
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'CLIENTE_DUPLICADO') {
        setError('Ya existe un cliente con ese RUT o correo. Búscalo en la lista.');
      } else if (e instanceof ErrorApi && e.codigo === 'RUT_INVALIDO') {
        setError('Ese RUT no es válido. Revisa el dígito verificador.');
      } else {
        setError('No se pudo crear el cliente. Intenta de nuevo.');
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialogo abierto={abierto} titulo="Nuevo cliente" onCerrar={onCerrar}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void crear();
        }}
      >
        <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus required />
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="RUT (opcional)" value={rut} onChange={(e) => setRut(e.target.value)} placeholder="12345678-9" />
          <Campo etiqueta="Teléfono (opcional)" value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" />
        </div>
        <Campo etiqueta="Correo (opcional)" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        <p className="text-chico text-lab3">
          El saldo se carga después, desde la ficha: con dinero se cobra en el mostrador como «Carga de
          saldo»; premios y ajustes van por «Cargar saldo» de la ficha.
        </p>
        {error ? <p className="text-chico text-peligro">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="principal" type="submit" cargando={guardando}>
            Crear y abrir ficha
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}

function FilaCliente({ c, duplicado }: { c: ClienteAdmin; duplicado: boolean }) {
  return (
    <tr className="border-t border-sep">
      <td className="px-3 py-2">
        <Link to={`/clientes/${c.id}`} className="text-cuerpo text-lab underline-offset-2 hover:underline">
          {c.nombre}
        </Link>
        {duplicado ? (
          <span className="ml-2" title="Posible duplicado: comparte RUT, correo o teléfono con otro cliente">
            <Insignia tono="alerta">⚠ duplicado</Insignia>
          </span>
        ) : null}
        {!c.activo ? <span className="ml-2"><Insignia tono="peligro">inactivo</Insignia></span> : null}
      </td>
      <td className="px-3 py-2 text-chico text-lab2">
        {c.rut ? <span className="num mr-2">{c.rut}</span> : null}
        {c.telefono ? <span className="num mr-2">{c.telefono}</span> : null}
        {c.email ?? ''}
      </td>
      <td className={`num px-3 py-2 text-right font-semibold ${c.saldo < 0 ? 'text-peligro' : 'text-lab'}`}>
        {clp(c.saldo)}
      </td>
      <td className="px-3 py-2 text-right text-chico text-lab2">
        {c.permiteCredito ? <span className="num">hasta {clp(c.limiteCredito)}</span> : '—'}
      </td>
      <td className="num px-3 py-2 text-right text-chico text-lab2">
        {c.ultimaCompra ? fecha(c.ultimaCompra) : '—'}
      </td>
    </tr>
  );
}

/** Sección §7.3: candidatos de la última corrida de importación por canal. */
function Candidatos({ canal, onVinculado }: { canal: CandidatosCanal; onVinculado: () => void }) {
  const [vinculando, setVinculando] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [verSinCoincidencia, setVerSinCoincidencia] = useState(false);

  const vincular = async (p: PropuestaVinculo) => {
    setError('');
    setVinculando(p.externoUserId);
    try {
      await api(`/clientes/${p.clienteId}/vincular`, {
        method: 'POST',
        body: JSON.stringify({ canalId: canal.canalId, externoUserId: p.externoUserId, externoEmail: p.email }),
      });
      onVinculado();
    } catch (e) {
      const detalle = e instanceof ErrorApi && typeof e.cuerpo.detalle === 'string' ? ` ${e.cuerpo.detalle}` : '';
      setError(`No se pudo vincular.${detalle}`);
    } finally {
      setVinculando(null);
    }
  };

  return (
    <div className="rounded-tarjeta border border-sep bg-bg p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Insignia>{ETIQUETA_ORIGEN[canal.canalId] ?? canal.canalId}</Insignia>
        <span className="text-chico text-lab3">
          última corrida {fecha(canal.corridaEn)}
          {canal.dryRun ? ' · simulación' : ''}
        </span>
      </div>
      {error ? (
        <div className="mb-2">
          <Banner tono="peligro">{error}</Banner>
        </div>
      ) : null}

      {canal.vinculos.length === 0 ? (
        <p className="text-chico text-lab2">Sin coincidencias por correo pendientes de confirmar.</p>
      ) : (
        <ul className="divide-y divide-sep rounded-campo border border-sep">
          {canal.vinculos.map((p) => (
            <li key={p.externoUserId} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="text-cuerpo text-lab">{p.nombreCanal}</span>
                <span className="ml-2 text-chico text-lab3">{p.email}</span>
                <span className="mx-1 text-chico text-lab3">→</span>
                <Link to={`/clientes/${p.clienteId}`} className="text-chico text-lab2 underline">
                  {p.clienteNombre}
                </Link>
              </span>
              <div className="w-[100px] shrink-0">
                <Boton
                  cargando={vinculando === p.externoUserId}
                  deshabilitado={vinculando !== null}
                  onClick={() => void vincular(p)}
                >
                  Vincular
                </Boton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canal.conflictos.length > 0 ? (
        <div className="mt-3">
          <Banner tono="alerta">
            {canal.conflictos.length} conflicto{canal.conflictos.length > 1 ? 's' : ''}:{' '}
            {canal.conflictos.map((c) => `${c.email} (${c.detalle})`).join('; ')}
          </Banner>
        </div>
      ) : null}

      {canal.sinCoincidencia.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setVerSinCoincidencia((v) => !v)}
            className="text-chico text-lab2 underline"
          >
            {canal.sinCoincidencia.length} cuenta{canal.sinCoincidencia.length > 1 ? 's' : ''} sin
            coincidencia por correo {verSinCoincidencia ? '▴' : '▾'}
          </button>
          {verSinCoincidencia ? (
            <>
              <p className="mt-1 text-chico text-lab3">
                Crear el cliente es una decisión humana: se crea desde el mostrador (o la ficha) y
                después se vincula aquí. Nada se crea solo.
              </p>
              <ul className="mt-2 max-h-[240px] divide-y divide-sep overflow-y-auto rounded-campo border border-sep">
                {canal.sinCoincidencia.map((p) => (
                  <li key={p.externoUserId} className="px-3 py-2 text-chico text-lab2">
                    {p.nombreCanal} · {p.email}
                    {p.telefono ? <span className="num ml-2 text-lab3">{p.telefono}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Clientes() {
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [orden, setOrden] = useState('');
  const [q, setQ] = useState('');
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [datos, setDatos] = useState<RespuestaClientes | null>(null);
  const [candidatos, setCandidatos] = useState<CandidatosCanal[] | null>(null);
  const [error, setError] = useState(false);

  const cargar = useCallback(async () => {
    setError(false);
    const p = new URLSearchParams({ limit: '100' });
    if (q.trim().length >= 2) p.set('q', q.trim());
    if (filtro === 'conSaldo') p.set('conSaldo', 'true');
    if (filtro === 'conDeuda') p.set('conDeuda', 'true');
    if (filtro === 'conCredito') p.set('conCredito', 'true');
    if (orden) p.set('orden', orden);
    try {
      const [lista, cand] = await Promise.all([
        api<RespuestaClientes>(`/clientes?${p.toString()}`),
        api<{ canales: CandidatosCanal[] }>('/clientes/candidatos'),
      ]);
      setDatos(lista);
      setCandidatos(cand.canales);
    } catch {
      setError(true);
    }
  }, [q, filtro, orden]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 250); // pequeña espera para no buscar por tecla
    return () => clearTimeout(t);
  }, [cargar]);

  const duplicados = useMemo(() => idsDuplicados(datos?.clientes ?? []), [datos]);
  const filas = useMemo(() => {
    const todas = datos?.clientes ?? [];
    return filtro === 'duplicados' ? todas.filter((c) => duplicados.has(c.id)) : todas;
  }, [datos, filtro, duplicados]);

  return (
    <div className="p-4">
      <Encabezado
        titulo="Clientes"
        extra={
          <Boton variante="principal" onClick={() => setNuevoAbierto(true)}>
            Nuevo cliente
          </Boton>
        }
      />
      <DialogoNuevoCliente abierto={nuevoAbierto} onCerrar={() => setNuevoAbierto(false)} />

      {error ? (
        <div className="mb-3">
          <Banner tono="peligro" accion={<Boton onClick={() => void cargar()}>Reintentar</Boton>}>
            No se pudieron cargar los clientes. Revisa la conexión y vuelve a intentar.
          </Banner>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-[260px]">
          <label className="mb-1 block text-chico text-lab2" htmlFor="buscar-clientes">
            Buscar
          </label>
          <input
            id="buscar-clientes"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre, RUT, teléfono o correo"
            className="h-tactil w-full rounded-campo border border-sep bg-bg px-3 text-cuerpo text-lab outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              aria-pressed={filtro === f.valor}
              onClick={() => setFiltro(f.valor)}
              className={`h-[36px] rounded px-3 text-chico ${
                filtro === f.valor ? 'bg-ac-suave font-semibold text-lab' : 'border border-sep text-lab2'
              }`}
            >
              {f.etiqueta}
            </button>
          ))}
        </div>
        <div className="w-[180px]">
          <Selecto
            etiqueta="Ordenar por"
            valor={orden}
            onValor={setOrden}
            vacia="Nombre / alta"
            opciones={[
              { valor: 'saldo', etiqueta: 'Saldo' },
              { valor: 'ultimaCompra', etiqueta: 'Última compra' },
            ]}
          />
        </div>
      </div>

      {datos === null ? (
        <Cargando />
      ) : filas.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje="No hay clientes que calcen con el filtro." />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-tarjeta border border-sep bg-bg">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="text-chico text-lab3">
                <th className="px-3 py-2 font-normal">Nombre</th>
                <th className="px-3 py-2 font-normal">Contacto</th>
                <th className="px-3 py-2 text-right font-normal">Saldo</th>
                <th className="px-3 py-2 text-right font-normal">Crédito</th>
                <th className="px-3 py-2 text-right font-normal">Última compra</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => (
                <FilaCliente key={c.id} c={c} duplicado={duplicados.has(c.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos?.siguienteCursor ? (
        <p className="mt-2 text-chico text-lab3">Hay más resultados: afina la búsqueda o el filtro.</p>
      ) : null}

      <h2 className="mb-2 mt-6 text-cuerpo font-semibold text-lab">Candidatos de las tiendas web</h2>
      {candidatos === null ? (
        <Cargando />
      ) : candidatos.length === 0 ? (
        <Vacio mensaje="Todavía no hay corridas de importación de clientes. Se lanzan desde Sincronización (admin)." />
      ) : (
        <div className="flex flex-col gap-3">
          {candidatos.map((c) => (
            <Candidatos key={c.canalId} canal={c} onVinculado={() => void cargar()} />
          ))}
        </div>
      )}
    </div>
  );
}
