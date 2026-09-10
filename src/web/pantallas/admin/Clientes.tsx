// V18 (E4 Fase 4; rediseño 1i, R-029) — Clientes del encargado (07-SDD §8): mismo patrón de
// pantalla que Stock: encabezado con resumen y acción principal, buscador fluido, pestañas con
// conteos, tabla con saldo por tamaño (no por color), menú «⋯» por fila, y los candidatos de las
// tiendas web como segunda sección plegable con «Vincular» de 44 px. Vincular sigue siendo
// decisión del encargado; nada se crea solo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorApi, api } from '../../api.js';
import { Banner, Boton, Campo, Dialogo, Insignia, PieDialogo, Vacio } from '../../components/base.js';
import { CeldaDoble, Tabla, type Columna } from '../../components/Tabla.js';
import { useAvisos } from '../../components/Toast.js';
import { ETIQUETA_ORIGEN, type CandidatosCanal, type ClienteAdmin, type PropuestaVinculo, type RespuestaClientes } from '../../tipos.js';
import { clp, fecha } from '../../utils/formato.js';
import { CampoBuscar, Encabezado, Filtro, Filtros, SeccionPlegable, Selecto } from './util.js';
import { Segmentado } from '../../components/base.js';

type Filtro = 'todos' | 'conSaldo' | 'conDeuda' | 'conCredito' | 'duplicados';

/** Candidatos a duplicado (§6.6, versión de lista): rut, correo o teléfono repetido entre las filas cargadas. */
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

/** R-008: alta de cliente desde el backoffice. Mismo `POST /clientes` que el mostrador (C1). */
function DialogoNuevoCliente({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const navigate = useNavigate();
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [errorRut, setErrorRut] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setNombre('');
    setRut('');
    setTelefono('');
    setEmail('');
    setError('');
    setErrorRut('');
  }, [abierto]);

  const crear = async () => {
    const n = nombre.trim();
    if (n === '') {
      setError('El nombre es obligatorio.');
      return;
    }
    setGuardando(true);
    setError('');
    setErrorRut('');
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
        setErrorRut('El dígito verificador no cuadra. Revisa el RUT.');
        setError('1 campo por corregir');
      } else {
        setError('No se pudo crear el cliente. Intenta de nuevo.');
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialogo abierto={abierto} titulo="Nuevo cliente" onCerrar={onCerrar} cerrable={!guardando}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void crear();
        }}
      >
        <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus required />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="RUT (opcional)" value={rut} onChange={(e) => setRut(e.target.value)} placeholder="12345678-9" error={errorRut} />
          <Campo etiqueta="Teléfono (opcional)" value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" />
        </div>
        <Campo etiqueta="Correo (opcional)" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        <p className="text-chico text-lab3">
          El saldo se carga después, desde la ficha: con dinero se cobra en el mostrador como «Carga de saldo»; premios y ajustes van por «Cargar saldo» de la ficha.
        </p>
        <PieDialogo error={error}>
          <Boton ajustado onClick={onCerrar} deshabilitado={guardando}>
            Cancelar
          </Boton>
          <Boton ajustado variante="principal" type="submit" cargando={guardando}>
            Crear y abrir ficha
          </Boton>
        </PieDialogo>
      </form>
    </Dialogo>
  );
}

