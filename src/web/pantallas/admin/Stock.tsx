// V19 — Stock (03-SDD §8; rediseño 1b, R-029): anatomía única del backoffice. Encabezado con
// subtítulo, 1 acción principal (Nuevo recuento), 1 secundaria (Alertas) y menú «⋯» (CSV, recuentos);
// filtros fluidos; pestañas de estado con conteos; tabla con resumen, filas de 56 px y menú «⋯» de
// 44 px por fila (Ajustar / Merma / Ingresar / Trasladar / Ver kardex); paginación dentro de la
// tarjeta; el resultado de cada acción llega como toast al pie.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, descargar } from '../../api.js';
import { categorias } from '../../catalogo.js';
import { Boton, Insignia, Segmentado, Vacio } from '../../components/base.js';
import { DialogoMovimientoStock, type MotivoManual } from '../../components/DialogoMovimientoStock.js';
import { MenuAcciones } from '../../components/MenuAcciones.js';
import { CeldaDoble, Tabla, type Columna } from '../../components/Tabla.js';
import { useAvisos } from '../../components/Toast.js';
import { ETIQUETA_TIPO, type EstadoStock, type TipoProducto } from '../../tipos.js';
import { clp } from '../../utils/formato.js';
import { aplanarCategorias, CampoBuscar, Encabezado, Filtro, Filtros, Paginacion, Selecto, type OpcionCategoria } from './util.js';

interface FilaStock {
  id: string;
  sku: string;
  nombre: string;
  tipo: TipoProducto;
  imagenUrl: string | null;
  controlaStock: boolean;
  stockMinimo: number;
  precioVenta: number;
  stockTotal: number | null;
  stockVenta: number | null;
  stockCanalMin: number | null;
  estadoStock: EstadoStock;
  stockUbicacion?: number;
}

interface Respuesta {
  productos: FilaStock[];
  total: number;
  pagina: number;
  porPagina: number;
}

interface Ubicacion {
  id: string;
  codigo: string;
  nombre: string;
  esVenta: boolean;
}

interface Conteos {
  negativos: number;
  quiebres: number;
  bajos: number;
  web: number;
}

type FiltroEstado = EstadoStock | 'todos';

const ETIQUETA_ESTADO: Record<EstadoStock, { texto: string; tono: 'neutro' | 'ok' | 'alerta' | 'peligro' }> = {
  negativo: { texto: 'Negativo', tono: 'peligro' },
  quiebre: { texto: 'Sin stock', tono: 'peligro' },
  bajo: { texto: 'Bajo mínimo', tono: 'alerta' },
  ok: { texto: 'OK', tono: 'ok' },
  sin_control: { texto: 'Sin control', tono: 'neutro' },
};

