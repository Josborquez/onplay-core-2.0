// V12 v2 — Sincronización con las tiendas web (R-024). Rediseño pedido por el dueño el 2026-09-09:
// la pantalla dice QUÉ HAY QUE HACER (tarea del momento), cada tienda tiene tres bloques en orden
// (Catálogo → Pedidos de la web → Publicar en la web) explicados en lenguaje llano, no hay botones
// de «simular» (cada acción confirma en una frase lo que va a pasar) y lo bloqueado por el candado
// se muestra gris con una sola explicación. Admin y encargado usan Catálogo y Pedidos; Publicar es
// solo admin. La bitácora técnica queda plegada al pie. «Sistema» vive en su propia pantalla.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ErrorApi, api } from '../../api.js';
import { useSesion } from '../../sesion.js';
import { useEnLinea } from '../../tema.js';
import { useEstadoTiendas } from '../../tiendas.js';
import { rolAlcanza } from '../../tipos.js';
import { fecha, hora } from '../../utils/formato.js';
import { Banner, Boton, Cargando, Dialogo, Insignia, Segmentado, Vacio } from '../../components/base.js';
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
  despublicados?: number;
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

interface Tarea {
  id: string;
  estado: 'en_curso' | 'terminada' | 'fallida';
  resultado: ResumenImportacion | null;
  error: string | null;
}

interface Confirmacion {
  titulo: string;
  texto: string;
  boton: string;
  accion: () => Promise<void>;
}

const MENSAJE_ERROR: Record<string, string> = {
  INGESTA_REQUERIDA: 'Primero enciende «Pedidos de la web»: publicar stock sin descontar las ventas online produce diferencias en cada lectura.',
  CANDADO_SOLO_LECTURA: 'El servidor tiene puesto el candado de solo lectura: publicar sigue bloqueado.',
  CORRIDA_EN_CURSO: 'Esa acción ya está corriendo. Espera a que termine.',
  CANAL_SIN_CREDENCIALES: 'Esta tienda no tiene claves configuradas en el servidor.',
  INGESTA_APAGADA: '«Pedidos de la web» está apagado en esta tienda.',
  PUSH_APAGADO: 'Ese tipo de publicación está apagado en esta tienda.',
  CANAL_ILEGIBLE: 'No se pudo leer la tienda. Revisa la bitácora al pie.',
  ROL_INSUFICIENTE: 'Solo el administrador puede hacer eso.',
};

function esResumen(x: ResumenCorrida | { omitida: string }): x is ResumenCorrida {
  return 'resumen' in x;
}

/** «hace 12 min», «hace 3 h», «el 09-09-2026 a las 14:00», «nunca». */
export function hace(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `el ${fecha(iso)} a las ${hora(iso)}`;
}

function Bloque({ numero, titulo, ayuda, estado, atenuado, children }: { numero: number; titulo: string; ayuda: string; estado?: ReactNode; atenuado?: boolean; children?: ReactNode }) {
  return (
    <section className={`border-t border-sep py-3 ${atenuado ? 'opacity-60' : ''}`}>
      <p className="text-cuerpo font-semibold text-lab">
        <span className="mr-2 inline-block h-5 w-5 rounded-full bg-ac-suave text-center text-chico leading-5 text-lab">{numero}</span>
        {titulo}
      </p>
      <p className="mt-1 text-chico text-lab3">{ayuda}</p>
      {estado ? <p className="mt-1 text-chico text-lab2">{estado}</p> : null}
      {children ? <div className="mt-2 flex flex-wrap gap-2">{children}</div> : null}
    </section>
  );
}

