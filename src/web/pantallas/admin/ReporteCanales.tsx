// V28 — Canales de venta (R-036, docs/14 §5 y §6). Consolida mostrador y tiendas web en una sola
// matriz, con aporte por canal, evolución, matriz canal × categoría y calidad de los datos.
// Regla de la pantalla: nunca convertir un desconocido en cero. Si el aporte no se puede calcular
// se dice «No calculable»; si un canal no tiene datos se dice «Sin datos suficientes»; el margen
// solo se muestra con su cobertura y, si se estimó a costo de hoy, se declara.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, descargar, ErrorApi } from '../../api.js';
import { categorias } from '../../catalogo.js';
import { Banner, Boton, Insignia, Segmentado, Vacio } from '../../components/base.js';
import { MenuAcciones } from '../../components/MenuAcciones.js';
import { CeldaDoble, Tabla, type Columna } from '../../components/Tabla.js';
import { useAvisos } from '../../components/Toast.js';
import { ETIQUETA_TIPO, type TipoProducto } from '../../tipos.js';
import { pct, type Agrupar, type CalidadDatos, type FilaCanal, type ReporteCanales as Reporte } from '../../tiposReportes.js';
import { clp, fecha, hora } from '../../utils/formato.js';
import { aplanarCategorias, Encabezado, Filtro, Filtros, SeccionPlegable, Selecto, TarjetaCifra, type OpcionCategoria } from './util.js';

/** Colores de las barras por posición del canal: la paleta sale de los tokens, no de literales. */
const COLOR_CANAL = ['bg-ac-relleno', 'bg-ok', 'bg-alerta', 'bg-rosa', 'bg-lab3'];

const OPCIONES_TIPO = (Object.keys(ETIQUETA_TIPO) as TipoProducto[]).map((t) => ({ valor: t, etiqueta: ETIQUETA_TIPO[t] }));