/** Sección §7.3: candidatos de la última corrida de importación por canal. */
function Candidatos({ canal, onVinculado }: { canal: CandidatosCanal; onVinculado: () => void }) {
  const navegar = useNavigate();
  const { avisar } = useAvisos();
  const [vinculando, setVinculando] = useState<number | null>(null);
  const [verSinCoincidencia, setVerSinCoincidencia] = useState(false);

  const vincular = async (p: PropuestaVinculo) => {
    setVinculando(p.externoUserId);
    try {
      await api(`/clientes/${p.clienteId}/vincular`, {
        method: 'POST',
        body: JSON.stringify({ canalId: canal.canalId, externoUserId: p.externoUserId, externoEmail: p.email }),
      });
      avisar({ tono: 'ok', titulo: 'Cuenta vinculada.', detalle: `${p.nombreCanal} → ${p.clienteNombre}.`, accion: { etiqueta: 'Ver ficha', onClick: () => navegar(`/clientes/${p.clienteId}`) } });
      onVinculado();
    } catch (e) {
      const detalle = e instanceof ErrorApi && typeof e.cuerpo.detalle === 'string' ? e.cuerpo.detalle : 'Revisa la conexión y vuelve a intentar.';
      avisar({ tono: 'error', titulo: 'No se pudo vincular.', detalle });
    } finally {
      setVinculando(null);
    }
  };

  const columnas: Columna<PropuestaVinculo>[] = [
    { clave: 'cuenta', titulo: 'Cuenta en la tienda', render: (p) => <CeldaDoble principal={p.nombreCanal} secundaria={p.email} mono={false} /> },
    {
      clave: 'cliente',
      titulo: 'Cliente aquí',
      prioridad: 2,
      enTarjeta: 'cifra',
      render: (p) => (
        <button type="button" onClick={() => navegar(`/clientes/${p.clienteId}`)} className="truncate text-left text-lab underline-offset-2 hover:underline">
          {p.clienteNombre}
        </button>
      ),
    },
    {
      clave: 'accion',
      titulo: '',
      ancho: '120px',
      alinear: 'derecha',
      enTarjeta: 'cifra',
      render: (p) => (
        <Boton ajustado cargando={vinculando === p.externoUserId} deshabilitado={vinculando !== null} onClick={() => void vincular(p)}>
          Vincular
        </Boton>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Insignia>{ETIQUETA_ORIGEN[canal.canalId] ?? canal.canalId}</Insignia>
        <span className="text-chico text-lab3">
          última corrida {fecha(canal.corridaEn)}
          {canal.dryRun ? ' · simulación' : ''}
        </span>
      </div>
      {canal.vinculos.length === 0 ? (
        <p className="text-chico text-lab2">Sin coincidencias por correo pendientes de confirmar.</p>
      ) : (
        <Tabla columnas={columnas} filas={canal.vinculos} clave={(p) => String(p.externoUserId)} />
      )}
      {canal.conflictos.length > 0 ? (
        <Banner tono="alerta">
          {canal.conflictos.length} conflicto{canal.conflictos.length > 1 ? 's' : ''}: {canal.conflictos.map((c) => `${c.email} (${c.detalle})`).join('; ')}
        </Banner>
      ) : null}
      {canal.sinCoincidencia.length > 0 ? (
        <div>
          <button type="button" onClick={() => setVerSinCoincidencia((v) => !v)} aria-expanded={verSinCoincidencia} className="min-h-[36px] text-chico text-lab2 underline">
            {canal.sinCoincidencia.length} cuenta{canal.sinCoincidencia.length > 1 ? 's' : ''} sin coincidencia por correo
          </button>
          {verSinCoincidencia ? (
            <>
              <p className="mt-1 text-chico text-lab3">Crear el cliente es una decisión humana: se crea desde el mostrador (o «Nuevo cliente») y después se vincula aquí. Nada se crea solo.</p>
              <ul className="mt-2 max-h-[240px] divide-y divide-sep overflow-y-auto rounded-campo border border-sep">
                {canal.sinCoincidencia.map((p) => (
                  <li key={p.externoUserId} className="flex min-h-tactil items-center px-3 text-chico text-lab2">
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
  const navegar = useNavigate();
  const { avisar } = useAvisos();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [orden, setOrden] = useState('');
  const [q, setQ] = useState('');
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [datos, setDatos] = useState<RespuestaClientes | null>(null);
  const [candidatos, setCandidatos] = useState<CandidatosCanal[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [candidatosAbiertos, setCandidatosAbiertos] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const p = new URLSearchParams({ limit: '100' });
    if (q.trim().length >= 2) p.set('q', q.trim());
    if (filtro === 'conSaldo') p.set('conSaldo', 'true');
    if (filtro === 'conDeuda') p.set('conDeuda', 'true');
    if (filtro === 'conCredito') p.set('conCredito', 'true');
    if (orden) p.set('orden', orden);
    try {
      const [lista, cand] = await Promise.all([api<RespuestaClientes>(`/clientes?${p.toString()}`), api<{ canales: CandidatosCanal[] }>('/clientes/candidatos')]);
      setDatos(lista);
      setCandidatos(cand.canales);
    } catch {
      avisar({ tono: 'error', titulo: 'No se pudieron cargar los clientes.', detalle: 'Revisa la conexión y vuelve a intentar.', accion: { etiqueta: 'Reintentar', onClick: () => void cargar() } });
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filtro, orden]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 250);
    return () => clearTimeout(t);
  }, [cargar]);

  const duplicados = useMemo(() => idsDuplicados(datos?.clientes ?? []), [datos]);
  const filas = useMemo(() => {
    const todas = datos?.clientes ?? [];
    return filtro === 'duplicados' ? todas.filter((c) => duplicados.has(c.id)) : todas;
  }, [datos, filtro, duplicados]);
  const enMonederos = useMemo(() => (datos?.clientes ?? []).reduce((a, c) => a + Math.max(0, c.saldo), 0), [datos]);
  const enDeuda = useMemo(() => (datos?.clientes ?? []).reduce((a, c) => a + Math.max(0, -c.saldo), 0), [datos]);
  const totalCandidatos = (candidatos ?? []).reduce((a, c) => a + c.vinculos.length + c.sinCoincidencia.length, 0);

  const columnas: Columna<ClienteAdmin>[] = [
    {
      clave: 'cliente',
      titulo: 'Cliente',
      ancho: 'minmax(0,1.4fr)',
      render: (c) => (
        <span className="flex min-w-0 flex-col gap-[2px]">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <button type="button" onClick={() => navegar(`/clientes/${c.id}`)} className="truncate text-left font-semibold text-lab underline-offset-2 hover:underline">
              {c.nombre}
            </button>
            {!c.activo ? <Insignia tono="peligro">Inactivo</Insignia> : null}
          </span>
          <span className="text-chico text-lab3">
            {duplicados.has(c.id) ? 'posible duplicado (RUT, correo o teléfono repetido)' : c.permiteCredito ? `crédito hasta ${clp(c.limiteCredito)}` : c.rut ? <span className="num">{c.rut}</span> : ''}
          </span>
        </span>
      ),
    },
    {
      clave: 'contacto',
      titulo: 'Contacto',
      ancho: 'minmax(0,1.2fr)',
      prioridad: 2,
      enTarjeta: 'oculto',
      render: (c) => <CeldaDoble principal={<span className="text-lab2">{c.email ?? (c.telefono ? '' : 'sin contacto')}</span>} secundaria={c.telefono ?? (c.email ? 'sin teléfono' : undefined)} />,
    },
    {
      clave: 'saldo',
      titulo: 'Saldo',
      ancho: '120px',
      alinear: 'derecha',
      enTarjeta: 'cifra',
      render: (c) => <span className={`num ${c.saldo === 0 ? 'text-lab3' : 'text-[16px] font-semibold text-lab'}`}>{clp(c.saldo)}</span>,
    },
    { clave: 'ultima', titulo: 'Última compra', ancho: '130px', alinear: 'derecha', prioridad: 3, enTarjeta: 'cifra', render: (c) => <span className="num text-lab2">{c.ultimaCompra ? fecha(c.ultimaCompra) : '—'}</span> },
  ];

  return (
    <div className="p-4 sm:px-8 sm:py-6">
      <Encabezado
        titulo="Clientes"
        subtitulo={datos ? `${datos.clientes.length}${datos.siguienteCursor ? '+' : ''} clientes · ${clp(enMonederos)} en monederos · ${clp(enDeuda)} en deuda` : undefined}
        acciones={
          <Boton ajustado variante="principal" icono="plus" onClick={() => setNuevoAbierto(true)}>
            Nuevo cliente
          </Boton>
        }
      />
      <DialogoNuevoCliente abierto={nuevoAbierto} onCerrar={() => setNuevoAbierto(false)} />

      <Filtros>
        <Filtro ancho="1 1 240px" minimo={200}>
          <CampoBuscar id="buscar-clientes" valor={q} onValor={setQ} placeholder="Nombre, RUT, teléfono o correo" />
        </Filtro>
        <Segmentado<Filtro>
          fijo
          valor={filtro}
          onChange={(v) => setFiltro(v ?? 'todos')}
          opciones={[
            { valor: 'todos', etiqueta: 'Todos' },
            { valor: 'conSaldo', etiqueta: 'Con saldo' },
            { valor: 'conDeuda', etiqueta: 'Con deuda' },
            { valor: 'conCredito', etiqueta: 'Con crédito' },
            { valor: 'duplicados', etiqueta: 'Duplicados', conteo: duplicados.size || undefined },
          ]}
        />
        <Filtro ancho="0 1 180px">
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
        </Filtro>
      </Filtros>

      <Tabla
        columnas={columnas}
        filas={filas}
        clave={(c) => c.id}
        cargando={cargando}
        resumen={
          datos ? (
            <>
              <strong className="num font-semibold text-lab">{filas.length}</strong> cliente{filas.length === 1 ? '' : 's'}
              {datos.siguienteCursor ? ' · hay más: afina la búsqueda o el filtro' : ''}
            </>
          ) : (
            'Cargando…'
          )
        }
        vacio={<Vacio mensaje="No hay clientes que calcen con el filtro." />}
        menu={(c) => [
          { etiqueta: 'Ver ficha', onClick: () => navegar(`/clientes/${c.id}`) },
          { etiqueta: 'Cargar saldo', onClick: () => navegar(`/clientes/${c.id}#saldo`) },
        ]}
      />

      <div className="mt-4">
        <SeccionPlegable
          titulo="Candidatos de las tiendas web"
          resumen={candidatos === null ? 'cargando…' : totalCandidatos === 0 ? 'nada pendiente' : `${totalCandidatos} compradores online que aún no están vinculados aquí`}
          abierta={candidatosAbiertos}
          onToggle={() => setCandidatosAbiertos((v) => !v)}
        >
          {candidatos === null ? null : candidatos.length === 0 ? (
            <Vacio mensaje="Todavía no hay corridas de importación de clientes. Se lanzan desde Tiendas web." />
          ) : (
            <div className="flex flex-col gap-4">
              {candidatos.map((c) => (
                <Candidatos key={c.canalId} canal={c} onVinculado={() => void cargar()} />
              ))}
            </div>
          )}
        </SeccionPlegable>
      </div>
    </div>
  );
}
