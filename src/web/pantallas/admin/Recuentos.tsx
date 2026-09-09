// V20 — Recuento guiado (03-SDD §6.4, §8). Lista de recuentos con «% cuadrado» y detalle con
// buscador de foco permanente que acepta el escáner (cada lectura suma 1), líneas con
// sistema / contado / diferencia, progreso, cierre con resumen y descarte con nota.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorApi, api } from '../../api.js';
import { buscarLocal, catalogoListo, categorias, hidratarCatalogo, porCodigoBarras, type ProductoCache } from '../../catalogo.js';
import { Banner, Boton, Campo, Cargando, Dialogo, Insignia, Vacio } from '../../components/base.js';
import { fecha } from '../../utils/formato.js';
import { aplanarCategorias, Encabezado, Selecto, type OpcionCategoria } from './util.js';

type EstadoRecuento = 'abierto' | 'cerrado' | 'descartado';

interface RecuentoResumen {
  id: string;
  nombre: string;
  estado: EstadoRecuento;
  creadoEn: string;
  cerradoEn: string | null;
  ubicacion: { codigo: string; nombre: string };
  usuario: { nombre: string };
  totalLineas: number;
  contadas: number;
  porcentajeCuadrado: number | null;
}

interface Linea {
  id: string;
  productoId: string;
  cantidadSistema: number;
  cantidadContada: number | null;
  stockVigente: number;
  producto: { id: string; sku: string; nombre: string; imagenUrl: string | null; codigoBarras: string | null; controlaStock: boolean };
}

interface RecuentoDetalleDatos {
  id: string;
  nombre: string;
  estado: EstadoRecuento;
  creadoEn: string;
  cerradoEn: string | null;
  nota: string | null;
  ubicacion: { id: string; codigo: string; nombre: string };
  usuario: { nombre: string };
  lineas: Linea[];
}

interface Ubicacion {
  id: string;
  nombre: string;
}

const ETIQUETA_ESTADO: Record<EstadoRecuento, { texto: string; tono: 'ok' | 'alerta' | 'neutro' }> = {
  abierto: { texto: 'abierto', tono: 'alerta' },
  cerrado: { texto: 'cerrado', tono: 'ok' },
  descartado: { texto: 'descartado', tono: 'neutro' },
};

/* ---------- Lista + nuevo ---------- */

