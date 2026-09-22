// V29 — Valor del inventario (R-036, docs/14 §7). Corte al momento de la consulta, con las
// cantidades de `StockActual` (nunca se suma el espejo de las webs: una unidad publicada en las
// dos tiendas sigue siendo una unidad).
// Reglas de la pantalla: el valor a precio de venta es potencial comercial, no dinero disponible;
// un costo desconocido no vale cero; los saldos negativos se muestran aparte como inconsistencias.
import { useCallback, useEffect, useState } from 'react';
import { api, descargar } from '../../api.js';
import { categorias } from '../../catalogo.js';
import { Banner, Boton, Insignia, Segmentado, Vacio } from '../../components/base.js';
import { CeldaDoble, Tabla, type Columna } from '../../components/Tabla.js';
import { useAvisos } from '../../components/Toast.js';
import { ETIQUETA_CALIDAD, pct, type FilaInventario, type MarcaInventario, type ReporteInventario } from '../../tiposReportes.js';
import { clp, fecha, hora } from '../../utils/formato.js';
import { aplanarCategorias, CampoBuscar, Encabezado, Filtro, Filtros, Selecto, TarjetaCifra, type OpcionCategoria } from './util.js';

type FiltroMarca = MarcaInventario | 'todo';

export function InventarioValorizado() {
  const { avisar } = useAvisos();
  const [q, setQ] = useState('');
  const [ubicacionId, setUbicacionId] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [juego, setJuego] = useState('');
  const [marca, setMarca] = useState<FiltroMarca>('todo');
  const [opcionesCategoria, setOpcionesCategoria] = useState<OpcionCategoria[]>([]);
  const [juegos, setJuegos] = useState<{ juego: string; productos: number }[]>([]);
  const [datos, setDatos] = useState<ReporteInventario | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    void categorias().then((arbol) => setOpcionesCategoria(aplanarCategorias(arbol))).catch(() => {});
    void api<{ juegos: { juego: string; productos: number }[] }>('/productos/juegos')
      .then((r) => setJuegos(r.juegos))
      .catch(() => {});
  }, []);

  const consulta = useCallback(() => {
    const p = new URLSearchParams();
    if (q.trim().length >= 2) p.set('q', q.trim());
    if (ubicacionId) p.set('ubicacionId', ubicacionId);
    if (categoriaId) p.set('categoriaId', categoriaId);
    if (juego) p.set('juego', juego);
    if (marca !== 'todo') p.set('marca', marca);
    return p.toString();
  }, [q, ubicacionId, categoriaId, juego, marca]);

  const cargar = useCallback(() => {
    setCargando(true);
    const id = setTimeout(() => {
      api<ReporteInventario>(`/reportes/inventario-valorizado?${consulta()}`)
        .then(setDatos)
        .catch(() =>
          avisar({ tono: 'error', titulo: 'No se pudo cargar el inventario.', detalle: 'Revisa la conexión y vuelve a intentar.' }),
        )
        .finally(() => setCargando(false));
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta]);
  useEffect(cargar, [cargar]);

  const exportar = () =>
    void descargar(`/reportes/inventario-valorizado.csv?${consulta()}`, `inventario-valorizado_${new Date().toISOString().slice(0, 10)}.csv`)
      .then(() => avisar({ tono: 'ok', titulo: 'CSV descargado.' }))
      .catch(() => avisar({ tono: 'error', titulo: 'No se pudo exportar el CSV.', detalle: 'Revisa la conexión y vuelve a intentar.' }));

  const resumen = datos?.resumen;

  const columnas: Columna<FilaInventario>[] = [
    {
      clave: 'producto',
      titulo: 'Producto',
      ancho: 'minmax(0,1.6fr)',
      render: (f) => (
        <CeldaDoble
          principal={<span className={f.activo ? '' : 'text-lab3'}>{f.nombre}</span>}
          secundaria={`${f.sku} · ${f.categoria ?? 'sin categoría'}${f.juego ? ` · ${f.juego}` : ''}${f.activo ? '' : ' · inactivo'}`}
        />
      ),
    },
    {
      clave: 'ubicacion',
      titulo: 'Ubicación',
      ancho: '130px',
      prioridad: 2,
      enTarjeta: 'cifra',
      render: (f) => <span className="text-lab2">{f.ubicacion}</span>,
    },
    {
      clave: 'cantidad',
      titulo: 'Cantidad',
      ancho: '90px',
      alinear: 'derecha',
      enTarjeta: 'cifra',
      render: (f) => <span className={`num text-[16px] font-semibold ${f.cantidad < 0 ? 'text-peligro' : 'text-lab'}`}>{f.cantidad}</span>,
    },
    {
      clave: 'costo',
      titulo: 'Costo unitario',
      ancho: '120px',
      alinear: 'derecha',
      prioridad: 3,
      enTarjeta: 'cifra',
      render: (f) => (f.costoReferencia === null ? <span className="text-chico text-lab3">sin costo</span> : <span className="num text-lab2">{clp(f.costoReferencia)}</span>),
    },
    {
      clave: 'valorCosto',
      titulo: 'Valor a costo',
      ancho: '130px',
      alinear: 'derecha',
      enTarjeta: 'cifra',
      render: (f) => (f.valorCosto === null ? <span className="text-chico text-lab3">sin valorizar</span> : <span className={`num font-semibold ${f.valorCosto < 0 ? 'text-peligro' : 'text-lab'}`}>{clp(f.valorCosto)}</span>),
    },
    {
      clave: 'valorPrecio',
      titulo: 'Valor a precio',
      ancho: '130px',
      alinear: 'derecha',
      prioridad: 2,
      enTarjeta: 'cifra',
      render: (f) => (f.valorPrecio === null ? <span className="text-chico text-lab3">sin precio</span> : <span className="num text-lab2">{clp(f.valorPrecio)}</span>),
    },
    {
      clave: 'calidad',
      titulo: 'Dato',
      ancho: '150px',
      prioridad: 3,
      enTarjeta: 'cifra',
      render: (f) => <Insignia tono={ETIQUETA_CALIDAD[f.calidad].tono}>{ETIQUETA_CALIDAD[f.calidad].texto}</Insignia>,
    },
  ];

  return (
    <div className="p-4 sm:px-8 sm:py-6">
      <Encabezado
        titulo="Valor del inventario"
        subtitulo={
          datos ? `${datos.medida} · corte del ${fecha(datos.cortadoEn)} a las ${hora(datos.cortadoEn)}` : 'Inventario a costo de referencia — estimado'
        }
        acciones={
          <Boton ajustado onClick={exportar} deshabilitado={!datos || datos.filas.length === 0}>
            Exportar CSV
          </Boton>
        }
      />

      <Filtros>
        <Filtro ancho="1 1 220px" minimo={200}>
          <CampoBuscar id="buscar-inventario" valor={q} onValor={setQ} placeholder="Nombre o código" />
        </Filtro>
        <Filtro ancho="0 1 180px">
          <Selecto
            etiqueta="Ubicación"
            valor={ubicacionId}
            onValor={setUbicacionId}
            opciones={(datos?.ubicaciones ?? []).map((u) => ({ valor: u.id, etiqueta: u.activa ? u.nombre : `${u.nombre} (inactiva)` }))}
            vacia="Todas"
          />
        </Filtro>
        <Filtro ancho="0 1 200px">
          <Selecto etiqueta="Categoría" valor={categoriaId} onValor={setCategoriaId} opciones={opcionesCategoria.map((c) => ({ valor: c.id, etiqueta: c.etiqueta }))} vacia="Todas" />
        </Filtro>
        <Filtro ancho="0 1 170px">
          <Selecto etiqueta="Juego" valor={juego} onValor={setJuego} opciones={juegos.map((j) => ({ valor: j.juego, etiqueta: `${j.juego} · ${j.productos}` }))} vacia="Todos" />
        </Filtro>
        <Segmentado<FiltroMarca>
          fijo
          valor={marca}
          onChange={(v) => setMarca(v ?? 'todo')}
          opciones={[
            { valor: 'todo', etiqueta: 'Todo' },
            { valor: 'sin_costo', etiqueta: 'Sin costo' },
            { valor: 'negativos', etiqueta: 'Negativos' },
            { valor: 'bajo_stock', etiqueta: 'Bajo mínimo' },
            { valor: 'inactivos', etiqueta: 'Inactivos' },
            { valor: 'sin_control', etiqueta: 'Sin control' },
          ]}
        />
      </Filtros>

      {resumen ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TarjetaCifra
            rotulo="Valor a costo"
            valor={clp(resumen.valorCostoPositivo)}
            detalle={`existencias positivas con costo conocido · ${pct(resumen.coberturaUnidades, 'sin unidades')} de las unidades`}
            grande
          />
          <TarjetaCifra
            rotulo="Valor a precio de venta"
            valor={clp(resumen.valorPrecioPositivo)}
            detalle="potencial comercial, no dinero disponible"
            grande
          />
          <TarjetaCifra
            rotulo="Unidades y SKU"
            valor={`${resumen.unidadesPositivas} u · ${resumen.skusConExistencia} SKU`}
            detalle={resumen.unidadesSinCosto > 0 ? `${resumen.unidadesSinCosto} u sin costo (${resumen.skusSinCosto} SKU)` : 'todas las unidades tienen costo'}
            grande
          />
          <TarjetaCifra
            rotulo="Saldos negativos"
            valor={resumen.unidadesNegativas === 0 ? 'Ninguno' : `${resumen.unidadesNegativas} u · ${clp(resumen.valorCostoNegativo)}`}
            detalle={resumen.unidadesNegativas === 0 ? 'el libro no tiene saldos negativos' : 'inconsistencias por resolver, no activo'}
            grande
          />
        </div>
      ) : null}

      {resumen ? (
        <p className="mb-4 text-chico text-lab3">
          Diferencia potencial entre costo y precio de las unidades con ambos datos: {clp(resumen.diferenciaPotencial)}. Cobertura de valorización:{' '}
          {pct(resumen.coberturaUnidades, '—')} de las unidades y {pct(resumen.coberturaSkus, '—')} de los SKU. Saldo algebraico del libro:{' '}
          {resumen.saldoAlgebraico} u.
        </p>
      ) : null}

      {resumen && resumen.unidadesNegativas < 0 ? (
        <div className="mb-4">
          <Banner tono="peligro">
            Hay {Math.abs(resumen.unidadesNegativas)} unidad(es) con saldo negativo por {clp(resumen.valorCostoNegativo)}. Un saldo negativo es una inconsistencia
            por resolver (normalmente un pedido web pagado sin stock), no un activo físico negativo.
          </Banner>
        </div>
      ) : null}

      {datos && datos.sinControl.productos > 0 ? (
        <div className="mb-4">
          <Banner tono="alerta">
            {datos.sinControl.productos} producto(s) activos no controlan stock: su cantidad y su valor son desconocidos y no están en estas cifras. No se asume
            que valgan cero.
          </Banner>
        </div>
      ) : null}

      <Tabla
        columnas={columnas}
        filas={datos?.filas ?? []}
        clave={(f) => `${f.productoId}|${f.ubicacionId}`}
        cargando={cargando}
        atenuada={(f) => !f.activo}
        resumen={
          datos ? (
            <>
              <strong className="num font-semibold text-lab">{datos.filas.length}</strong> fila
              {datos.filas.length === 1 ? '' : 's'} de existencias{marca !== 'todo' ? ' · con el filtro aplicado' : ''}
            </>
          ) : (
            'Cargando…'
          )
        }
        resumenDerecha="Las cantidades salen del libro de stock; el espejo de las webs no suma."
        vacio={<Vacio mensaje="Ninguna existencia coincide con estos filtros." />}
      />
    </div>
  );
}