export function Stock() {
  const navegar = useNavigate();
  const { avisar } = useAvisos();
  const [q, setQ] = useState('');
  const [ubicacionId, setUbicacionId] = useState('');
  const [estado, setEstado] = useState<FiltroEstado>('todos');
  const [categoriaId, setCategoriaId] = useState('');
  const [pagina, setPagina] = useState(1);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [opcionesCategoria, setOpcionesCategoria] = useState<OpcionCategoria[]>([]);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [dialogo, setDialogo] = useState<{ producto: FilaStock; motivo: MotivoManual } | null>(null);
  const [conteos, setConteos] = useState<Conteos | null>(null);

  const cargarConteos = useCallback(() => {
    void api<{ conteos: Conteos }>('/stock/alertas')
      .then((r) => setConteos(r.conteos))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void categorias().then((arbol) => setOpcionesCategoria(aplanarCategorias(arbol)));
    void api<{ ubicaciones: Ubicacion[] }>('/ubicaciones').then((r) => setUbicaciones(r.ubicaciones)).catch(() => {});
    cargarConteos();
  }, [cargarConteos]);

  useEffect(() => setPagina(1), [q, ubicacionId, estado, categoriaId]);

  const cargar = useCallback(() => {
    const p = new URLSearchParams({ pagina: String(pagina), limit: '50' });
    if (q.trim().length >= 2) p.set('q', q.trim());
    if (ubicacionId) p.set('ubicacionId', ubicacionId);
    if (estado !== 'todos') p.set('estado', estado);
    if (categoriaId) p.set('categoriaId', categoriaId);
    setCargando(true);
    const id = setTimeout(() => {
      api<Respuesta>(`/stock?${p}`)
        .then((r) => {
          setDatos(r);
          setCargando(false);
        })
        .catch(() => {
          setCargando(false);
          avisar({
            tono: 'error',
            titulo: 'No se pudo cargar el stock.',
            detalle: 'Revisa la conexión y vuelve a intentar.',
            accion: { etiqueta: 'Reintentar', onClick: cargar },
          });
        });
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, ubicacionId, estado, categoriaId, pagina]);
  useEffect(cargar, [cargar]);

  const abrir = (producto: FilaStock, motivo: MotivoManual) => setDialogo({ producto, motivo });
  const ubicacionNombre = ubicaciones.find((u) => u.id === ubicacionId)?.nombre;
  const totalAlertas = conteos ? conteos.negativos + conteos.quiebres + conteos.bajos + conteos.web : null;

  const exportar = () =>
    void descargar(`/stock/export.csv${ubicacionId ? `?ubicacionId=${ubicacionId}` : ''}`, `stock-${new Date().toISOString().slice(0, 10)}.csv`)
      .then(() => avisar({ tono: 'ok', titulo: 'CSV descargado.' }))
      .catch(() => avisar({ tono: 'error', titulo: 'No se pudo exportar el CSV.', detalle: 'Revisa la conexión y vuelve a intentar.' }));

  const columnas: Columna<FilaStock>[] = [
    {
      clave: 'producto',
      titulo: 'Producto',
      ancho: 'minmax(0,1fr)',
      render: (p) => (
        <CeldaDoble
          principal={<span className={p.controlaStock ? '' : 'text-lab3'}>{p.nombre}</span>}
          secundaria={`${p.sku} · ${ETIQUETA_TIPO[p.tipo]} · ${clp(p.precioVenta)}${p.stockCanalMin != null ? ` · en la web: ${p.stockCanalMin}` : ''}`}
        />
      ),
    },
    {
      clave: 'cantidad',
      titulo: 'Cantidad',
      ancho: '96px',
      alinear: 'derecha',
      enTarjeta: 'cifra',
      render: (p) => {
        const cantidad = ubicacionId ? p.stockUbicacion ?? 0 : p.stockTotal;
        return <span className={`num text-[16px] font-semibold ${cantidad != null && cantidad < 0 ? 'text-peligro' : 'text-lab'}`}>{cantidad ?? '—'}</span>;
      },
    },
    { clave: 'minimo', titulo: 'Mínimo', ancho: '80px', alinear: 'derecha', prioridad: 3, enTarjeta: 'cifra', render: (p) => <span className="num text-lab3">{p.stockMinimo || '—'}</span> },
    {
      clave: 'estado',
      titulo: 'Estado',
      ancho: '120px',
      prioridad: 2,
      enTarjeta: 'cifra',
      render: (p) => <Insignia tono={ETIQUETA_ESTADO[p.estadoStock].tono}>{ETIQUETA_ESTADO[p.estadoStock].texto}</Insignia>,
    },
  ];

  return (
    <div className="p-4 sm:px-8 sm:py-6">
      <Encabezado
        titulo="Stock"
        subtitulo={datos ? `Inventario · ${datos.total} producto${datos.total === 1 ? '' : 's'} ${estado === 'sin_control' ? 'sin control' : 'controlados'}` : 'Inventario'}
        acciones={
          <>
            <Boton ajustado onClick={() => navegar('/admin/stock/alertas')}>
              Alertas{totalAlertas !== null ? <span className="num font-semibold"> {totalAlertas}</span> : null}
            </Boton>
            <Boton ajustado variante="principal" onClick={() => navegar('/admin/recuentos')}>
              Nuevo recuento
            </Boton>
            <MenuAcciones
              variante="cabecera"
              items={[
                { etiqueta: 'Exportar CSV', onClick: exportar },
                { etiqueta: 'Ver recuentos', onClick: () => navegar('/admin/recuentos') },
              ]}
            />
          </>
        }
      />

      <Filtros>
        <Filtro ancho="1 1 220px" minimo={200}>
          <CampoBuscar id="buscar-stock" valor={q} onValor={setQ} placeholder="Nombre, código o código de barras" />
        </Filtro>
        <Filtro ancho="0 1 180px">
          <Selecto etiqueta="Ubicación" valor={ubicacionId} onValor={setUbicacionId} opciones={ubicaciones.map((u) => ({ valor: u.id, etiqueta: u.nombre }))} vacia="Todas (total)" />
        </Filtro>
        <Filtro ancho="0 1 200px">
          <Selecto etiqueta="Categoría" valor={categoriaId} onValor={setCategoriaId} opciones={opcionesCategoria.map((c) => ({ valor: c.id, etiqueta: c.etiqueta }))} vacia="Todas" />
        </Filtro>
        <Segmentado<FiltroEstado>
          fijo
          valor={estado}
          onChange={(v) => setEstado(v ?? 'todos')}
          opciones={[
            { valor: 'todos', etiqueta: 'Todos' },
            { valor: 'negativo', etiqueta: 'Negativo', conteo: conteos?.negativos },
            { valor: 'quiebre', etiqueta: 'Sin stock', conteo: conteos?.quiebres },
            { valor: 'bajo', etiqueta: 'Bajo mínimo', conteo: conteos?.bajos },
            { valor: 'ok', etiqueta: 'OK' },
            { valor: 'sin_control', etiqueta: 'Sin control' },
          ]}
        />
      </Filtros>

      <Tabla
        columnas={columnas}
        filas={datos?.productos ?? []}
        clave={(p) => p.id}
        cargando={cargando}
        resumen={
          datos ? (
            <>
              <strong className="num font-semibold text-lab">{datos.total}</strong> producto{datos.total === 1 ? '' : 's'}
              {estado !== 'todos' ? ` · ${ETIQUETA_ESTADO[estado].texto.toLowerCase()}` : ''}
              {ubicacionNombre ? ` · cantidad en ${ubicacionNombre}` : ' · cantidad total (todas las ubicaciones)'}
            </>
          ) : (
            'Cargando…'
          )
        }
        vacio={
          <Vacio
            mensaje={
              estado === 'sin_control'
                ? 'Todos los productos de este filtro ya controlan stock.'
                : 'Ningún producto controla stock con estos filtros. Haz un recuento para empezar (activación gradual, P4).'
            }
            accion={
              <Boton ajustado onClick={() => navegar('/admin/recuentos')}>
                Nuevo recuento
              </Boton>
            }
          />
        }
        menu={(p) =>
          p.controlaStock
            ? [
                { etiqueta: 'Ajustar cantidad', onClick: () => abrir(p, 'ajuste') },
                { etiqueta: 'Registrar merma', onClick: () => abrir(p, 'merma') },
                { etiqueta: 'Ingresar', onClick: () => abrir(p, 'compra') },
                { etiqueta: 'Trasladar', onClick: () => abrir(p, 'traslado') },
                { etiqueta: 'Ver kardex', onClick: () => navegar(`/admin/productos?q=${encodeURIComponent(p.sku)}`), separadorAntes: true },
              ]
            : [{ etiqueta: 'Ingresar y encender control', onClick: () => abrir(p, 'compra') }]
        }
        pie={datos && datos.total > datos.porPagina ? <Paginacion pagina={datos.pagina} porPagina={datos.porPagina} total={datos.total} onPagina={setPagina} sustantivo="productos" /> : undefined}
      />

      <DialogoMovimientoStock
        abierto={dialogo !== null}
        producto={dialogo?.producto ?? null}
        motivoInicial={dialogo?.motivo ?? 'ajuste'}
        ubicacionInicialId={ubicacionId || null}
        onCerrar={() => setDialogo(null)}
        onHecho={(m) => {
          avisar({ tono: 'ok', titulo: 'Movimiento guardado.', detalle: m });
          cargar();
          cargarConteos();
        }}
      />
    </div>
  );
}
