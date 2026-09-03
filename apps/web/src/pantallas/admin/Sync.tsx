// V12 — Sincronización (06-SDD §10, solo admin). Reemplaza a V10: la insignia
// «SOLO LECTURA · Etapa 1» desaparece y aparece el estado real de los interruptores
// por canal (ingesta · precio · stock), las marcas de agua, la última corrida de cada
// tipo y Simular (principal) frente a Publicar (secundario) — regla S1. Muestra las dos
// bitácoras: SyncLog de E1 (pull de catálogo) y SyncCorrida de E3 (ingesta y push).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorApi, api } from '../../api.js';
import { useEnLinea } from '../../tema.js';
import { fecha, hora } from '../../utils/formato.js';
import { Banner, Boton, Cargando, Insignia, Segmentado, Vacio } from '../../components/base.js';
import {
  ETIQUETA_CORRIDA,
  NOMBRE_CANAL,
  type CanalSync,
  type Corrida,
  type ItemPlan,
  type RespuestaCanales,
  type ResumenCompleta,
  type ResumenCorrida,
  type TipoCorrida,
} from '../../tiposSync.js';
import { Encabezado, Paginacion } from './util.js';

const CANALES = [
  { id: 'onplay_cl', nombre: 'onplay.cl' },
  { id: 'onplaygames_cl', nombre: 'onplaygames.cl' },
];

interface EstadoSync {
  soloLectura: boolean;
  canales: { canalId: string; productos: number; ultimoSync: string | null }[];
  erroresAbiertos: number;
}

interface ResumenImportacion {
  canalId: string;
  dryRun: boolean;
  procesados: number;
  creados: number;
  actualizados: number;
  omitidos: number;
  sinPrecio: number;
  sinClasificar: number;
  duplicadosMarcados: number;
  errores: { detalle: string }[];
  duracionMs: number;
}

interface RegistroSync {
  id: string;
  canalId: string | null;
  operacion: string;
  resultado: string;
  resuelto: boolean;
  detalle: string | null;
  creadoEn: string;
}

type Interruptor = 'ingestaPedidos' | 'pushPrecio' | 'pushStock';
const INTERRUPTORES: { clave: Interruptor; etiqueta: string; marca: keyof CanalSync; ayuda: string }[] = [
  { clave: 'ingestaPedidos', etiqueta: 'Ingesta de pedidos', marca: 'ultimaIngestaEn', ayuda: 'Lee los pedidos pagados del canal y descuenta stock. Solo lectura hacia la web.' },
  { clave: 'pushPrecio', etiqueta: 'Publicar precio', marca: 'ultimoPushPrecioEn', ayuda: 'Escribe regular_price en el canal. No toca productos en oferta.' },
  { clave: 'pushStock', etiqueta: 'Publicar stock', marca: 'ultimoPushStockEn', ayuda: 'Escribe stock_quantity solo si nadie tocó el canal desde la última publicación.' },
];

const MENSAJE_ERROR: Record<string, string> = {
  INGESTA_REQUERIDA: 'Primero hay que encender la ingesta de pedidos. Publicar stock sin ingerir ventas online produce diferencias en cada corrida.',
  CANDADO_SOLO_LECTURA: 'El candado SYNC_SOLO_LECTURA sigue activo en el servidor (Fase 0 de E3): el push no puede encenderse hasta abrirlo.',
  CORRIDA_EN_CURSO: 'Ya hay una corrida de ese tipo en curso. Espera a que termine.',
  CANAL_SIN_CREDENCIALES: 'El canal no tiene claves configuradas en el servidor.',
  INGESTA_APAGADA: 'La ingesta de pedidos está apagada en este canal.',
  PUSH_APAGADO: 'Ese push está apagado en este canal.',
  CANAL_ILEGIBLE: 'No se pudo leer el canal. Revisa la bitácora de corridas.',
};

function esResumen(x: ResumenCorrida | { omitida: string }): x is ResumenCorrida {
  return 'resumen' in x;
}