export function Recuentos() {
  const navigate = useNavigate();
  const [lista, setLista] = useState<RecuentoResumen[] | null>(null);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [opcionesCategoria, setOpcionesCategoria] = useState<OpcionCategoria[]>([]);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [ubicacionId, setUbicacionId] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [error, setError] = useState('');
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(() => {
    api<{ recuentos: RecuentoResumen[] }>('/recuentos')
      .then((r) => setLista(r.recuentos))
      .catch(() => setLista([]));
  }, []);

  useEffect(() => {
    cargar();
    void api<{ ubicaciones: Ubicacion[] }>('/ubicaciones').then((r) => {
      setUbicaciones(r.ubicaciones);
      if (r.ubicaciones[0]) setUbicacionId((u) => u || r.ubicaciones[0]!.id);
    });
    void categorias().then((arbol) => setOpcionesCategoria(aplanarCategorias(arbol)));
  }, [cargar]);

  const crear = async () => {
    if (!nombre.trim()) {
      setError('Ponle un nombre al recuento (ej.: «Snacks mostrador 02-09»).');
      return;
    }
    setCreando(true);
    setError('');
    try {
      const r = await api<{ id: string }>('/recuentos', {
        method: 'POST',
        body: JSON.stringify({ nombre: nombre.trim(), ubicacionId, ...(categoriaId ? { categoriaId } : {}) }),
      });
      setNuevoAbierto(false);
      navigate(`/admin/recuentos/${r.id}`);
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'RECUENTO_DEMASIADO_GRANDE') {
        setError(typeof e.cuerpo.detalle === 'string' ? e.cuerpo.detalle : 'Demasiados productos: elige una subcategoría.');
      } else {
        setError('No se pudo crear el recuento.');
      }
    } finally {
      setCreando(false);
    }
  };

  return (
    <div className="p-4">
      <Encabezado
        titulo="Recuentos"
        extra={
          <Boton variante="principal" onClick={() => setNuevoAbierto(true)}>
            Nuevo recuento
          </Boton>
        }
      />
      <p className="mb-3 text-chico text-lab3">
        Un recuento enciende el control de stock solo en lo contado (activación gradual). Empieza por snacks y sellado; las cartas al final.
      </p>

      {lista === null ? (
        <Cargando />
      ) : lista.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje="Todavía no hay recuentos. El primero fija el punto de partida del inventario." />
        </div>
      ) : (
        <ul className="divide-y divide-sep overflow-hidden rounded-tarjeta bg-bg shadow-tarjeta">
          {lista.map((r) => (
            <li key={r.id} className="flex min-h-fila flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <Link to={`/admin/recuentos/${r.id}`} className="block truncate text-cuerpo text-lab underline-offset-2 hover:underline">
                  {r.nombre}
                </Link>
                <span className="block text-chico text-lab3">
                  {r.ubicacion.nombre} · {r.usuario.nombre} · {fecha(r.creadoEn)}
                </span>
              </span>
              <span className="num w-[120px] shrink-0 text-right text-chico text-lab2">
                {r.contadas}/{r.totalLineas} contados
              </span>
              <span className="w-[120px] shrink-0 text-right text-chico">
                {r.porcentajeCuadrado !== null ? (
                  <span className={`num font-semibold ${r.porcentajeCuadrado === 100 ? 'text-ok' : 'text-alerta'}`}>{r.porcentajeCuadrado}% cuadrado</span>
                ) : (
                  <span className="text-lab3">—</span>
                )}
              </span>
              <span className="w-[96px] shrink-0">
                <Insignia tono={ETIQUETA_ESTADO[r.estado].tono}>{ETIQUETA_ESTADO[r.estado].texto}</Insignia>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialogo abierto={nuevoAbierto} titulo="Nuevo recuento" onCerrar={() => setNuevoAbierto(false)} cerrable={!creando}>
        <div className="flex flex-col gap-3">
          <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Snacks mostrador 02-09" autoFocus />
          <Selecto etiqueta="Ubicación" valor={ubicacionId} onValor={setUbicacionId} opciones={ubicaciones.map((u) => ({ valor: u.id, etiqueta: u.nombre }))} />
          <Selecto
            etiqueta="Alcance"
            valor={categoriaId}
            onValor={setCategoriaId}
            opciones={opcionesCategoria.map((c) => ({ valor: c.id, etiqueta: c.etiqueta }))}
            vacia="Solo lo que escanee (sin lista previa)"
          />
          <p className="text-chico text-lab3">
            Con una categoría, el recuento parte con todos sus productos activos (tope 500 por tanda). Sin categoría, se van agregando al escanear.
          </p>
          {error ? <p className="text-chico text-peligro">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Boton onClick={() => setNuevoAbierto(false)}>Cancelar</Boton>
            <Boton variante="principal" cargando={creando} onClick={() => void crear()}>
              Crear y contar
            </Boton>
          </div>
        </div>
      </Dialogo>
    </div>
  );
}

/* ---------- Detalle ---------- */

export function RecuentoDetalle() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [datos, setDatos] = useState<RecuentoDetalleDatos | null>(null);
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<ProductoCache[]>([]);
  const [indice, setIndice] = useState(0);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const [cerrarAbierto, setCerrarAbierto] = useState(false);
  const [descartarAbierto, setDescartarAbierto] = useState(false);
  const [notaDescarte, setNotaDescarte] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const refInput = useRef<HTMLInputElement>(null);

  const cargar = useCallback(() => {
    if (!id) return;
    api<RecuentoDetalleDatos>(`/recuentos/${id}`)
      .then(setDatos)
      .catch(() => setError('No se pudo cargar el recuento.'));
  }, [id]);

  useEffect(() => {
    void hidratarCatalogo();
    cargar();
  }, [cargar]);

  const abierto = datos?.estado === 'abierto';

  // Foco permanente en el escáner mientras el recuento esté abierto (I2 de 05-SDD).
  useEffect(() => {
    if (!abierto || cerrarAbierto || descartarAbierto) return;
    const devolver = () => {
      const activo = document.activeElement;
      if (activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement) return;
      refInput.current?.focus();
    };
    devolver();
    const idInt = setInterval(devolver, 600);
    return () => clearInterval(idInt);
  }, [abierto, cerrarAbierto, descartarAbierto]);

  useEffect(() => {
    setResultados(texto.trim().length >= 2 ? buscarLocal(texto) : []);
    setIndice(0);
  }, [texto]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 2500);
    return () => clearTimeout(t);
  }, [aviso]);

  const actualizarLinea = (linea: Linea) =>
    setDatos((prev) => {
      if (!prev) return prev;
      const existe = prev.lineas.some((l) => l.productoId === linea.productoId);
      const lineas = existe ? prev.lineas.map((l) => (l.productoId === linea.productoId ? linea : l)) : [...prev.lineas, linea].sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, 'es'));
      return { ...prev, lineas };
    });

  // Escáner / selección: suma 1 a la línea (la crea si no estaba en el alcance).
  const sumarUno = async (p: ProductoCache) => {
    if (!id) return;
    setTexto('');
    setResultados([]);
    try {
      const linea = await api<Linea>(`/recuentos/${id}/lineas`, { method: 'POST', body: JSON.stringify({ productoId: p.id, sumar: 1 }) });
      actualizarLinea(linea);
      setAviso(`${p.nombre}: ${linea.cantidadContada}`);
    } catch (e) {
      setError(e instanceof ErrorApi ? `No se pudo contar (${e.codigo}).` : 'Sin conexión.');
    }
  };

  const fijarContada = async (linea: Linea, valor: number | null) => {
    if (!id) return;
    try {
      const l = await api<Linea>(`/recuentos/${id}/lineas/${linea.productoId}`, { method: 'PATCH', body: JSON.stringify({ cantidadContada: valor }) });
      actualizarLinea(l);
    } catch {
      setError('No se pudo guardar el conteo.');
    }
  };

  const alTeclear = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndice((i) => Math.min(i + 1, resultados.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndice((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setTexto('');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const exacto = porCodigoBarras(texto);
      const elegido = exacto ?? resultados[indice] ?? resultados[0];
      if (elegido) void sumarUno(elegido);
    }
  };

  const resumen = useMemo(() => {
    const lineas = datos?.lineas ?? [];
    const contadas = lineas.filter((l) => l.cantidadContada !== null);
    const conDiferencia = contadas.filter((l) => l.cantidadContada !== l.stockVigente);
    const encender = contadas.filter((l) => !l.producto.controlaStock).length;
    return { total: lineas.length, contadas: contadas.length, conDiferencia: conDiferencia.length, encender };
  }, [datos]);

  const cerrar = async () => {
    if (!id) return;
    setProcesando(true);
    try {
      const r = await api<{ resumen: { contadas: number; conDiferencia: number; encendidos: number } }>(`/recuentos/${id}/cerrar`, { method: 'POST', body: '{}' });
      setCerrarAbierto(false);
      setAviso(`Cerrado: ${r.resumen.contadas} contados, ${r.resumen.conDiferencia} con diferencia, ${r.resumen.encendidos} productos ahora controlan stock.`);
      cargar();
    } catch (e) {
      setError(e instanceof ErrorApi ? `No se pudo cerrar (${e.codigo}).` : 'Sin conexión.');
    } finally {
      setProcesando(false);
    }
  };

  const descartar = async () => {
    if (!id || !notaDescarte.trim()) return;
    setProcesando(true);
    try {
      await api(`/recuentos/${id}/descartar`, { method: 'POST', body: JSON.stringify({ nota: notaDescarte.trim() }) });
      navigate('/admin/recuentos');
    } catch {
      setError('No se pudo descartar.');
    } finally {
      setProcesando(false);
    }
  };

  if (!datos) return <div className="p-4">{error ? <Banner tono="peligro">{error}</Banner> : <Cargando />}</div>;

  const lineasVisibles = soloPendientes ? datos.lineas.filter((l) => l.cantidadContada === null) : datos.lineas;
  const progreso = resumen.total > 0 ? Math.round((resumen.contadas / resumen.total) * 100) : 0;

  return (
    <div className="p-4">
      <Encabezado
        titulo={datos.nombre}
        extra={
          <span className="flex items-center gap-2">
            <Insignia tono={ETIQUETA_ESTADO[datos.estado].tono}>{ETIQUETA_ESTADO[datos.estado].texto}</Insignia>
            <Link to="/admin/recuentos" className="text-chico text-lab2 underline underline-offset-2">
              ← Recuentos
            </Link>
          </span>
        }
      />
      <p className="mb-3 text-chico text-lab3">
        {datos.ubicacion.nombre} · {datos.usuario.nombre} · {fecha(datos.creadoEn)}
        {datos.cerradoEn ? ` · cerrado ${fecha(datos.cerradoEn)}` : ''}
        {datos.nota ? ` · ${datos.nota}` : ''}
      </p>

      {abierto ? (
        <div className="mb-3">
          <div className="flex h-tactil items-center rounded-campo border border-ac bg-bg px-3">
            <span aria-hidden="true" className="mr-2 text-lab3">
              ⌕
            </span>
            <input
              ref={refInput}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={alTeclear}
              placeholder="Escanea o escribe el producto y pulsa Enter: suma 1"
              aria-label="Escanear o buscar producto para contar"
              className="w-full bg-transparent text-lab outline-none"
              autoComplete="off"
            />
          </div>
          {resultados.length > 0 ? (
            <ul className="mt-2 max-h-[240px] divide-y divide-sep overflow-y-auto rounded-tarjeta bg-bg shadow-tarjeta">
              {resultados.map((p, i) => (
                <li key={p.id}>
                  <button type="button" onClick={() => void sumarUno(p)} className={`flex h-[44px] w-full items-center justify-between px-3 text-left ${i === indice ? 'bg-ac-suave' : ''}`}>
                    <span className="min-w-0 truncate text-cuerpo text-lab">{p.nombre}</span>
                    <span className="ml-2 shrink-0 font-mono text-chico text-lab3">{p.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : texto.trim().length >= 2 && !catalogoListo() ? (
            <p className="mt-1 text-chico text-lab3">Cargando catálogo…</p>
          ) : null}
        </div>
      ) : null}

      {aviso ? (
        <div className="mb-3">
          <Banner tono="ok">{aviso}</Banner>
        </div>
      ) : null}
      {error ? (
        <div className="mb-3">
          <Banner tono="peligro" accion={<Boton onClick={() => setError('')}>Cerrar</Boton>}>
            {error}
          </Banner>
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-[240px] flex-1">
          <div className="flex items-center justify-between text-chico text-lab2">
            <span>
              Contados {resumen.contadas} de {resumen.total}
              {resumen.conDiferencia > 0 ? ` · ${resumen.conDiferencia} con diferencia` : ''}
            </span>
            <span className="num">{progreso}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-bg2">
            <div className="h-full bg-ac-relleno transition-all" style={{ width: `${progreso}%` }} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-chico text-lab2">
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
          Solo pendientes
        </label>
      </div>

      {datos.lineas.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje="Sin productos todavía. Escanea o busca arriba para ir agregando." />
        </div>
      ) : (
        <>
          <div className="hidden items-center gap-3 px-3 pb-1 text-chico text-lab3 sm:flex">
            <span className="flex-1">Producto</span>
            <span className="w-[80px] shrink-0 text-right">Sistema</span>
            <span className="w-[112px] shrink-0 text-right">Contado</span>
            <span className="w-[88px] shrink-0 text-right">Diferencia</span>
          </div>
          <ul className="divide-y divide-sep overflow-hidden rounded-tarjeta bg-bg shadow-tarjeta">
            {lineasVisibles.map((l) => {
              const sistema = datos.estado === 'abierto' ? l.stockVigente : l.cantidadSistema;
              const dif = l.cantidadContada === null ? null : l.cantidadContada - sistema;
              return (
                <li key={l.id} className="flex min-h-fila items-center gap-3 px-3 py-1">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-cuerpo text-lab">{l.producto.nombre}</span>
                    <span className="block font-mono text-chico text-lab3">
                      {l.producto.sku}
                      {!l.producto.controlaStock ? ' · se encenderá al cerrar' : ''}
                    </span>
                  </span>
                  <span className={`num w-[80px] shrink-0 text-right text-cuerpo ${sistema < 0 ? 'text-peligro' : 'text-lab2'}`}>{sistema}</span>
                  <span className="w-[112px] shrink-0 text-right">
                    {abierto ? (
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={l.cantidadContada ?? ''}
                        placeholder="—"
                        onChange={(e) => {
                          const v = e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value)));
                          actualizarLinea({ ...l, cantidadContada: v });
                        }}
                        onBlur={(e) => void fijarContada(l, e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        aria-label={`Contado de ${l.producto.nombre}`}
                        className="num h-[36px] w-[96px] rounded-campo border border-sep bg-bg px-2 text-right text-cuerpo text-lab outline-none"
                      />
                    ) : (
                      <span className="num text-cuerpo text-lab">{l.cantidadContada ?? '—'}</span>
                    )}
                  </span>
                  <span className={`num w-[88px] shrink-0 text-right text-cuerpo font-semibold ${dif === null ? 'text-lab3' : dif === 0 ? 'text-ok' : 'text-alerta'}`}>
                    {dif === null ? '—' : dif > 0 ? `+${dif}` : dif}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {abierto ? (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Boton variante="peligro" onClick={() => setDescartarAbierto(true)}>
            Descartar
          </Boton>
          <Boton variante="principal" deshabilitado={resumen.contadas === 0} motivoDeshabilitado="Cuenta al menos un producto." onClick={() => setCerrarAbierto(true)}>
            Cerrar recuento
          </Boton>
        </div>
      ) : null}

      <Dialogo abierto={cerrarAbierto} titulo="Cerrar recuento" onCerrar={() => setCerrarAbierto(false)} cerrable={!procesando}>
        <div className="flex flex-col gap-3">
          <p className="text-cuerpo text-lab">
            {resumen.contadas} contado{resumen.contadas === 1 ? '' : 's'}, {resumen.conDiferencia} con diferencia. Se encenderá el control de stock en{' '}
            {resumen.encender} producto{resumen.encender === 1 ? '' : 's'}.
          </p>
          <p className="text-chico text-lab3">
            Las diferencias se registran como movimientos en {datos.ubicacion.nombre}. Lo no contado no cambia ni se enciende. Nada se borra: un recuento posterior corrige.
          </p>
          <div className="flex justify-end gap-2">
            <Boton onClick={() => setCerrarAbierto(false)} deshabilitado={procesando}>
              Volver
            </Boton>
            <Boton variante="principal" cargando={procesando} onClick={() => void cerrar()}>
              Confirmar cierre
            </Boton>
          </div>
        </div>
      </Dialogo>

      <Dialogo abierto={descartarAbierto} titulo="Descartar recuento" onCerrar={() => setDescartarAbierto(false)} cerrable={!procesando}>
        <div className="flex flex-col gap-3">
          <p className="text-chico text-lab2">No genera movimientos ni enciende nada. Queda en el historial con tu nota.</p>
          <Campo etiqueta="Motivo (obligatorio)" value={notaDescarte} onChange={(e) => setNotaDescarte(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Boton onClick={() => setDescartarAbierto(false)} deshabilitado={procesando}>
              Volver
            </Boton>
            <Boton variante="peligro" cargando={procesando} deshabilitado={!notaDescarte.trim()} motivoDeshabilitado="Escribe el motivo." onClick={() => void descartar()}>
              Descartar
            </Boton>
          </div>
        </div>
      </Dialogo>
    </div>
  );
}