function iso(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

function primerDiaDelMes(): string {
  return `${iso(new Date()).slice(0, 7)}-01`;
}

const MENSAJE_RANGO: Record<string, string> = {
  RANGO_INVALIDO: 'Revisa las fechas: alguna no existe.',
  RANGO_INVERTIDO: 'La fecha «desde» es posterior a «hasta».',
  RANGO_DEMASIADO_GRANDE: 'El rango no puede superar 400 días.',
};

/** Fila de la matriz canal × categoría, ya pivoteada. */
interface FilaPivot {
  categoria: string;
  clave: string;
  porCanal: Record<string, { importe: number; unidades: number }>;
  total: number;
}

export function ReporteCanales() {
  const { avisar } = useAvisos();
  const [desde, setDesde] = useState(primerDiaDelMes());
  const [hasta, setHasta] = useState(iso(new Date()));
  const [agrupar, setAgrupar] = useState<Agrupar>('dia');
  const [canalId, setCanalId] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [juego, setJuego] = useState('');
  const [tipo, setTipo] = useState('');
  const [comparar, setComparar] = useState(false);
  const [costoActual, setCostoActual] = useState(false); // apagado por defecto: §6.2
  const [opcionesCategoria, setOpcionesCategoria] = useState<OpcionCategoria[]>([]);
  const [juegos, setJuegos] = useState<{ juego: string; productos: number }[]>([]);
  const [datos, setDatos] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorRango, setErrorRango] = useState<string | null>(null);
  const [calidadAbierta, setCalidadAbierta] = useState(false);
  const [calidad, setCalidad] = useState<CalidadDatos | null>(null);

  const consulta = useMemo(() => {
    const p = new URLSearchParams({ desde, hasta, agrupar });
    if (canalId) p.set('canales', canalId);
    if (categoriaId) p.set('categorias', categoriaId);
    if (juego) p.set('juego', juego);
    if (tipo) p.set('tipo', tipo);
    if (comparar) p.set('comparar', 'true');
    if (costoActual) p.set('costoActual', 'true');
    return p.toString();
  }, [desde, hasta, agrupar, canalId, categoriaId, juego, tipo, comparar, costoActual]);

  useEffect(() => {
    void categorias().then((arbol) => setOpcionesCategoria(aplanarCategorias(arbol))).catch(() => {});
    void api<{ juegos: { juego: string; productos: number }[] }>('/productos/juegos')
      .then((r) => setJuegos(r.juegos))
      .catch(() => {});
  }, []);

  const cargar = useCallback(() => {
    setCargando(true);
    setErrorRango(null);
    api<Reporte>(`/reportes/canales?${consulta}`)
      .then((r) => setDatos(r))
      .catch((e) => {
        if (e instanceof ErrorApi && MENSAJE_RANGO[e.codigo]) {
          setErrorRango(MENSAJE_RANGO[e.codigo] ?? null);
        } else {
          avisar({ tono: 'error', titulo: 'No se pudo cargar el reporte.', detalle: 'Revisa la conexión y vuelve a intentar.' });
        }
      })
      .finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta]);
  useEffect(cargar, [cargar]);

  // La calidad de datos se pide solo cuando se abre la sección (una consulta menos por carga).
  useEffect(() => {
    if (!calidadAbierta || errorRango) return;
    api<CalidadDatos>(`/reportes/calidad-datos?${consulta}`)
      .then(setCalidad)
      .catch(() => setCalidad(null));
  }, [calidadAbierta, consulta, errorRango]);

  const exportar = (ruta: string, nombre: string) =>
    void descargar(`${ruta}?${consulta}`, nombre)
      .then(() => avisar({ tono: 'ok', titulo: 'CSV descargado.' }))
      .catch(() => avisar({ tono: 'error', titulo: 'No se pudo exportar el CSV.', detalle: 'Revisa la conexión y vuelve a intentar.' }));

  const nombreCanal = useCallback(
    (id: string) => (id === 'total' ? 'Total' : (datos?.canales.find((c) => c.id === id)?.nombre ?? id)),
    [datos],
  );
  const coberturaDe = useCallback((id: string) => datos?.cobertura.find((c) => c.canalId === id), [datos]);

  // Canales visibles + total como última fila (la calcula el servidor sobre TODO el resultado).
  const filasCanal: FilaCanal[] = datos ? [...datos.consolidado.filas, datos.consolidado.total] : [];
  const anteriorDe = (id: string) =>
    datos?.anterior ? (id === 'total' ? datos.anterior.consolidado.total : datos.anterior.consolidado.filas.find((f) => f.canalId === id)) : undefined;

  const columnas: Columna<FilaCanal>[] = [
    {
      clave: 'canal',
      titulo: 'Canal',
      ancho: 'minmax(0,1.4fr)',
      render: (f) => {
        const cob = coberturaDe(f.canalId);
        const esTotal = f.canalId === 'total';
        return (
          <CeldaDoble
            principal={<span className={esTotal ? 'font-semibold' : ''}>{nombreCanal(f.canalId)}</span>}
            secundaria={
              esTotal
                ? 'todos los canales del filtro'
                : cob?.sinDatos
                  ? 'Sin datos suficientes'
                  : `${cob?.primeraFecha ? `desde ${fecha(`${cob.primeraFecha}T12:00:00`)}` : 'sin fecha de inicio'}${cob?.erroresAbiertos ? ` · ${cob.erroresAbiertos} error(es) de sync` : ''}`
            }
            mono={false}
          />
        );
      },
    },
    {
      clave: 'operaciones',
      titulo: 'Operaciones',
      ancho: '110px',
      alinear: 'derecha',
      prioridad: 2,
      enTarjeta: 'cifra',
      render: (f) => (
        <span className="num text-lab">
          {f.operaciones}
          {f.operacionesAnuladas || f.operacionesReembolsadasTotal ? (
            <span className="block text-chico text-lab3">
              {f.operacionesAnuladas ? `${f.operacionesAnuladas} anul.` : ''}
              {f.operacionesAnuladas && f.operacionesReembolsadasTotal ? ' · ' : ''}
              {f.operacionesReembolsadasTotal ? `${f.operacionesReembolsadasTotal} reemb. total` : ''}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      clave: 'unidades',
      titulo: 'Unidades netas',
      ancho: '110px',
      alinear: 'derecha',
      prioridad: 3,
      enTarjeta: 'cifra',
      render: (f) => <span className="num text-lab2">{f.unidadesNetas}</span>,
    },
    {
      clave: 'bruto',
      titulo: 'Antes de reembolsos',
      ancho: '140px',
      alinear: 'derecha',
      prioridad: 3,
      enTarjeta: 'cifra',
      render: (f) => <span className="num text-lab2">{clp(f.importeBruto)}</span>,
    },
    {
      clave: 'reembolsos',
      titulo: 'Reembolsos',
      ancho: '120px',
      alinear: 'derecha',
      prioridad: 2,
      enTarjeta: 'cifra',
      render: (f) => <span className={`num ${f.reembolsos > 0 ? 'text-alerta' : 'text-lab3'}`}>{f.reembolsos > 0 ? `−${clp(f.reembolsos)}` : '—'}</span>,
    },
    {
      clave: 'ajustado',
      titulo: 'Importe ajustado',
      ancho: '140px',
      alinear: 'derecha',
      enTarjeta: 'cifra',
      render: (f) => {
        const ant = anteriorDe(f.canalId);
        const variacion = ant && ant.importeAjustado > 0 ? ((f.importeAjustado - ant.importeAjustado) / ant.importeAjustado) * 100 : null;
        return (
          <span className="num">
            <span className={`text-[16px] font-semibold ${f.canalId === 'total' ? 'text-lab' : 'text-lab'}`}>{clp(f.importeAjustado)}</span>
            {datos?.anterior ? (
              <span className="block text-chico text-lab3">
                antes {clp(ant?.importeAjustado ?? 0)}
                {variacion !== null ? ` · ${variacion >= 0 ? '+' : ''}${variacion.toLocaleString('es-CL', { maximumFractionDigits: 1 })} %` : ' · sin base'}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      clave: 'aporte',
      titulo: 'Aporte',
      ancho: '110px',
      alinear: 'derecha',
      enTarjeta: 'cifra',
      render: (f) => <span className={`num ${f.aportePorcentaje === null ? 'text-lab3' : 'text-lab'}`}>{pct(f.aportePorcentaje)}</span>,
    },
    {
      clave: 'ticket',
      titulo: 'Ticket promedio',
      ancho: '120px',
      alinear: 'derecha',
      prioridad: 2,
      enTarjeta: 'cifra',
      render: (f) => <span className="num text-lab2">{f.ticketPromedio === null ? '—' : clp(f.ticketPromedio)}</span>,
    },
  ];

  // Evolución: una barra por período, con segmentos por canal. Sin librería de gráficos.
  const periodos = useMemo(() => {
    if (!datos) return [] as { periodo: string; total: number; partes: { canalId: string; importe: number }[] }[];
    const mapa = new Map<string, { periodo: string; total: number; partes: { canalId: string; importe: number }[] }>();
    for (const p of datos.evolucion) {
      const fila = mapa.get(p.periodo) ?? { periodo: p.periodo, total: 0, partes: [] };
      fila.total += p.importeAjustado;
      fila.partes.push({ canalId: p.canalId, importe: p.importeAjustado });
      mapa.set(p.periodo, fila);
    }
    return [...mapa.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
  }, [datos]);
  const maximoPeriodo = periodos.reduce((m, p) => Math.max(m, p.total), 0);
  const indiceCanal = (id: string) => Math.max(0, datos?.canales.findIndex((c) => c.id === id) ?? 0);

  // Matriz canal × categoría (las filas vienen por canal; aquí se pivotean por categoría).
  const pivot: FilaPivot[] = useMemo(() => {
    if (!datos) return [];
    const mapa = new Map<string, FilaPivot>();
    for (const c of datos.categorias) {
      const clave = c.categoriaId ?? 'sin';
      const fila = mapa.get(clave) ?? { categoria: c.categoria, clave, porCanal: {}, total: 0 };
      fila.porCanal[c.canalId] = { importe: c.importe, unidades: c.unidadesNetas };
      fila.total += c.importe;
      mapa.set(clave, fila);
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total);
  }, [datos]);
  const totalPivot = pivot.reduce((a, f) => a + f.total, 0);

  const canalesVisibles = datos?.canales.filter((c) => !canalId || c.id === canalId) ?? [];
  const columnasPivot: Columna<FilaPivot>[] = [
    {
      clave: 'categoria',
      titulo: 'Categoría',
      ancho: 'minmax(0,1.4fr)',
      render: (f) => <CeldaDoble principal={f.categoria} secundaria={f.clave === 'sin' ? 'productos sin categoría o líneas sin mapear' : undefined} mono={false} />,
    },
    ...canalesVisibles.map<Columna<FilaPivot>>((c) => ({
      clave: c.id,
      titulo: c.nombre,
      ancho: '130px',
      alinear: 'derecha',
      prioridad: 2,
      enTarjeta: 'cifra',
      render: (f) => {
        const celda = f.porCanal[c.id];
        return celda ? (
          <span className="num text-lab">
            {clp(celda.importe)}
            <span className="block text-chico text-lab3">{celda.unidades} u</span>
          </span>
        ) : (
          <span className="text-lab3">—</span>
        );
      },
    })),
    {
      clave: 'total',
      titulo: 'Total',
      ancho: '130px',
      alinear: 'derecha',
      enTarjeta: 'cifra',
      render: (f) => (
        <span className="num font-semibold text-lab">
          {clp(f.total)}
          <span className="block text-chico font-normal text-lab3">{totalPivot > 0 ? pct((f.total / totalPivot) * 100) : '—'}</span>
        </span>
      ),
    },
  ];

  const margen = datos?.margen;

  return (
    <div className="p-4 sm:px-8 sm:py-6">
      <Encabezado
        titulo="Canales de venta"
        subtitulo={
          datos
            ? `${datos.criterio}. Consultado el ${fecha(datos.consultadoEn)} a las ${hora(datos.consultadoEn)}.`
            : 'Tienda física y tiendas web en una sola matriz'
        }
        acciones={
          <>
            <Boton ajustado onClick={() => exportar('/reportes/canales.csv', `canales_${desde}_${hasta}.csv`)} deshabilitado={!datos}>
              Exportar CSV
            </Boton>
            <MenuAcciones
              variante="cabecera"
              items={[
                { etiqueta: 'CSV por categoría', onClick: () => exportar('/reportes/canales/categorias.csv', `canales-categorias_${desde}_${hasta}.csv`) },
                { etiqueta: 'Ver calidad de los datos', onClick: () => setCalidadAbierta(true) },
              ]}
            />
          </>
        }
      />

      <Filtros>
        <Filtro ancho="0 1 170px" minimo={150}>
          <div>
            <label className="mb-1 block text-chico text-lab2" htmlFor="desde-canales">
              Desde
            </label>
            <input
              id="desde-canales"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="num h-tactil w-full rounded-campo border border-sep bg-bg px-3 text-cuerpo text-lab outline-none"
            />
          </div>
        </Filtro>
        <Filtro ancho="0 1 170px" minimo={150}>
          <div>
            <label className="mb-1 block text-chico text-lab2" htmlFor="hasta-canales">
              Hasta
            </label>
            <input
              id="hasta-canales"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="num h-tactil w-full rounded-campo border border-sep bg-bg px-3 text-cuerpo text-lab outline-none"
            />
          </div>
        </Filtro>
        <Filtro ancho="0 1 190px">
          <Selecto etiqueta="Canal" valor={canalId} onValor={setCanalId} opciones={(datos?.canales ?? []).map((c) => ({ valor: c.id, etiqueta: c.nombre }))} vacia="Todos" />
        </Filtro>
        <Filtro ancho="0 1 200px">
          <Selecto etiqueta="Categoría" valor={categoriaId} onValor={setCategoriaId} opciones={opcionesCategoria.map((c) => ({ valor: c.id, etiqueta: c.etiqueta }))} vacia="Todas" />
        </Filtro>
        <Filtro ancho="0 1 170px">
          <Selecto etiqueta="Juego" valor={juego} onValor={setJuego} opciones={juegos.map((j) => ({ valor: j.juego, etiqueta: `${j.juego} · ${j.productos}` }))} vacia="Todos" />
        </Filtro>
        <Filtro ancho="0 1 170px">
          <Selecto etiqueta="Tipo" valor={tipo} onValor={setTipo} opciones={OPCIONES_TIPO} vacia="Todos" />
        </Filtro>
        <Segmentado<Agrupar>
          fijo
          valor={agrupar}
          onChange={(v) => setAgrupar(v ?? 'dia')}
          opciones={[
            { valor: 'dia', etiqueta: 'Por día' },
            { valor: 'semana', etiqueta: 'Por semana' },
            { valor: 'mes', etiqueta: 'Por mes' },
          ]}
        />
      </Filtros>

      <div className="mb-4 flex flex-wrap items-center gap-4 text-cuerpo text-lab2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} className="h-4 w-4" />
          Comparar con el período anterior
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={costoActual} onChange={(e) => setCostoActual(e.target.checked)} className="h-4 w-4" />
          Estimar el margen a costo de hoy
        </label>
        <Link to="/admin/reportes" className="text-chico text-lab3 underline underline-offset-2">
          Ver el reporte por usuario
        </Link>
      </div>

      {errorRango ? (
        <div className="mb-4">
          <Banner tono="peligro">{errorRango}</Banner>
        </div>
      ) : null}

      {datos?.filtrado ? (
        <div className="mb-4">
          <Banner tono="alerta">
            Con filtros de producto, la participación se calcula sobre la mercadería identificada. El envío, los cargos y los ajustes no atribuibles a una línea
            ({clp(datos.noAtribuible)}) quedan fuera de estos totales.
          </Banner>
        </div>
      ) : null}

      {datos ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TarjetaCifra
            rotulo="Importe ajustado"
            valor={clp(datos.consolidado.total.importeAjustado)}
            detalle={`antes de reembolsos ${clp(datos.consolidado.total.importeBruto)}`}
            grande
          />
          <TarjetaCifra
            rotulo="Operaciones"
            valor={String(datos.consolidado.total.operaciones)}
            detalle={`${datos.consolidado.total.unidadesNetas} unidades netas${datos.consolidado.total.operacionesEnRevision ? ` · ${datos.consolidado.total.operacionesEnRevision} en revisión` : ''}`}
            grande
          />
          <TarjetaCifra
            rotulo="Ticket promedio"
            valor={datos.consolidado.total.ticketPromedio === null ? '—' : clp(datos.consolidado.total.ticketPromedio)}
            detalle="importe ajustado ÷ operaciones"
            grande
          />
          <TarjetaCifra
            rotulo="Margen estimado"
            valor={margen && margen.margenPorcentaje !== null ? `${clp(margen.margen)} · ${pct(margen.margenPorcentaje)}` : 'No disponible'}
            detalle={
              margen && margen.margenPorcentaje !== null
                ? `sobre ${pct(margen.coberturaImporte, '—')} del importe${margen.estimadoACostoActual ? ' · a costo de hoy' : ' · costo del momento de la venta'}`
                : 'ninguna línea del período tiene costo conocido'
            }
            grande
          />
        </div>
      ) : null}

      {margen ? (
        <p className="mb-4 text-chico text-lab3">
          Margen estimado sobre importes con impuestos, antes de comisiones y gastos. Cubre {margen.lineasConCosto} de {margen.lineasTotales} líneas
          ({pct(margen.coberturaLineas, '—')}) y {pct(margen.coberturaImporte, '—')} del importe comercial.
          {margen.estimadoACostoActual ? ' Está estimado a costo de hoy, no al costo del momento de la venta.' : ''}
          {margen.costoPerdidoSinReposicion > 0 ? ` Incluye ${clp(margen.costoPerdidoSinReposicion)} de costo de artículos devueltos que no volvieron al stock.` : ''}
        </p>
      ) : null}

      <div className="mb-4">
        <Tabla
          columnas={columnas}
          filas={filasCanal}
          clave={(f) => f.canalId}
          cargando={cargando}
          resumen={
            datos ? (
              <>
                <strong className="num font-semibold text-lab">{datos.consolidado.filas.length}</strong> canal
                {datos.consolidado.filas.length === 1 ? '' : 'es'} · {fecha(`${datos.desde}T12:00:00`)} a {fecha(`${datos.hasta}T12:00:00`)}
              </>
            ) : (
              'Cargando…'
            )
          }
          resumenDerecha="Una devolución posterior puede cambiar un período ya cerrado."
          vacio={<Vacio mensaje="No hay operaciones en este rango." />}
        />
      </div>

      {periodos.length > 0 ? (
        <div className="mb-4 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold text-lab">Evolución</span>
            <div className="flex flex-wrap items-center gap-3 text-chico text-lab3">
              {(datos?.canales ?? []).map((c, i) => (
                <span key={c.id} className="flex items-center gap-[6px]">
                  <span className={`inline-block h-2 w-4 rounded ${COLOR_CANAL[i % COLOR_CANAL.length]}`} aria-hidden="true" />
                  {c.nombre}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {periodos.map((p) => (
              <div key={p.periodo} className="flex items-center gap-3">
                <span className="num w-[110px] shrink-0 text-chico text-lab3">{p.periodo}</span>
                <span className="flex h-4 min-w-0 flex-1 overflow-hidden rounded bg-bg3">
                  {p.partes.map((parte) => (
                    <span
                      key={parte.canalId}
                      title={`${nombreCanal(parte.canalId)}: ${clp(parte.importe)}`}
                      className={COLOR_CANAL[indiceCanal(parte.canalId) % COLOR_CANAL.length]}
                      style={{ width: maximoPeriodo > 0 ? `${(parte.importe / maximoPeriodo) * 100}%` : '0%' }}
                    />
                  ))}
                </span>
                <span className="num w-[110px] shrink-0 text-right text-chico text-lab2">{clp(p.total)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-4">
        <Tabla
          columnas={columnasPivot}
          filas={pivot}
          clave={(f) => f.clave}
          cargando={cargando}
          resumen={
            <>
              Aporte por categoría · <strong className="num font-semibold text-lab">{clp(totalPivot)}</strong> en mercadería identificada
            </>
          }
          resumenDerecha={datos && datos.noAtribuible !== 0 ? `${clp(datos.noAtribuible)} sin atribuir a una línea (envío y cargos)` : undefined}
          vacio={<Vacio mensaje="Ninguna línea de venta coincide con estos filtros." />}
        />
      </div>

      <SeccionPlegable
        titulo="Calidad de los datos"
        resumen={datos ? `${datos.cobertura.filter((c) => c.sinDatos).length} canal(es) sin datos · margen sobre ${pct(datos.margen.coberturaImporte, '—')} del importe` : undefined}
        abierta={calidadAbierta}
        onToggle={() => setCalidadAbierta((v) => !v)}
      >
        <div className="flex flex-col gap-3">
          <p className="text-chico text-lab2">
            Este reporte agrupa por la fecha de origen de cada operación y descuenta las devoluciones conocidas hoy. Una primera fecha disponible no prueba por sí
            sola que el historial esté completo.
          </p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {(datos?.cobertura ?? []).map((c) => (
              <div key={c.canalId} className="rounded-tarjeta border border-sep px-4 py-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold text-lab">{c.nombre}</span>
                  {c.sinDatos ? <Insignia tono="alerta">Sin datos suficientes</Insignia> : c.erroresAbiertos > 0 ? <Insignia tono="peligro">{c.erroresAbiertos} errores</Insignia> : <Insignia tono="ok">Con datos</Insignia>}
                </div>
                <p className="text-chico text-lab3">
                  {c.sinDatos || !c.primeraFecha || !c.ultimaFecha
                    ? 'Este canal no tiene operaciones cargadas: no se puede afirmar que vendió $0.'
                    : `Datos desde ${fecha(`${c.primeraFecha}T12:00:00`)} hasta ${fecha(`${c.ultimaFecha}T12:00:00`)} · ${c.operacionesEnPeriodo} operación(es) en el rango`}
                </p>
                {c.ultimaIngestaEn ? (
                  <p className="text-chico text-lab3">Última sincronización: {fecha(c.ultimaIngestaEn)} {hora(c.ultimaIngestaEn)}</p>
                ) : null}
              </div>
            ))}
          </div>
          {calidad ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <TarjetaCifra rotulo="Margen: líneas con costo" valor={`${calidad.margen.lineasConCosto} / ${calidad.margen.lineasTotales}`} detalle={pct(calidad.margen.coberturaLineas, 'sin líneas')} />
                <TarjetaCifra rotulo="Inventario valorizado" valor={pct(calidad.inventario.coberturaUnidades, 'sin unidades')} detalle={`${calidad.inventario.skusSinCosto} SKU sin costo`} />
                <TarjetaCifra rotulo="Unidades negativas" valor={String(calidad.inventario.unidadesNegativas)} detalle="inconsistencias por resolver" />
                <TarjetaCifra rotulo="Operaciones en revisión" valor={String(calidad.operacionesEnRevision)} detalle={calidad.operacionesOtraMoneda > 0 ? `${calidad.operacionesOtraMoneda} en otra moneda, fuera del total CLP` : 'canceladas sin reembolso registrado'} />
              </div>
              <div>
                <p className="mb-1 text-chico font-semibold text-lab2">Falta cargar para completar la cobertura:</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-chico text-lab3">
                  {calidad.pendientes.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <p className="text-chico text-lab3">Cargando el detalle de calidad…</p>
          )}
        </div>
      </SeccionPlegable>
    </div>
  );
}