export function Sync() {
  const enLinea = useEnLinea();
  const [canales, setCanales] = useState<RespuestaCanales | null>(null);
  const [estado, setEstado] = useState<EstadoSync | null>(null);
  const [resumenImport, setResumenImport] = useState<ResumenImportacion | null>(null);
  const [resultado, setResultado] = useState<{ canalId: string; completa?: ResumenCompleta; corrida?: ResumenCorrida } | null>(null);
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [bitacora, setBitacora] = useState<'corridas' | 'catalogo'>('corridas');
  const [corridas, setCorridas] = useState<{ total: number; porPagina: number; corridas: Corrida[] } | null>(null);
  const [logs, setLogs] = useState<{ total: number; porPagina: number; logs: RegistroSync[] } | null>(null);
  const [soloErrores, setSoloErrores] = useState<'si' | null>('si');
  const [pagina, setPagina] = useState(1);

  const cargarCanales = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([api<RespuestaCanales>('/canales'), api<EstadoSync>('/sync/estado')]);
      setCanales(c);
      setEstado(e);
    } catch {
      setError('No se pudo cargar el estado de sincronización.');
    }
  }, []);

  const cargarBitacora = useCallback(async () => {
    try {
      if (bitacora === 'corridas') {
        setCorridas(await api<{ total: number; porPagina: number; corridas: Corrida[] }>(`/sync/corridas?pagina=${pagina}`));
      } else {
        const p = new URLSearchParams({ pagina: String(pagina) });
        if (soloErrores) {
          p.set('resultado', 'error');
          p.set('resuelto', 'false');
        }
        setLogs(await api<{ total: number; porPagina: number; logs: RegistroSync[] }>(`/sync/logs?${p}`));
      }
    } catch {
      setError('No se pudo cargar la bitácora.');
    }
  }, [bitacora, pagina, soloErrores]);

  useEffect(() => {
    void cargarCanales();
  }, [cargarCanales]);
  useEffect(() => {
    void cargarBitacora();
  }, [cargarBitacora]);

  const mostrarError = (e: unknown, porDefecto: string) => {
    if (e instanceof ErrorApi) {
      const detalle = typeof e.cuerpo.detalle === 'string' ? e.cuerpo.detalle : '';
      setError(MENSAJE_ERROR[e.codigo] ?? (detalle ? `${e.codigo}: ${detalle}` : porDefecto));
    } else setError(porDefecto);
  };

  const cambiarInterruptor = async (canal: CanalSync, clave: Interruptor, valor: boolean) => {
    setError(null);
    setAviso(null);
    try {
      await api(`/canales/${canal.id}`, { method: 'PATCH', body: JSON.stringify({ [clave]: valor }) });
      setAviso(`${INTERRUPTORES.find((i) => i.clave === clave)?.etiqueta} ${valor ? 'encendido' : 'apagado'} en ${NOMBRE_CANAL[canal.id] ?? canal.id}.`);
      await cargarCanales();
    } catch (e) {
      mostrarError(e, 'No se pudo cambiar el interruptor.');
    }
  };

  const correr = async (canalId: string, ruta: 'completa' | 'pedidos' | 'precios' | 'stock' | 'adoptar', dryRun: boolean) => {
    if (!dryRun && ruta !== 'pedidos' && ruta !== 'adoptar' && !window.confirm(`Esto ESCRIBE en ${NOMBRE_CANAL[canalId] ?? canalId}. ¿Publicar de verdad?`)) return;
    if (!dryRun && ruta === 'adoptar' && !window.confirm('La adopción fija «lo que hay en el canal es el punto de partida» para todos los productos con control de stock. No escribe en el canal. ¿Continuar?')) return;
    setCorriendo(`${canalId}:${ruta}:${dryRun}`);
    setError(null);
    setAviso(null);
    setResultado(null);
    setResumenImport(null);
    try {
      if (ruta === 'completa') {
        setResultado({ canalId, completa: await api<ResumenCompleta>(`/sync/${canalId}/completa?dryRun=${dryRun}`, { method: 'POST' }) });
      } else {
        setResultado({ canalId, corrida: await api<ResumenCorrida>(`/sync/${canalId}/${ruta}?dryRun=${dryRun}`, { method: 'POST' }) });
      }
      await Promise.all([cargarCanales(), cargarBitacora()]);
    } catch (e) {
      mostrarError(e, 'La corrida falló. Revisa la bitácora de corridas.');
      await cargarBitacora();
    } finally {
      setCorriendo(null);
    }
  };

  const importar = async (canalId: string, dryRun: boolean) => {
    if (!dryRun && !window.confirm('Esto escribe en el catálogo maestro. ¿Importar de verdad?')) return;
    setCorriendo(`${canalId}:importar:${dryRun}`);
    setResultado(null);
    setResumenImport(null);
    setError(null);
    try {
      setResumenImport(await api<ResumenImportacion>(`/sync/${canalId}/importar?dryRun=${dryRun}`, { method: 'POST' }));
      await Promise.all([cargarCanales(), cargarBitacora()]);
    } catch {
      setError('La importación falló. Revisa la bitácora y vuelve a intentar.');
    } finally {
      setCorriendo(null);
    }
  };

  const buscarClientes = async (canalId: string) => {
    setCorriendo(`${canalId}:clientes`);
    setError(null);
    try {
      const r = await api<{ totalCanal: number; vinculos: unknown[]; sinCoincidencia: unknown[] }>(`/sync/${canalId}/clientes`, { method: 'POST' });
      setAviso(`Se revisaron ${r.totalCanal} cuentas del canal: ${r.vinculos.length} coinciden por correo y ${r.sinCoincidencia.length} no. Revisa los candidatos en Clientes.`);
      await cargarBitacora();
    } catch {
      setError('La búsqueda de clientes falló.');
    } finally {
      setCorriendo(null);
    }
  };

  const marcarResuelto = async (id: string) => {
    try {
      await api(`/sync/logs/${id}`, { method: 'PATCH', body: JSON.stringify({ resuelto: true }) });
      await Promise.all([cargarCanales(), cargarBitacora()]);
    } catch {
      setError('No se pudo marcar el registro como resuelto.');
    }
  };

  const ocupado = corriendo !== null || !enLinea;
  const motivo = !enLinea ? 'Necesitas conexión para esto.' : undefined;

  return (
    <div className="p-4">
      <Encabezado
        titulo="Sincronización"
        extra={
          canales ? (
            canales.soloLectura ? (
              <Insignia tono="alerta">Candado SOLO LECTURA activo · el maestro no escribe en los canales</Insignia>
            ) : (
              <Insignia tono="ok">Escritura habilitada · toda corrida simula por defecto</Insignia>
            )
          ) : null
        }
      />
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

      {canales === null || estado === null ? (
        <Cargando />
      ) : (
        <>
          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            {CANALES.map((c) => {
              const canal = canales.canales.find((x) => x.id === c.id);
              const info = estado.canales.find((x) => x.canalId === c.id);
              if (!canal) return null;
              return (
                <div key={c.id} className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-cuerpo font-semibold text-lab">{c.nombre}</p>
                    <p className="text-chico text-lab2">
                      {info ? `${info.productos} vínculos` : 'sin productos'}
                      {info?.ultimoSync ? ` · catálogo leído ${fecha(info.ultimoSync)} ${hora(info.ultimoSync)}` : ''}
                      {!canal.credenciales ? ' · sin claves' : ''}
                    </p>
                  </div>

                  <ul className="mt-3 divide-y divide-sep rounded-campo border border-sep">
                    {INTERRUPTORES.map((i) => {
                      const encendido = canal[i.clave] as boolean;
                      const marca = canal[i.marca] as string | null;
                      const ultima = canal.ultimasCorridas.find((u) => u.tipo === (i.clave === 'ingestaPedidos' ? 'pedidos' : i.clave === 'pushPrecio' ? 'precios' : 'stock'));
                      return (
                        <li key={i.clave} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-cuerpo text-lab">
                              {i.etiqueta}{' '}
                              {encendido ? <Insignia tono="ok">encendido</Insignia> : <Insignia>apagado</Insignia>}
                            </p>
                            <p className="text-chico text-lab3">
                              {i.ayuda}
                              {marca ? ` · última corrida real ${fecha(marca)} ${hora(marca)}` : ' · nunca corrió de verdad'}
                              {ultima
                                ? ` · última corrida: ${ultima.simulacion ? 'simulación' : 'real'} ${ultima.estado}, ${ultima.leidos} leídos, ${ultima.escritos} escritos, ${ultima.detenidos} detenidos, ${ultima.fallidos} fallidos`
                                : ''}
                            </p>
                          </div>
                          <label className="flex cursor-pointer items-center gap-2 text-chico text-lab2">
                            <input type="checkbox" checked={encendido} disabled={ocupado} onChange={(e) => void cambiarInterruptor(canal, i.clave, e.target.checked)} />
                            {encendido ? 'Apagar' : 'Encender'}
                          </label>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Boton variante="principal" cargando={corriendo === `${c.id}:completa:true`} deshabilitado={ocupado} motivoDeshabilitado={motivo} onClick={() => void correr(c.id, 'completa', true)}>
                      Simular corrida completa
                    </Boton>
                    <Boton cargando={corriendo === `${c.id}:completa:false`} deshabilitado={ocupado} onClick={() => void correr(c.id, 'completa', false)}>
                      Publicar (corrida real)
                    </Boton>
                    <Boton cargando={corriendo === `${c.id}:pedidos:false`} deshabilitado={ocupado || !canal.ingestaPedidos} motivoDeshabilitado={!canal.ingestaPedidos && enLinea ? 'Enciende la ingesta primero.' : motivo} onClick={() => void correr(c.id, 'pedidos', false)}>
                      Ingerir pedidos ahora
                    </Boton>
                    <Boton cargando={corriendo === `${c.id}:adoptar:true`} deshabilitado={ocupado} onClick={() => void correr(c.id, 'adoptar', true)}>
                      Simular adopción de stock
                    </Boton>
                    <Boton cargando={corriendo === `${c.id}:adoptar:false`} deshabilitado={ocupado} onClick={() => void correr(c.id, 'adoptar', false)}>
                      Adoptar stock del canal
                    </Boton>
                    <Boton cargando={corriendo === `${c.id}:stock:true`} deshabilitado={ocupado} onClick={() => void correr(c.id, 'stock', true)}>
                      Simular solo stock
                    </Boton>
                  </div>

                  <details className="mt-3">
                    <summary className="cursor-pointer text-chico text-lab3">Catálogo (Etapa 1: pull de productos y clientes)</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <Boton cargando={corriendo === `${c.id}:importar:true`} deshabilitado={ocupado} onClick={() => void importar(c.id, true)}>
                        Simular importación
                      </Boton>
                      <Boton cargando={corriendo === `${c.id}:importar:false`} deshabilitado={ocupado} onClick={() => void importar(c.id, false)}>
                        Importar
                      </Boton>
                      <Boton cargando={corriendo === `${c.id}:clientes`} deshabilitado={ocupado} onClick={() => void buscarClientes(c.id)}>
                        Buscar clientes
                      </Boton>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>

          <p className="mb-4 text-chico text-lab3">
            Ubicación online: <span className="font-mono">{canales.ubicacionOnline}</span> · las diferencias detectadas se revisan en{' '}
            <Link to="/admin/discrepancias" className="text-ac underline">
              Discrepancias
            </Link>{' '}
            y los pedidos ingeridos en{' '}
            <Link to="/admin/pedidos" className="text-ac underline">
              Pedidos online
            </Link>
            .
          </p>

          {resultado?.completa ? <ResultadoCompleta r={resultado.completa} /> : null}
          {resultado?.corrida ? <TarjetaCorrida r={resultado.corrida} /> : null}
          {resumenImport ? (
            <div className="mb-4 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
              <div className="mb-2 flex items-center gap-2">
                <p className="text-cuerpo font-semibold text-lab">Importación · {NOMBRE_CANAL[resumenImport.canalId] ?? resumenImport.canalId}</p>
                {resumenImport.dryRun ? <Insignia>simulación: no se escribió nada</Insignia> : <Insignia tono="ok">importado</Insignia>}
              </div>
              <p className="num text-cuerpo text-lab2">
                {resumenImport.procesados} procesados · {resumenImport.creados} creados · {resumenImport.actualizados} actualizados · {resumenImport.omitidos} omitidos ·{' '}
                {resumenImport.sinPrecio} sin precio · {resumenImport.duplicadosMarcados} posibles duplicados · {resumenImport.errores.length} errores · {(resumenImport.duracionMs / 1000).toFixed(1)} s
              </p>
            </div>
          ) : null}

          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <Segmentado<'corridas' | 'catalogo'>
              opciones={[
                { valor: 'corridas', etiqueta: 'Corridas (E3)' },
                { valor: 'catalogo', etiqueta: 'Catálogo (E1)' },
              ]}
              valor={bitacora}
              onChange={(v) => {
                setBitacora(v ?? 'corridas');
                setPagina(1);
              }}
            />
            {bitacora === 'catalogo' ? (
              <div className="flex items-center gap-3">
                {estado.erroresAbiertos > 0 ? <Insignia tono="peligro">{estado.erroresAbiertos} error(es) abiertos</Insignia> : <Insignia tono="ok">0 errores abiertos</Insignia>}
                <Segmentado
                  opciones={[{ valor: 'si', etiqueta: 'Solo errores abiertos' }]}
                  valor={soloErrores}
                  onChange={(v) => {
                    setSoloErrores(v);
                    setPagina(1);
                  }}
                />
              </div>
            ) : null}
          </div>

          {bitacora === 'corridas' ? (
            corridas === null ? (
              <Cargando />
            ) : corridas.corridas.length === 0 ? (
              <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
                <Vacio mensaje="Todavía no hay corridas." />
              </div>
            ) : (
              <>
                <ul className="divide-y divide-sep overflow-hidden rounded-tarjeta bg-bg shadow-tarjeta">
                  {corridas.corridas.map((k) => (
                    <li key={k.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Insignia tono={k.estado === 'terminada' ? (k.fallidos > 0 ? 'alerta' : 'ok') : k.estado === 'abortada' ? 'peligro' : 'neutro'}>{k.estado}</Insignia>
                        <span className="text-cuerpo text-lab">{ETIQUETA_CORRIDA[k.tipo as TipoCorrida] ?? k.tipo}</span>
                        <span className="font-mono text-chico text-lab3">{NOMBRE_CANAL[k.canalId] ?? k.canalId}</span>
                        {k.simulacion ? <Insignia>simulación</Insignia> : <Insignia tono="alerta">real</Insignia>}
                        <span className="text-chico text-lab3">
                          {fecha(k.iniciadaEn)} {hora(k.iniciadaEn)} · {k.usuario?.nombre ?? 'automática'}
                        </span>
                      </div>
                      <p className="num mt-1 text-chico text-lab2">
                        {k.leidos} leídos · {k.aEscribir} a escribir · {k.escritos} escritos · {k.omitidos} omitidos · {k.detenidos} detenidos · {k.fallidos} fallidos
                        {k.mensaje ? ` · ${k.mensaje}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
                <Paginacion pagina={pagina} porPagina={corridas.porPagina} total={corridas.total} onPagina={setPagina} />
              </>
            )
          ) : logs === null ? (
            <Cargando />
          ) : logs.logs.length === 0 ? (
            <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
              <Vacio mensaje={soloErrores ? 'No hay errores abiertos. Ese es el estado esperado.' : 'La bitácora está vacía.'} />
            </div>
          ) : (
            <>
              <ul className="divide-y divide-sep overflow-hidden rounded-tarjeta bg-bg shadow-tarjeta">
                {logs.logs.map((registro) => (
                  <li key={registro.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Insignia tono={registro.resultado === 'error' ? 'peligro' : registro.resultado.startsWith('ok') ? 'ok' : 'neutro'}>{registro.resultado}</Insignia>
                        <span className="text-chico text-lab2">{registro.operacion}</span>
                        {registro.canalId ? <span className="font-mono text-chico text-lab3">{registro.canalId}</span> : null}
                        <span className="text-chico text-lab3">
                          {fecha(registro.creadoEn)} {hora(registro.creadoEn)}
                        </span>
                        {registro.resuelto ? <Insignia>resuelto</Insignia> : null}
                      </div>
                      {registro.detalle ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-chico text-lab3">Detalle técnico</summary>
                          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-chico text-lab2">{registro.detalle}</pre>
                        </details>
                      ) : null}
                    </div>
                    {registro.resultado === 'error' && !registro.resuelto ? (
                      <div className="w-[150px] shrink-0">
                        <Boton onClick={() => void marcarResuelto(registro.id)}>Marcar resuelto</Boton>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Paginacion pagina={pagina} porPagina={logs.porPagina} total={logs.total} onPagina={setPagina} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function ResultadoCompleta({ r }: { r: ResumenCompleta }) {
  return (
    <div className="mb-4 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-cuerpo font-semibold text-lab">Corrida completa · {NOMBRE_CANAL[r.canalId] ?? r.canalId}</p>
        {r.simulacion ? <Insignia>simulación: no se escribió nada</Insignia> : <Insignia tono="alerta">real</Insignia>}
      </div>
      {(['pedidos', 'precios', 'stock'] as const).map((k) => {
        const x = r[k];
        return (
          <div key={k} className="border-t border-sep py-2">
            <p className="text-cuerpo text-lab">
              {ETIQUETA_CORRIDA[k]}
              {esResumen(x) ? null : <span className="text-chico text-lab3"> · omitida: {x.omitida}</span>}
            </p>
            {esResumen(x) ? <Plan r={x} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function TarjetaCorrida({ r }: { r: ResumenCorrida }) {
  return (
    <div className="mb-4 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-cuerpo font-semibold text-lab">
          {ETIQUETA_CORRIDA[r.tipo as TipoCorrida] ?? r.tipo} · {NOMBRE_CANAL[r.canalId] ?? r.canalId}
        </p>
        {r.simulacion ? <Insignia>simulación: no se escribió nada</Insignia> : <Insignia tono="alerta">real</Insignia>}
      </div>
      <Plan r={r} />
    </div>
  );
}

function Plan({ r }: { r: ResumenCorrida }) {
  const [verTodo, setVerTodo] = useState(false);
  const c = r.resumen;
  const interesantes = r.plan.filter((p) => p.accion !== 'omitir');
  const lista = verTodo ? r.plan : interesantes.slice(0, 20);
  const numeros = (p: ItemPlan) => {
    const v = p.precio ?? p.stock;
    if (!v) return '';
    return ` · maestro ${v.maestro} / canal ${v.canal ?? '—'} / publicado ${v.publicado ?? '—'}`;
  };
  return (
    <>
      <p className="num text-chico text-lab2">
        {c.leidos} leídos · {c.aEscribir} a escribir · {c.escritos} escritos · {c.omitidos} omitidos · {c.detenidos} detenidos · {c.fallidos} fallidos
        {r.noElegibles !== undefined ? ` · ${r.noElegibles} sin control de stock (no entran)` : ''}
      </p>
      {r.omitida ? <p className="text-chico text-alerta">Omitida: {r.omitida}</p> : null}
      {r.advertencia ? <p className="text-chico text-alerta">{r.advertencia}</p> : null}
      {lista.length > 0 ? (
        <ul className="mt-2 max-h-[280px] overflow-y-auto rounded-campo border border-sep text-chico">
          {lista.map((p, i) => (
            <li key={`${p.sku ?? p.numero}-${i}`} className="flex flex-wrap gap-x-2 border-b border-sep px-2 py-1 last:border-b-0">
              <Insignia tono={p.accion === 'escribir' || p.accion === 'ingerir' ? 'ok' : p.accion === 'detener' || p.accion === 'fallar' ? 'peligro' : p.accion === 'revisar' ? 'alerta' : 'neutro'}>{p.accion}</Insignia>
              <span className="font-mono text-lab">{p.sku ?? `#${p.numero}`}</span>
              <span className="text-lab2">
                {p.motivo ?? ''}
                {numeros(p)}
              </span>
              {p.explicacion ? <span className="w-full text-lab3">{p.explicacion}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {r.plan.length > lista.length ? (
        <button type="button" className="mt-1 text-chico text-ac underline" onClick={() => setVerTodo(true)}>
          Ver los {r.plan.length} ítems
        </button>
      ) : null}
    </>
  );
}