export function Sync() {
  const { usuario } = useSesion();
  const esAdmin = !!usuario && rolAlcanza(usuario.rol, 'admin');
  const enLinea = useEnLinea();
  const tiendas = useEstadoTiendas();
  const [canales, setCanales] = useState<RespuestaCanales | null>(null);
  const [estado, setEstado] = useState<EstadoSync | null>(null);
  const [resumenImport, setResumenImport] = useState<ResumenImportacion | null>(null);
  const [resultado, setResultado] = useState<{ canalId: string; completa?: ResumenCompleta; corrida?: ResumenCorrida } | null>(null);
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [bitacora, setBitacora] = useState<'catalogo' | 'corridas'>('catalogo');
  const [corridas, setCorridas] = useState<{ total: number; porPagina: number; corridas: Corrida[] } | null>(null);
  const [logs, setLogs] = useState<{ total: number; porPagina: number; logs: RegistroSync[] } | null>(null);
  const [soloErrores, setSoloErrores] = useState<'si' | null>('si');
  const [pagina, setPagina] = useState(1);
  const vivo = useRef(true);
  useEffect(() => () => void (vivo.current = false), []);

  const cargarCanales = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([api<RespuestaCanales>('/canales'), api<EstadoSync>('/sync/estado')]);
      setCanales(c);
      setEstado(e);
    } catch {
      setError('No se pudo cargar el estado de las tiendas.');
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

  const limpiar = () => {
    setError(null);
    setAviso(null);
    setResultado(null);
    setResumenImport(null);
  };

  const confirmar = async () => {
    if (!confirmacion || confirmando) return;
    setConfirmando(true);
    try {
      const accion = confirmacion.accion;
      setConfirmacion(null);
      await accion();
    } finally {
      setConfirmando(false);
    }
  };

  // ---------- 1 · Catálogo ----------
  const traerCatalogo = (canalId: string) =>
    setConfirmacion({
      titulo: `Traer el catálogo de ${NOMBRE_CANAL[canalId] ?? canalId}`,
      texto: 'Lee todos los productos de la tienda y los copia al maestro: crea los nuevos, actualiza precio y stock de la web en los que ya existen y marca como «ya no está en la tienda» lo que desapareció. No escribe nada en la web.',
      boton: 'Traer catálogo',
      accion: async () => {
        setCorriendo(`${canalId}:importar`);
        limpiar();
        setProgreso(`Leyendo ${NOMBRE_CANAL[canalId] ?? canalId}… puede tardar un minuto.`);
        try {
          const t = await api<{ tareaId: string }>(`/sync/${canalId}/importar?dryRun=false&segundoPlano=true`, { method: 'POST' });
          for (let i = 0; i < 150 && vivo.current; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            const tarea = await api<Tarea>(`/sync/tareas/${t.tareaId}`);
            if (tarea.estado === 'terminada' && tarea.resultado) {
              setResumenImport(tarea.resultado);
              break;
            }
            if (tarea.estado === 'fallida') throw new Error(tarea.error ?? 'falló');
          }
          await Promise.all([cargarCanales(), cargarBitacora()]);
        } catch (e) {
          mostrarError(e, 'La lectura del catálogo falló. Revisa la bitácora al pie y vuelve a intentar.');
          await cargarBitacora();
        } finally {
          setProgreso(null);
          setCorriendo(null);
        }
      },
    });

  const buscarClientes = (canalId: string) =>
    setConfirmacion({
      titulo: `Buscar cuentas de clientes en ${NOMBRE_CANAL[canalId] ?? canalId}`,
      texto: 'Compara las cuentas de la tienda con los clientes del mostrador por correo. Solo propone coincidencias: vincular o crear un cliente sigue siendo una decisión de una persona, en la pantalla Clientes.',
      boton: 'Buscar',
      accion: async () => {
        setCorriendo(`${canalId}:clientes`);
        limpiar();
        try {
          const r = await api<{ totalCanal: number; vinculos: unknown[]; sinCoincidencia: unknown[] }>(`/sync/${canalId}/clientes`, { method: 'POST' });
          setAviso(`Se revisaron ${r.totalCanal} cuentas de la tienda: ${r.vinculos.length} coinciden por correo con un cliente del mostrador y ${r.sinCoincidencia.length} no. Revísalas en Clientes → «Candidatos de las tiendas web».`);
          await cargarBitacora();
        } catch (e) {
          mostrarError(e, 'La búsqueda de cuentas falló.');
        } finally {
          setCorriendo(null);
        }
      },
    });

  // ---------- 2 · Pedidos de la web ----------
  const cambiarInterruptor = (canal: CanalSync, clave: 'ingestaPedidos' | 'pushPrecio' | 'pushStock', valor: boolean, texto: string, titulo: string) =>
    setConfirmacion({
      titulo,
      texto,
      boton: valor ? 'Encender' : 'Apagar',
      accion: async () => {
        limpiar();
        try {
          await api(`/canales/${canal.id}`, { method: 'PATCH', body: JSON.stringify({ [clave]: valor }) });
          await cargarCanales();
        } catch (e) {
          mostrarError(e, 'No se pudo cambiar el ajuste.');
        }
      },
    });

  const correr = (canalId: string, ruta: 'completa' | 'pedidos' | 'adoptar', titulo: string, texto: string, boton: string) =>
    setConfirmacion({
      titulo,
      texto,
      boton,
      accion: async () => {
        setCorriendo(`${canalId}:${ruta}`);
        limpiar();
        try {
          if (ruta === 'completa') {
            setResultado({ canalId, completa: await api<ResumenCompleta>(`/sync/${canalId}/completa?dryRun=false`, { method: 'POST' }) });
          } else {
            setResultado({ canalId, corrida: await api<ResumenCorrida>(`/sync/${canalId}/${ruta}?dryRun=false`, { method: 'POST' }) });
          }
          await Promise.all([cargarCanales(), cargarBitacora()]);
        } catch (e) {
          mostrarError(e, 'La acción falló. Revisa la bitácora al pie.');
          await cargarBitacora();
        } finally {
          setCorriendo(null);
        }
      },
    });

  const marcarResuelto = async (id: string) => {
    try {
      await api(`/sync/logs/${id}`, { method: 'PATCH', body: JSON.stringify({ resuelto: true }) });
      await Promise.all([cargarCanales(), cargarBitacora()]);
    } catch {
      setError('No se pudo marcar el aviso como revisado.');
    }
  };

  const ocupado = corriendo !== null || !enLinea;
  const motivo = !enLinea ? 'Necesitas conexión para esto.' : undefined;
  const infoDe = (id: string) => estado?.canales.find((x) => x.canalId === id);
  const tiendaDe = (id: string) => tiendas?.tiendas.find((t) => t.id === id);
  const listaCanales = canales?.canales.filter((c) => c.tipo === 'woocommerce') ?? [];

  // ---------- Tarea del momento ----------
  let tarea: ReactNode = null;
  if (canales && estado) {
    const conClaves = listaCanales.filter((c) => c.credenciales);
    const sinCatalogo = conClaves.filter((c) => (infoDe(c.id)?.productos ?? 0) === 0);
    if (conClaves.length === 0) {
      tarea = <Banner tono="alerta">Ninguna tienda tiene claves configuradas en el servidor. Sin claves no se puede leer nada.</Banner>;
    } else if (sinCatalogo.length > 0) {
      tarea = (
        <Banner
          tono="alerta"
          accion={
            <div className="flex gap-2">
              {sinCatalogo.map((c) => (
                <div key={c.id} className="w-[220px]">
                  <Boton variante="principal" cargando={corriendo === `${c.id}:importar`} deshabilitado={ocupado} motivoDeshabilitado={motivo} onClick={() => traerCatalogo(c.id)}>
                    Traer catálogo de {NOMBRE_CANAL[c.id] ?? c.id}
                  </Boton>
                </div>
              ))}
            </div>
          }
        >
          Todavía no hay catálogo de {sinCatalogo.map((c) => NOMBRE_CANAL[c.id] ?? c.id).join(' ni ')}. Tráelo para poder buscar y vender esos productos.
        </Banner>
      );
    } else if (estado.erroresAbiertos > 0) {
      tarea = (
        <Banner tono="alerta">
          Catálogo al día ({conClaves.map((c) => `${NOMBRE_CANAL[c.id] ?? c.id} ${hace(infoDe(c.id)?.ultimoSync)}`).join(' · ')}). Hay {estado.erroresAbiertos} aviso{estado.erroresAbiertos > 1 ? 's' : ''} de la lectura por revisar: productos sin precio o con código repetido en la tienda. Están en la bitácora al pie; se arreglan en la tienda web, no aquí.
        </Banner>
      );
    } else {
      tarea = <Banner tono="ok">Catálogo al día: {conClaves.map((c) => `${NOMBRE_CANAL[c.id] ?? c.id} ${hace(infoDe(c.id)?.ultimoSync)}`).join(' · ')}. Se refresca solo cada 30 minutos; no hay nada pendiente.</Banner>;
    }
  }

  return (
    <div className="p-4">
      <Encabezado
        titulo="Tiendas web"
        extra={
          canales ? (
            canales.soloLectura ? (
              <Insignia>Solo lectura: el maestro lee las tiendas, nunca escribe en ellas</Insignia>
            ) : (
              <Insignia tono="alerta">Escritura habilitada: publicar modifica las tiendas</Insignia>
            )
          ) : null
        }
      />
      {tarea ? <div className="mb-3">{tarea}</div> : null}
      {progreso ? (
        <div className="mb-3">
          <Banner tono="ok">{progreso}</Banner>
        </div>
      ) : null}
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
            {listaCanales.map((canal) => {
              const info = infoDe(canal.id);
              const tienda = tiendaDe(canal.id);
              const ingesta = canal.ultimasCorridas.find((u) => u.tipo === 'pedidos');
              return (
                <div key={canal.id} className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                    <p className="text-cuerpo font-semibold text-lab">{NOMBRE_CANAL[canal.id] ?? canal.nombre}</p>
                    <p className="flex items-center gap-2 text-chico text-lab2">
                      <span className={`inline-block h-2 w-2 rounded-full ${tienda?.enLinea === true ? 'bg-ok' : tienda?.enLinea === false ? 'bg-peligro' : 'bg-lab3'}`} aria-hidden="true" />
                      {tienda?.enLinea === true ? 'la tienda responde' : tienda?.enLinea === false ? 'la tienda no responde' : 'comprobando…'}
                      {!canal.credenciales ? ' · sin claves en el servidor' : ''}
                    </p>
                  </div>

                  <Bloque
                    numero={1}
                    titulo="Catálogo"
                    ayuda="Lee productos, precios y stock de la tienda y los copia al maestro. No escribe nada en la web. Se repite solo cada 30 minutos; este botón sirve para no esperar."
                    estado={`${info?.productos ?? 0} productos vinculados · última lectura ${hace(info?.ultimoSync)}`}
                  >
                    <div className="w-[200px]">
                      <Boton variante="principal" cargando={corriendo === `${canal.id}:importar`} deshabilitado={ocupado || !canal.credenciales} motivoDeshabilitado={motivo} onClick={() => traerCatalogo(canal.id)}>
                        Traer catálogo ahora
                      </Boton>
                    </div>
                    <div className="w-[220px]">
                      <Boton cargando={corriendo === `${canal.id}:clientes`} deshabilitado={ocupado || !canal.credenciales} motivoDeshabilitado={motivo} onClick={() => buscarClientes(canal.id)}>
                        Buscar cuentas de clientes
                      </Boton>
                    </div>
                  </Bloque>

                  <Bloque
                    numero={2}
                    titulo="Pedidos de la web"
                    ayuda="Lee las ventas ya pagadas en la tienda y descuenta su stock de la bodega, para que el mostrador no venda lo que la web ya vendió. Tampoco escribe en la web."
                    estado={
                      canal.ingestaPedidos
                        ? `Encendido · última lectura ${hace(canal.ultimaIngestaEn)}${ingesta ? ` · ${ingesta.leidos} pedidos leídos, ${ingesta.escritos} descontados` : ''}`
                        : 'Apagado: las ventas online no descuentan stock.'
                    }
                  >
                    <div className="w-[160px]">
                      <Boton
                        variante={canal.ingestaPedidos ? 'secundario' : 'principal'}
                        deshabilitado={ocupado || !canal.credenciales}
                        motivoDeshabilitado={motivo}
                        onClick={() =>
                          cambiarInterruptor(
                            canal,
                            'ingestaPedidos',
                            !canal.ingestaPedidos,
                            canal.ingestaPedidos
                              ? 'Las ventas de la web dejarán de descontar stock de la bodega hasta que lo vuelvas a encender.'
                              : 'Desde ahora, cada 15 minutos se leerán los pedidos pagados en la tienda y se descontará su stock de la bodega. Los pedidos anteriores a este momento no se tocan.',
                            `${canal.ingestaPedidos ? 'Apagar' : 'Encender'} pedidos de la web en ${NOMBRE_CANAL[canal.id] ?? canal.id}`,
                          )
                        }
                      >
                        {canal.ingestaPedidos ? 'Apagar' : 'Encender'}
                      </Boton>
                    </div>
                    {canal.ingestaPedidos ? (
                      <div className="w-[190px]">
                        <Boton
                          cargando={corriendo === `${canal.id}:pedidos`}
                          deshabilitado={ocupado}
                          motivoDeshabilitado={motivo}
                          onClick={() =>
                            correr(canal.id, 'pedidos', `Leer los pedidos de ${NOMBRE_CANAL[canal.id] ?? canal.id} ahora`, 'Lee los pedidos pagados desde la última lectura y descuenta su stock de la bodega. Es lo mismo que hace el reloj cada 15 minutos.', 'Leer pedidos')
                          }
                        >
                          Leer pedidos ahora
                        </Boton>
                      </div>
                    ) : null}
                  </Bloque>

                  <Bloque
                    numero={3}
                    titulo="Publicar en la web"
                    ayuda="Escribe los precios y el stock del maestro en la tienda. Es lo único de todo el sistema que modifica la web."
                    atenuado={canales.soloLectura || !esAdmin}
                    estado={
                      canales.soloLectura
                        ? 'Bloqueado: el servidor tiene puesto el candado de solo lectura. Se abre en la Fase 0 de la Etapa 3, primero en staging, con respaldo de las tiendas. Hasta entonces nada de lo que hagas aquí toca la tienda.'
                        : !esAdmin
                          ? `Solo el administrador puede publicar. Precio: ${canal.pushPrecio ? 'encendido' : 'apagado'} · Stock: ${canal.pushStock ? 'encendido' : 'apagado'}.`
                          : `Precio: ${canal.pushPrecio ? `encendido, última publicación ${hace(canal.ultimoPushPrecioEn)}` : 'apagado'} · Stock: ${canal.pushStock ? `encendido, última publicación ${hace(canal.ultimoPushStockEn)}` : 'apagado'}.`
                    }
                  >
                    {!canales.soloLectura && esAdmin ? (
                      <>
                        <div className="w-[180px]">
                          <Boton
                            deshabilitado={ocupado}
                            onClick={() =>
                              cambiarInterruptor(
                                canal,
                                'pushPrecio',
                                !canal.pushPrecio,
                                canal.pushPrecio ? 'Los cambios de precio del maestro dejarán de publicarse en la tienda.' : 'Cada cambio de precio en el maestro se escribirá en la tienda (nunca sobre productos en oferta). Cada 15 minutos se revisa que la tienda coincida.',
                                `${canal.pushPrecio ? 'Dejar de publicar' : 'Publicar'} precios en ${NOMBRE_CANAL[canal.id] ?? canal.id}`,
                              )
                            }
                          >
                            {canal.pushPrecio ? 'Apagar precios' : 'Publicar precios'}
                          </Boton>
                        </div>
                        <div className="w-[180px]">
                          <Boton
                            deshabilitado={ocupado}
                            onClick={() =>
                              cambiarInterruptor(
                                canal,
                                'pushStock',
                                !canal.pushStock,
                                canal.pushStock ? 'El stock del maestro dejará de publicarse en la tienda.' : 'El stock del maestro se escribirá en la tienda, solo para productos con control de stock y solo si nadie tocó la tienda desde la última publicación. Antes de encenderlo, toma el stock de la web como punto de partida.',
                                `${canal.pushStock ? 'Dejar de publicar' : 'Publicar'} stock en ${NOMBRE_CANAL[canal.id] ?? canal.id}`,
                              )
                            }
                          >
                            {canal.pushStock ? 'Apagar stock' : 'Publicar stock'}
                          </Boton>
                        </div>
                        <div className="w-[260px]">
                          <Boton
                            cargando={corriendo === `${canal.id}:adoptar`}
                            deshabilitado={ocupado}
                            onClick={() =>
                              correr(canal.id, 'adoptar', `Tomar el stock de ${NOMBRE_CANAL[canal.id] ?? canal.id} como punto de partida`, 'Para cada producto con control de stock, anota «lo que hay hoy en la tienda es lo publicado». No escribe en la tienda ni cambia el stock del maestro; solo fija desde dónde se comparan las diferencias.', 'Tomar como punto de partida')
                            }
                          >
                            Tomar stock de la web como punto de partida
                          </Boton>
                        </div>
                        <div className="w-[160px]">
                          <Boton
                            variante="principal"
                            cargando={corriendo === `${canal.id}:completa`}
                            deshabilitado={ocupado}
                            onClick={() => correr(canal.id, 'completa', `Publicar ahora en ${NOMBRE_CANAL[canal.id] ?? canal.id}`, 'Lee los pedidos, publica los precios y luego el stock, en ese orden, según lo que esté encendido. ESCRIBE en la tienda. Es lo mismo que hace el reloj cada 15 minutos.', 'Publicar ahora')}
                          >
                            Publicar ahora
                          </Boton>
                        </div>
                      </>
                    ) : null}
                  </Bloque>
                </div>
              );
            })}
          </div>

          <p className="mb-4 text-chico text-lab3">
            Las ventas online descuentan de la ubicación <span className="font-mono">{canales.ubicacionOnline}</span>. Las diferencias entre el maestro y las tiendas se revisan en{' '}
            <Link to="/admin/discrepancias" className="text-ac underline">
              Discrepancias
            </Link>{' '}
            y los pedidos leídos en{' '}
            <Link to="/admin/pedidos" className="text-ac underline">
              Pedidos online
            </Link>
            .
          </p>

          {resumenImport ? (
            <div className="mb-4 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
              <div className="mb-2 flex items-center gap-2">
                <p className="text-cuerpo font-semibold text-lab">Catálogo traído de {NOMBRE_CANAL[resumenImport.canalId] ?? resumenImport.canalId}</p>
                <Insignia tono="ok">listo en {(resumenImport.duracionMs / 1000).toFixed(1)} s</Insignia>
              </div>
              <p className="num text-cuerpo text-lab2">
                {resumenImport.creados} productos nuevos · {resumenImport.actualizados} actualizados · {resumenImport.omitidos} sin cambios · {resumenImport.despublicados ?? 0} ya no están en la tienda · {resumenImport.duplicadosMarcados} posibles duplicados
              </p>
              {resumenImport.errores.length > 0 ? (
                <p className="mt-1 text-chico text-alerta">
                  {resumenImport.errores.length} producto{resumenImport.errores.length > 1 ? 's' : ''} con problemas en la tienda (sin precio o código repetido): no entran al maestro hasta corregirlos en la web. El detalle está en la bitácora al pie.
                </p>
              ) : null}
            </div>
          ) : null}
          {resultado?.completa ? <ResultadoCompleta r={resultado.completa} /> : null}
          {resultado?.corrida ? <TarjetaCorrida r={resultado.corrida} /> : null}

          <details className="mt-2 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
            <summary className="cursor-pointer text-cuerpo text-lab">
              Bitácora {estado.erroresAbiertos > 0 ? <Insignia tono="peligro">{estado.erroresAbiertos} aviso{estado.erroresAbiertos > 1 ? 's' : ''} por revisar</Insignia> : <Insignia tono="ok">sin avisos</Insignia>}
              <span className="ml-2 text-chico text-lab3">registro técnico de cada lectura y publicación</span>
            </summary>
            <div className="mb-2 mt-3 flex flex-wrap items-center justify-between gap-3">
              <Segmentado<'catalogo' | 'corridas'>
                opciones={[
                  { valor: 'catalogo', etiqueta: 'Catálogo' },
                  { valor: 'corridas', etiqueta: 'Pedidos y publicación' },
                ]}
                valor={bitacora}
                onChange={(v) => {
                  setBitacora(v ?? 'catalogo');
                  setPagina(1);
                }}
              />
              {bitacora === 'catalogo' ? (
                <Segmentado
                  opciones={[{ valor: 'si', etiqueta: 'Solo avisos por revisar' }]}
                  valor={soloErrores}
                  onChange={(v) => {
                    setSoloErrores(v);
                    setPagina(1);
                  }}
                />
              ) : null}
            </div>

            {bitacora === 'corridas' ? (
              corridas === null ? (
                <Cargando />
              ) : corridas.corridas.length === 0 ? (
                <Vacio mensaje="Todavía no se han leído pedidos ni publicado nada." />
              ) : (
                <>
                  <ul className="divide-y divide-sep rounded-campo border border-sep">
                    {corridas.corridas.map((k) => (
                      <li key={k.id} className="px-3 py-2">
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
              <Vacio mensaje={soloErrores ? 'No hay avisos por revisar. Ese es el estado esperado.' : 'La bitácora está vacía.'} />
            ) : (
              <>
                <ul className="divide-y divide-sep rounded-campo border border-sep">
                  {logs.logs.map((registro) => (
                    <li key={registro.id} className="flex items-start gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Insignia tono={registro.resultado === 'error' ? 'peligro' : registro.resultado.startsWith('ok') ? 'ok' : 'neutro'}>{registro.resultado}</Insignia>
                          <span className="text-chico text-lab2">{registro.operacion}</span>
                          {registro.canalId ? <span className="font-mono text-chico text-lab3">{NOMBRE_CANAL[registro.canalId] ?? registro.canalId}</span> : null}
                          <span className="text-chico text-lab3">
                            {fecha(registro.creadoEn)} {hora(registro.creadoEn)}
                          </span>
                          {registro.resuelto ? <Insignia>revisado</Insignia> : null}
                        </div>
                        {registro.detalle ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-chico text-lab3">Detalle</summary>
                            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-chico text-lab2">{registro.detalle}</pre>
                          </details>
                        ) : null}
                      </div>
                      {registro.resultado === 'error' && !registro.resuelto ? (
                        <div className="w-[150px] shrink-0">
                          <Boton onClick={() => void marcarResuelto(registro.id)}>Ya lo revisé</Boton>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <Paginacion pagina={pagina} porPagina={logs.porPagina} total={logs.total} onPagina={setPagina} />
              </>
            )}
          </details>
        </>
      )}

      <Dialogo abierto={confirmacion !== null} titulo={confirmacion?.titulo ?? ''} onCerrar={() => setConfirmacion(null)}>
        <p className="text-cuerpo text-lab2">{confirmacion?.texto}</p>
        <div className="mt-4 flex justify-end gap-2">
          <div className="w-[120px]">
            <Boton variante="secundario" onClick={() => setConfirmacion(null)}>
              Cancelar
            </Boton>
          </div>
          <div className="w-[220px]">
            <Boton variante="principal" cargando={confirmando} onClick={() => void confirmar()}>
              {confirmacion?.boton ?? 'Confirmar'}
            </Boton>
          </div>
        </div>
      </Dialogo>
    </div>
  );
}

function ResultadoCompleta({ r }: { r: ResumenCompleta }) {
  return (
    <div className="mb-4 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-cuerpo font-semibold text-lab">Publicación en {NOMBRE_CANAL[r.canalId] ?? r.canalId}</p>
        {r.simulacion ? <Insignia>simulación: no se escribió nada</Insignia> : <Insignia tono="alerta">real</Insignia>}
      </div>
      {(['pedidos', 'precios', 'stock'] as const).map((k) => {
        const x = r[k];
        return (
          <div key={k} className="border-t border-sep py-2">
            <p className="text-cuerpo text-lab">
              {ETIQUETA_CORRIDA[k]}
              {esResumen(x) ? null : <span className="text-chico text-lab3"> · no corrió: {x.omitida}</span>}
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
        {r.simulacion ? <Insignia>simulación: no se escribió nada</Insignia> : <Insignia tono="ok">hecho</Insignia>}
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
    return ` · maestro ${v.maestro} / tienda ${v.canal ?? '—'} / publicado ${v.publicado ?? '—'}`;
  };
  return (
    <>
      <p className="num text-chico text-lab2">
        {c.leidos} leídos · {c.aEscribir} a escribir · {c.escritos} escritos · {c.omitidos} sin cambios · {c.detenidos} detenidos · {c.fallidos} fallidos
        {r.noElegibles !== undefined ? ` · ${r.noElegibles} sin control de stock (no entran)` : ''}
      </p>
      {r.omitida ? <p className="text-chico text-alerta">No corrió: {r.omitida}</p> : null}
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
