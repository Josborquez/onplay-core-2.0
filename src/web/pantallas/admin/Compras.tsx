// V25/V26/V27 — Compras (11-SDD §8). Lista de compras y proveedores; carga de una factura desde el
// PDF (el lector del distribuidor la lee, la persona revisa y vincula) o digitada; detalle del
// borrador con vinculación de líneas y «Recibir», que ingresa las unidades al libro de stock.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorApi, api } from '../../api.js';
import { Banner, Boton, Campo, CampoMonto, Cargando, Dialogo, Insignia, Vacio } from '../../components/base.js';
import { clp, fecha } from '../../utils/formato.js';
import {
  ETIQUETA_ESTADO_COMPRA,
  ETIQUETA_TIPO_DOC,
  type CompraDetalle as CompraDetalleDatos,
  type CompraResumen,
  type EstadoCompra,
  type LectorFactura,
  type Lectura,
  type LineaCompra,
  type LineaPropuesta,
  type OpcionLector,
  type Proveedor,
  type ResultadoBusquedaProducto,
  type TipoDocumentoCompra,
} from '../../tiposCompras.js';
import { Encabezado, Paginacion, Selecto } from './util.js';

interface Ubicacion {
  id: string;
  codigo: string;
  nombre: string;
  publicable: boolean;
}

function mensajeError(e: unknown, porCodigo: Record<string, string> = {}): string {
  if (e instanceof ErrorApi) {
    const detalle = typeof e.cuerpo.detalle === 'string' ? e.cuerpo.detalle : '';
    return porCodigo[e.codigo] ?? (detalle ? `${detalle} (${e.codigo})` : `No se pudo (${e.codigo}).`);
  }
  return 'Sin conexión.';
}

function calcularCantidad(bultos: number, unidadesPorBulto: number, sueltas: number): number {
  return bultos * Math.max(1, unidadesPorBulto) + sueltas;
}

const hoyIso = () => new Date().toISOString().slice(0, 10);

/* =========================================================================================
 * Proveedores
 * ========================================================================================= */

function DialogoProveedor({
  abierto,
  inicial,
  lectores,
  onCerrar,
  onHecho,
}: {
  abierto: boolean;
  inicial: Partial<Proveedor> | null;
  lectores: OpcionLector[];
  onCerrar: () => void;
  onHecho: (p: Proveedor) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [lector, setLector] = useState<LectorFactura>('manual');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const editando = !!inicial?.id;

  useEffect(() => {
    if (!abierto) return;
    setNombre(inicial?.nombre ?? '');
    setRut(inicial?.rut ?? '');
    setLector(inicial?.lector ?? 'manual');
    setError('');
  }, [abierto, inicial]);

  const guardar = async () => {
    setEnviando(true);
    setError('');
    try {
      const cuerpo = JSON.stringify({ nombre: nombre.trim(), rut: rut.trim() || null, lector });
      const p = editando
        ? await api<Proveedor>(`/proveedores/${inicial!.id}`, { method: 'PATCH', body: cuerpo })
        : await api<Proveedor>('/proveedores', { method: 'POST', body: cuerpo });
      onHecho(p);
    } catch (e) {
      setError(
        mensajeError(e, {
          RUT_INVALIDO: 'El RUT no es válido.',
          PROVEEDOR_DUPLICADO: 'Ya existe un proveedor con ese RUT.',
          NOMBRE_REQUERIDO: 'Falta el nombre.',
        }),
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo abierto={abierto} titulo={editando ? 'Editar proveedor' : 'Nuevo proveedor'} onCerrar={onCerrar} cerrable={!enviando}>
      <div className="flex flex-col gap-3">
        <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus placeholder="Ej.: Embotelladora Andina S.A." />
        <Campo etiqueta="RUT (opcional)" value={rut} onChange={(e) => setRut(e.target.value)} placeholder="91.144.000-8" ayuda="Con RUT, el sistema reconoce sus facturas solo." />
        <Selecto etiqueta="Cómo llegan sus documentos" valor={lector} onValor={(v) => setLector(v as LectorFactura)} opciones={lectores.map((l) => ({ valor: l.clave, etiqueta: l.nombre }))} />
        {error ? <p className="text-chico text-peligro">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar} deshabilitado={enviando}>
            Cancelar
          </Boton>
          <Boton variante="principal" cargando={enviando} deshabilitado={!nombre.trim()} onClick={() => void guardar()}>
            {editando ? 'Guardar' : 'Crear proveedor'}
          </Boton>
        </div>
      </div>
    </Dialogo>
  );
}

/* =========================================================================================
 * Vincular una línea a un producto del maestro
 * ========================================================================================= */

interface ObjetivoVincular {
  descripcion: string;
  codigoProveedor: string | null;
  bultos: number;
  sueltas: number;
  unidadesPorBulto: number;
  productoActual: ResultadoBusquedaProducto | null;
}

function DialogoVincular({
  objetivo,
  onCerrar,
  onElegir,
}: {
  objetivo: ObjetivoVincular | null;
  onCerrar: () => void;
  onElegir: (r: { producto: ResultadoBusquedaProducto | null; unidadesPorBulto: number }) => void | Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<ResultadoBusquedaProducto[]>([]);
  const [elegido, setElegido] = useState<ResultadoBusquedaProducto | null>(null);
  const [upb, setUpb] = useState<number | ''>(1);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!objetivo) return;
    // Sugerencia de búsqueda: las dos primeras palabras de la descripción del proveedor.
    setQ(objetivo.productoActual ? objetivo.productoActual.nombre : objetivo.descripcion.split(/\s+/).slice(0, 2).join(' '));
    setElegido(objetivo.productoActual);
    setUpb(objetivo.unidadesPorBulto);
    setResultados([]);
    setError('');
  }, [objetivo]);

  useEffect(() => {
    if (!objetivo || q.trim().length < 2) {
      setResultados([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ resultados: ResultadoBusquedaProducto[] }>(`/productos/buscar?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setResultados(r.resultados.slice(0, 8)))
        .catch(() => setResultados([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, objetivo]);

  const unidades = objetivo ? calcularCantidad(objetivo.bultos, Number(upb) || 1, objetivo.sueltas) : 0;

  const confirmar = async (producto: ResultadoBusquedaProducto | null) => {
    setEnviando(true);
    setError('');
    try {
      await onElegir({ producto, unidadesPorBulto: Math.max(1, Number(upb) || 1) });
    } catch (e) {
      setError(mensajeError(e, { PRODUCTO_SIN_STOCK: 'Un servicio no tiene stock.', COMPRA_NO_EDITABLE: 'La compra ya no se puede editar.' }));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo abierto={objetivo !== null} titulo="Vincular a un producto" onCerrar={onCerrar} cerrable={!enviando} ancho={560}>
      {objetivo ? (
        <div className="flex flex-col gap-3">
          <p className="text-cuerpo text-lab">
            {objetivo.descripcion}
            {objetivo.codigoProveedor ? <span className="text-chico text-lab3"> · código {objetivo.codigoProveedor}</span> : null}
          </p>
          <Campo etiqueta="Buscar producto del maestro" value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="SKU, nombre o código de barras" />
          {resultados.length > 0 ? (
            <ul className="max-h-[240px] divide-y divide-sep overflow-y-auto rounded-campo border border-sep">
              {resultados.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setElegido(r)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left ${elegido?.id === r.id ? 'bg-bg3 font-semibold' : ''}`}
                  >
                    <span className="text-cuerpo text-lab">
                      <span className="font-mono text-chico text-lab3">{r.sku}</span> {r.nombre}
                    </span>
                    <span className="num text-chico text-lab2">{clp(r.precioVenta)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : q.trim().length >= 2 ? (
            <p className="text-chico text-lab3">Sin resultados. Si el producto no existe, créalo en «Alta de snack» o «Productos» y vuelve.</p>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Campo
              etiqueta="Unidades por bulto"
              type="number"
              inputMode="numeric"
              min={1}
              value={upb}
              onChange={(e) => setUpb(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))}
              ayuda="Cuántas unidades vendibles trae cada caja"
            />
            <div className="self-end pb-1 text-chico text-lab2">
              <span className="num">{objetivo.bultos}</span> caja(s) × <span className="num">{Number(upb) || 1}</span>
              {objetivo.sueltas ? (
                <>
                  {' '}
                  + <span className="num">{objetivo.sueltas}</span> sueltas
                </>
              ) : null}{' '}
              = <span className="num font-semibold text-lab">{unidades}</span> unidades
            </div>
          </div>
          {elegido ? (
            <p className="text-chico text-lab2">
              Se vinculará a <span className="font-mono">{elegido.sku}</span> y el sistema lo recordará para la próxima factura de este proveedor.
            </p>
          ) : null}
          {error ? <p className="text-chico text-peligro">{error}</p> : null}
          <div className="flex justify-end gap-2">
            {objetivo.productoActual ? (
              <Boton variante="peligro" deshabilitado={enviando} onClick={() => void confirmar(null)}>
                Quitar vínculo
              </Boton>
            ) : null}
            <Boton onClick={onCerrar} deshabilitado={enviando}>
              Cancelar
            </Boton>
            <Boton variante="principal" cargando={enviando} deshabilitado={!elegido} onClick={() => void confirmar(elegido)}>
              Vincular
            </Boton>
          </div>
        </div>
      ) : null}
    </Dialogo>
  );
}

/* =========================================================================================
 * Tabla de líneas (propuesta y detalle comparten la forma)
 * ========================================================================================= */

interface LineaVista {
  clave: string;
  codigoProveedor: string | null;
  descripcion: string;
  bultos: number;
  unidadesPorBulto: number;
  sueltas: number;
  cantidad: number;
  total: number;
  costoUnitario: number;
  producto: { sku: string; nombre: string; costoReferencia?: number | null } | null;
  aprendida?: boolean;
  stockVigente?: number | null;
  movimientoId?: string | null;
}

function TablaLineas({ lineas, editable, onVincular, onEditar, onEliminar }: { lineas: LineaVista[]; editable: boolean; onVincular?: (l: LineaVista) => void; onEditar?: (l: LineaVista) => void; onEliminar?: (l: LineaVista) => void }) {
  return (
    <div className="overflow-x-auto rounded-tarjeta border border-sep bg-bg">
      <table className="w-full min-w-[720px] border-collapse text-left text-cuerpo">
        <thead>
          <tr className="text-chico text-lab3">
            <th className="px-3 py-2 font-normal">Documento del proveedor</th>
            <th className="px-3 py-2 text-right font-normal">Cajas</th>
            <th className="px-3 py-2 text-right font-normal">Unidades</th>
            <th className="px-3 py-2 text-right font-normal">Total</th>
            <th className="px-3 py-2 text-right font-normal">Costo unit.</th>
            <th className="px-3 py-2 font-normal">Producto del maestro</th>
            {editable ? <th className="px-3 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => (
            <tr key={l.clave} className="border-t border-sep">
              <td className="px-3 py-2">
                <div className="text-lab">{l.descripcion}</div>
                {l.codigoProveedor ? <div className="font-mono text-chico text-lab3">{l.codigoProveedor}</div> : null}
              </td>
              <td className="num px-3 py-2 text-right text-lab2">
                {l.bultos}
                <span className="text-chico text-lab3"> ×{l.unidadesPorBulto}</span>
                {l.sueltas ? <span className="text-chico text-lab3"> +{l.sueltas}</span> : null}
              </td>
              <td className="num px-3 py-2 text-right font-semibold text-lab">
                {l.cantidad}
                {l.stockVigente !== undefined && l.stockVigente !== null && !l.movimientoId ? (
                  <div className="text-chico font-normal text-lab3">
                    {l.stockVigente} → {l.stockVigente + l.cantidad}
                  </div>
                ) : null}
              </td>
              <td className="num px-3 py-2 text-right text-lab">{clp(l.total)}</td>
              <td className="num px-3 py-2 text-right text-lab2">
                {clp(l.costoUnitario)}
                {l.producto?.costoReferencia != null && l.producto.costoReferencia !== l.costoUnitario ? (
                  <div className="text-chico text-lab3">antes {clp(l.producto.costoReferencia)}</div>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {l.producto ? (
                  <span className="text-lab">
                    <span className="font-mono text-chico text-lab3">{l.producto.sku}</span> {l.producto.nombre}
                    {l.aprendida ? <span className="text-chico text-lab3"> · recordado</span> : null}
                  </span>
                ) : (
                  <Insignia tono="alerta">sin vincular</Insignia>
                )}
              </td>
              {editable ? (
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    {onVincular ? (
                      <button type="button" className="rounded-campo border border-sep px-2 py-1 text-chico text-lab" onClick={() => onVincular(l)}>
                        {l.producto ? 'Cambiar' : 'Vincular'}
                      </button>
                    ) : null}
                    {onEditar ? (
                      <button type="button" className="rounded-campo border border-sep px-2 py-1 text-chico text-lab" onClick={() => onEditar(l)}>
                        Editar
                      </button>
                    ) : null}
                    {onEliminar ? (
                      <button type="button" className="rounded-campo px-2 py-1 text-chico text-peligro" onClick={() => onEliminar(l)}>
                        Quitar
                      </button>
                    ) : null}
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResumenTotales({ neto, impuestos, total, sumaLineas }: { neto: number; impuestos: number; total: number; sumaLineas?: { total: number } }) {
  return (
    <div className="flex flex-wrap justify-end gap-6 text-cuerpo">
      <div>
        <div className="text-chico text-lab3">Neto</div>
        <div className="num text-lab">{clp(neto)}</div>
      </div>
      <div>
        <div className="text-chico text-lab3">Impuestos</div>
        <div className="num text-lab">{clp(impuestos)}</div>
      </div>
      <div>
        <div className="text-chico text-lab3">Total del documento</div>
        <div className="num text-total text-lab">{clp(total)}</div>
        {sumaLineas && sumaLineas.total !== total ? <div className="text-chico text-peligro">las líneas suman {clp(sumaLineas.total)}</div> : null}
      </div>
    </div>
  );
}

/* =========================================================================================
 * V25 — Lista de compras + proveedores
 * ========================================================================================= */

export function Compras() {
  const [datos, setDatos] = useState<{ total: number; pagina: number; porPagina: number; compras: CompraResumen[] } | null>(null);
  const [estado, setEstado] = useState<EstadoCompra | ''>('');
  const [pagina, setPagina] = useState(1);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [lectores, setLectores] = useState<OpcionLector[]>([]);
  const [dialogoProveedor, setDialogoProveedor] = useState<{ abierto: boolean; inicial: Partial<Proveedor> | null }>({ abierto: false, inicial: null });
  const [aviso, setAviso] = useState('');

  const cargarProveedores = useCallback(() => {
    api<{ proveedores: Proveedor[]; lectores: OpcionLector[] }>('/proveedores')
      .then((r) => {
        setProveedores(r.proveedores);
        setLectores(r.lectores);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const q = new URLSearchParams();
    if (estado) q.set('estado', estado);
    q.set('pagina', String(pagina));
    api<{ total: number; pagina: number; porPagina: number; compras: CompraResumen[] }>(`/compras?${q.toString()}`)
      .then(setDatos)
      .catch(() => setDatos({ total: 0, pagina: 1, porPagina: 50, compras: [] }));
  }, [estado, pagina]);

  useEffect(cargarProveedores, [cargarProveedores]);

  return (
    <div>
      <Encabezado
        titulo="Compras"
        extra={
          <Link to="/admin/compras/nueva" className="flex h-tactil items-center rounded-campo bg-ac-relleno px-4 font-semibold text-sobre-ac">
            Cargar factura
          </Link>
        }
      />
      {aviso ? <div className="mb-3"><Banner tono="ok">{aviso}</Banner></div> : null}

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-[200px]">
          <Selecto
            etiqueta="Estado"
            valor={estado}
            onValor={(v) => {
              setEstado(v as EstadoCompra | '');
              setPagina(1);
            }}
            opciones={[
              { valor: 'borrador', etiqueta: 'Borradores' },
              { valor: 'recibida', etiqueta: 'Recibidas' },
              { valor: 'anulada', etiqueta: 'Anuladas' },
            ]}
            vacia="Todas"
          />
        </div>
      </div>

      {!datos ? (
        <Cargando />
      ) : datos.compras.length === 0 ? (
        <Vacio mensaje="Todavía no hay compras cargadas." accion={<Link to="/admin/compras/nueva" className="text-ac underline">Cargar la primera factura</Link>} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-tarjeta border border-sep bg-bg">
            <table className="w-full min-w-[640px] border-collapse text-left text-cuerpo">
              <thead>
                <tr className="text-chico text-lab3">
                  <th className="px-3 py-2 font-normal">Fecha</th>
                  <th className="px-3 py-2 font-normal">Proveedor</th>
                  <th className="px-3 py-2 font-normal">Documento</th>
                  <th className="px-3 py-2 text-right font-normal">Unidades</th>
                  <th className="px-3 py-2 text-right font-normal">Total</th>
                  <th className="px-3 py-2 font-normal">Estado</th>
                  <th className="px-3 py-2 font-normal">Cargó</th>
                </tr>
              </thead>
              <tbody>
                {datos.compras.map((c) => {
                  const e = ETIQUETA_ESTADO_COMPRA[c.estado];
                  return (
                    <tr key={c.id} className="border-t border-sep">
                      <td className="num px-3 py-2 text-lab2">{fecha(c.fechaDocumento)}</td>
                      <td className="px-3 py-2 text-lab">{c.proveedor.nombre}</td>
                      <td className="px-3 py-2">
                        <Link to={`/admin/compras/${c.id}`} className="text-ac underline">
                          {ETIQUETA_TIPO_DOC[c.tipoDocumento]} {c.numeroDocumento}
                        </Link>
                        <div className="text-chico text-lab3">
                          {c.totalLineas} línea(s){c.sinVincular ? ` · ${c.sinVincular} sin vincular` : ''}
                        </div>
                      </td>
                      <td className="num px-3 py-2 text-right text-lab">{c.unidades}</td>
                      <td className="num px-3 py-2 text-right text-lab">{clp(c.total)}</td>
                      <td className="px-3 py-2">
                        <Insignia tono={e.tono}>{e.texto}</Insignia>
                      </td>
                      <td className="px-3 py-2 text-chico text-lab2">{c.usuario.nombre}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Paginacion pagina={datos.pagina} porPagina={datos.porPagina} total={datos.total} onPagina={setPagina} />
        </>
      )}

      <details className="mt-6 rounded-tarjeta border border-sep bg-bg p-4">
        <summary className="cursor-pointer text-cuerpo font-semibold text-lab">
          Proveedores ({proveedores.length})
        </summary>
        <p className="mt-2 text-chico text-lab2">
          Cada distribuidor manda su factura distinta. Con el RUT cargado, el sistema reconoce sus PDF y usa el lector que corresponde; los que no tienen lector se digitan a mano.
        </p>
        <div className="mt-3 w-[200px]">
          <Boton onClick={() => setDialogoProveedor({ abierto: true, inicial: null })}>Nuevo proveedor</Boton>
        </div>
        {proveedores.length > 0 ? (
          <ul className="mt-3 divide-y divide-sep">
            {proveedores.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="text-cuerpo text-lab">{p.nombre}</span>
                  {p.rut ? <span className="font-mono text-chico text-lab3"> · {p.rut}</span> : null}
                  {!p.activo ? <span className="text-chico text-lab3"> · inactivo</span> : null}
                  <div className="text-chico text-lab3">
                    {lectores.find((l) => l.clave === p.lector)?.nombre ?? p.lector} · {p.compras ?? 0} compra(s) · {p.productosVinculados ?? 0} producto(s) recordado(s)
                  </div>
                </div>
                <button type="button" className="rounded-campo border border-sep px-2 py-1 text-chico text-lab" onClick={() => setDialogoProveedor({ abierto: true, inicial: p })}>
                  Editar
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </details>

      <DialogoProveedor
        abierto={dialogoProveedor.abierto}
        inicial={dialogoProveedor.inicial}
        lectores={lectores}
        onCerrar={() => setDialogoProveedor({ abierto: false, inicial: null })}
        onHecho={(p) => {
          setDialogoProveedor({ abierto: false, inicial: null });
          setAviso(`Proveedor «${p.nombre}» guardado.`);
          cargarProveedores();
        }}
      />
    </div>
  );
}

/* =========================================================================================
 * V26 — Cargar una factura
 * ========================================================================================= */

function leerComoBase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(',')[1] ?? '');
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(archivo);
  });
}

export function CompraNueva() {
  const navigate = useNavigate();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [lectores, setLectores] = useState<OpcionLector[]>([]);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [errorLectura, setErrorLectura] = useState<{ mensaje: string; muestra?: string[] } | null>(null);
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [lineas, setLineas] = useState<LineaPropuesta[]>([]);
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [numero, setNumero] = useState('');
  const [fechaDoc, setFechaDoc] = useState(hoyIso());
  const [tipoDoc, setTipoDoc] = useState<TipoDocumentoCompra>('factura');
  const [ubicacionId, setUbicacionId] = useState('');
  const [vinculando, setVinculando] = useState<number | null>(null);
  const [dialogoProveedor, setDialogoProveedor] = useState<Partial<Proveedor> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState('');
  const [modoManual, setModoManual] = useState(false);

  const cargarProveedores = useCallback(
    () =>
      api<{ proveedores: Proveedor[]; lectores: OpcionLector[] }>('/proveedores').then((r) => {
        setProveedores(r.proveedores);
        setLectores(r.lectores);
        return r.proveedores;
      }),
    [],
  );

  useEffect(() => {
    void cargarProveedores().catch(() => {});
    void api<{ ubicaciones: Ubicacion[] }>('/ubicaciones')
      .then((r) => {
        setUbicaciones(r.ubicaciones);
        const bodega = r.ubicaciones.find((u) => u.publicable) ?? r.ubicaciones[0];
        if (bodega) setUbicacionId((actual) => actual || bodega.id);
      })
      .catch(() => {});
  }, [cargarProveedores]);

  const alElegirArchivo = async (archivo: File | undefined) => {
    if (!archivo) return;
    setLeyendo(true);
    setErrorLectura(null);
    setLectura(null);
    setLineas([]);
    setModoManual(false);
    try {
      const base64 = await leerComoBase64(archivo);
      const r = await api<Lectura>('/compras/leer', { method: 'POST', body: JSON.stringify({ archivo: base64, nombre: archivo.name }) });
      setLectura(r);
      setLineas(r.lineas);
      setProveedor(r.proveedor);
      setNumero(r.numeroDocumento ?? '');
      setFechaDoc(r.fechaDocumento ?? hoyIso());
      setTipoDoc(r.tipoDocumento);
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'LECTOR_NO_DISPONIBLE') {
        setErrorLectura({
          mensaje: 'Ningún lector entiende este documento todavía. Se puede digitar a mano; para que el sistema lo lea solo, hay que agregar un lector para este distribuidor.',
          muestra: Array.isArray(e.cuerpo.muestra) ? (e.cuerpo.muestra as string[]) : undefined,
        });
        setModoManual(true);
      } else {
        setErrorLectura({
          mensaje: mensajeError(e, {
            PDF_ILEGIBLE: 'No se pudo leer el texto del PDF. Si es una foto o un escaneo, hay que digitarlo a mano.',
            ARCHIVO_INVALIDO: 'El archivo no es un PDF.',
            ARCHIVO_DEMASIADO_GRANDE: 'El PDF supera los 8 MB.',
          }),
        });
      }
    } finally {
      setLeyendo(false);
    }
  };

  const vincular = (indice: number, r: { producto: ResultadoBusquedaProducto | null; unidadesPorBulto: number }) => {
    setLineas((prev) =>
      prev.map((l, i) => {
        if (i !== indice) return l;
        const cantidad = calcularCantidad(l.bultos, r.unidadesPorBulto, l.sueltas);
        return {
          ...l,
          unidadesPorBulto: r.unidadesPorBulto,
          cantidad,
          costoUnitario: Math.round(l.total / cantidad),
          productoId: r.producto?.id ?? null,
          producto: r.producto ? { id: r.producto.id, sku: r.producto.sku, nombre: r.producto.nombre, controlaStock: r.producto.controlaStock ?? false, costoReferencia: null, precioVenta: r.producto.precioVenta, tipo: '' } : null,
          aprendida: false,
        };
      }),
    );
    setVinculando(null);
  };

  const sinVincular = lineas.filter((l) => !l.productoId).length;

  const guardar = async () => {
    if (!proveedor) return;
    setGuardando(true);
    setErrorGuardar('');
    try {
      const c = await api<{ id: string }>('/compras', {
        method: 'POST',
        body: JSON.stringify({
          proveedorId: proveedor.id,
          tipoDocumento: tipoDoc,
          numeroDocumento: numero.trim(),
          fechaDocumento: fechaDoc,
          ubicacionId,
          origen: lectura ? 'pdf' : 'manual',
          lector: lectura?.lector ?? 'manual',
          archivoNombre: lectura?.archivoNombre ?? null,
          totales: lectura ? { neto: lectura.totales.neto, impuestos: lectura.totales.impuestos, total: lectura.totales.total } : null,
          advertencias: lectura?.advertencias ?? [],
          lineas: lineas.map((l) => ({
            codigoProveedor: l.codigoProveedor,
            descripcion: l.descripcion,
            bultos: l.bultos,
            unidadesPorBulto: l.unidadesPorBulto,
            sueltas: l.sueltas,
            neto: l.neto,
            impuestos: l.impuestos,
            total: l.total,
            productoId: l.productoId,
          })),
        }),
      });
      navigate(`/admin/compras/${c.id}`);
    } catch (e) {
      setErrorGuardar(
        mensajeError(e, {
          COMPRA_DUPLICADA: 'Ese documento ya está cargado para este proveedor.',
          NUMERO_REQUERIDO: 'Falta el número del documento.',
          FECHA_INVALIDA: 'La fecha no es válida.',
        }),
      );
    } finally {
      setGuardando(false);
    }
  };

  const objetivoVincular: ObjetivoVincular | null = useMemo(() => {
    if (vinculando === null) return null;
    const l = lineas[vinculando];
    if (!l) return null;
    return {
      descripcion: l.descripcion,
      codigoProveedor: l.codigoProveedor,
      bultos: l.bultos,
      sueltas: l.sueltas,
      unidadesPorBulto: l.unidadesPorBulto,
      productoActual: l.producto ? { id: l.producto.id, sku: l.producto.sku, nombre: l.producto.nombre, precioVenta: l.producto.precioVenta } : null,
    };
  }, [vinculando, lineas]);

  const puedeGuardar = !!proveedor && numero.trim().length > 0 && !!ubicacionId && !guardando && !lectura?.yaCargada;

  return (
    <div>
      <Encabezado titulo="Cargar factura" extra={<Link to="/admin/compras" className="text-chico text-lab2 underline">← Compras</Link>} />

      <div className="rounded-tarjeta border border-sep bg-bg p-4">
        <p className="mb-3 text-cuerpo text-lab">
          Elige el PDF que mandó el distribuidor. El sistema reconoce de quién es y lee las líneas; tú revisas, vinculas cada línea a un producto y recibes.
        </p>
        <label className="flex h-boton w-full cursor-pointer items-center justify-center rounded-campo border border-dashed border-sep text-cuerpo text-lab2">
          <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void alElegirArchivo(e.target.files?.[0])} disabled={leyendo} />
          {leyendo ? 'Leyendo el PDF…' : lectura?.archivoNombre ? `${lectura.archivoNombre} · elegir otro` : 'Elegir PDF de la factura'}
        </label>
        {errorLectura ? (
          <div className="mt-3">
            <Banner tono="alerta">{errorLectura.mensaje}</Banner>
            {errorLectura.muestra?.length ? (
              <details className="mt-2 text-chico text-lab3">
                <summary className="cursor-pointer">Primeras líneas del documento (para agregar el lector)</summary>
                <pre className="mt-1 overflow-x-auto rounded-campo bg-bg3 p-2">{errorLectura.muestra.join('\n')}</pre>
              </details>
            ) : null}
          </div>
        ) : null}
        {!lectura && !modoManual ? (
          <button type="button" className="mt-3 text-chico text-lab2 underline" onClick={() => setModoManual(true)}>
            No tengo PDF: digitar la compra a mano
          </button>
        ) : null}
      </div>

      {lectura || modoManual ? (
        <div className="mt-4 flex flex-col gap-4">
          {lectura ? (
            <Banner tono="ok">
              Leída con el lector «{lectura.lectorNombre}»: {lectura.lineas.length} línea(s), total {clp(lectura.totales.total)}.
            </Banner>
          ) : null}
          {lectura?.yaCargada ? (
            <Banner
              tono="peligro"
              accion={
                <Link to={`/admin/compras/${lectura.yaCargada.id}`} className="underline">
                  Ver la compra
                </Link>
              }
            >
              Este documento ya está cargado ({ETIQUETA_ESTADO_COMPRA[lectura.yaCargada.estado].texto}). No se carga dos veces.
            </Banner>
          ) : null}
          {lectura?.advertencias.map((a, i) => (
            <Banner key={i} tono="alerta">
              {a}
            </Banner>
          ))}

          {/* Proveedor */}
          <div className="rounded-tarjeta border border-sep bg-bg p-4">
            <h2 className="mb-2 text-cuerpo font-semibold text-lab">Proveedor</h2>
            {proveedor ? (
              <p className="text-cuerpo text-lab">
                {proveedor.nombre}
                {proveedor.rut ? <span className="font-mono text-chico text-lab3"> · {proveedor.rut}</span> : null}{' '}
                <button type="button" className="text-chico text-lab2 underline" onClick={() => setProveedor(null)}>
                  cambiar
                </button>
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                {lectura?.proveedorSugerido ? (
                  <div className="w-full">
                    <Banner
                      tono="alerta"
                      accion={
                        <button type="button" className="underline" onClick={() => setDialogoProveedor({ nombre: lectura.proveedorSugerido!.nombre, rut: lectura.proveedorSugerido!.rut, lector: lectura.proveedorSugerido!.lector })}>
                          Crear «{lectura.proveedorSugerido.nombre}»
                        </button>
                      }
                    >
                      La factura es de {lectura.proveedorSugerido.nombre} ({lectura.proveedorSugerido.rut}), que todavía no está como proveedor.
                    </Banner>
                  </div>
                ) : null}
                <div className="w-[320px]">
                  <Selecto etiqueta="Elegir proveedor" valor="" onValor={(v) => setProveedor(proveedores.find((p) => p.id === v) ?? null)} opciones={proveedores.filter((p) => p.activo).map((p) => ({ valor: p.id, etiqueta: p.nombre }))} vacia="—" />
                </div>
                <div className="w-[180px]">
                  <Boton onClick={() => setDialogoProveedor({})}>Nuevo proveedor</Boton>
                </div>
              </div>
            )}
          </div>

          {/* Documento */}
          <div className="rounded-tarjeta border border-sep bg-bg p-4">
            <h2 className="mb-2 text-cuerpo font-semibold text-lab">Documento</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Selecto etiqueta="Tipo" valor={tipoDoc} onValor={(v) => setTipoDoc(v as TipoDocumentoCompra)} opciones={(Object.keys(ETIQUETA_TIPO_DOC) as TipoDocumentoCompra[]).map((t) => ({ valor: t, etiqueta: ETIQUETA_TIPO_DOC[t] }))} />
              <Campo etiqueta="Número" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="097397951" />
              <Campo etiqueta="Fecha" type="date" value={fechaDoc} onChange={(e) => setFechaDoc(e.target.value)} />
              <Selecto etiqueta="Entra a" valor={ubicacionId} onValor={setUbicacionId} opciones={ubicaciones.map((u) => ({ valor: u.id, etiqueta: u.nombre }))} />
            </div>
          </div>

          {/* Líneas */}
          {lectura ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-cuerpo font-semibold text-lab">Líneas</h2>
                {sinVincular > 0 ? (
                  <span className="text-chico text-lab2">
                    {sinVincular} sin vincular: se pueden vincular ahora o en el borrador. Lo que quede sin producto no entra al stock.
                  </span>
                ) : (
                  <span className="text-chico text-ok">Todas las líneas tienen producto.</span>
                )}
              </div>
              <TablaLineas
                editable
                lineas={lineas.map((l, i) => ({ ...l, clave: String(i), stockVigente: null }))}
                onVincular={(l) => setVinculando(Number(l.clave))}
              />
              <ResumenTotales {...lectura.totales} />
            </div>
          ) : (
            <p className="text-chico text-lab2">Las líneas se agregan en el borrador, una por una.</p>
          )}

          {errorGuardar ? <Banner tono="peligro">{errorGuardar}</Banner> : null}
          <div className="flex justify-end gap-2">
            <div className="w-[160px]">
              <Boton onClick={() => navigate('/admin/compras')} deshabilitado={guardando}>
                Cancelar
              </Boton>
            </div>
            <div className="w-[240px]">
              <Boton variante="principal" cargando={guardando} deshabilitado={!puedeGuardar} motivoDeshabilitado={!proveedor ? 'Falta el proveedor' : !numero.trim() ? 'Falta el número' : undefined} onClick={() => void guardar()}>
                Guardar borrador
              </Boton>
            </div>
          </div>
        </div>
      ) : null}

      <DialogoVincular objetivo={objetivoVincular} onCerrar={() => setVinculando(null)} onElegir={(r) => vincular(vinculando!, r)} />
      <DialogoProveedor
        abierto={dialogoProveedor !== null}
        inicial={dialogoProveedor}
        lectores={lectores}
        onCerrar={() => setDialogoProveedor(null)}
        onHecho={(p) => {
          setDialogoProveedor(null);
          setProveedor(p);
          void cargarProveedores().catch(() => {});
        }}
      />
    </div>
  );
}

/* =========================================================================================
 * V27 — Detalle de una compra
 * ========================================================================================= */

interface FormLinea {
  id?: string;
  descripcion: string;
  codigoProveedor: string;
  bultos: number | '';
  unidadesPorBulto: number | '';
  sueltas: number | '';
  neto: number | '';
  total: number | '';
}

function DialogoLinea({ abierto, inicial, onCerrar, onGuardar }: { abierto: boolean; inicial: FormLinea | null; onCerrar: () => void; onGuardar: (f: FormLinea) => Promise<void> }) {
  const [f, setF] = useState<FormLinea>({ descripcion: '', codigoProveedor: '', bultos: 0, unidadesPorBulto: 1, sueltas: 0, neto: '', total: '' });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setF(inicial ?? { descripcion: '', codigoProveedor: '', bultos: 0, unidadesPorBulto: 1, sueltas: 0, neto: '', total: '' });
    setError('');
  }, [abierto, inicial]);

  const cantidad = calcularCantidad(Number(f.bultos) || 0, Number(f.unidadesPorBulto) || 1, Number(f.sueltas) || 0);
  const total = Number(f.total) || 0;

  const guardar = async () => {
    setEnviando(true);
    setError('');
    try {
      await onGuardar(f);
    } catch (e) {
      setError(mensajeError(e, { CANTIDAD_INVALIDA: 'La línea debe traer al menos 1 unidad.', LINEA_INVALIDA: 'Falta la descripción.' }));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo abierto={abierto} titulo={inicial?.id ? 'Editar línea' : 'Agregar línea'} onCerrar={onCerrar} cerrable={!enviando} ancho={560}>
      <div className="flex flex-col gap-3">
        <Campo etiqueta="Descripción (como dice el documento)" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} autoFocus />
        <Campo etiqueta="Código del proveedor (opcional)" value={f.codigoProveedor} onChange={(e) => setF({ ...f, codigoProveedor: e.target.value })} ayuda="Con código, el sistema recuerda el producto para la próxima" />
        <div className="grid grid-cols-3 gap-3">
          <Campo etiqueta="Cajas" type="number" inputMode="numeric" min={0} value={f.bultos} onChange={(e) => setF({ ...f, bultos: e.target.value === '' ? '' : Number(e.target.value) })} />
          <Campo etiqueta="Unid. por caja" type="number" inputMode="numeric" min={1} value={f.unidadesPorBulto} onChange={(e) => setF({ ...f, unidadesPorBulto: e.target.value === '' ? '' : Number(e.target.value) })} />
          <Campo etiqueta="Sueltas" type="number" inputMode="numeric" min={0} value={f.sueltas} onChange={(e) => setF({ ...f, sueltas: e.target.value === '' ? '' : Number(e.target.value) })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <CampoMonto etiqueta="Neto (sin IVA, opcional)" valor={f.neto} onValor={(v) => setF({ ...f, neto: v })} />
          <CampoMonto etiqueta="Total de la línea (con impuestos)" valor={f.total} onValor={(v) => setF({ ...f, total: v })} />
        </div>
        <p className="text-chico text-lab2">
          Entran <span className="num font-semibold text-lab">{cantidad}</span> unidades
          {cantidad > 0 && total > 0 ? (
            <>
              {' '}
              a <span className="num font-semibold text-lab">{clp(Math.round(total / cantidad))}</span> cada una
            </>
          ) : null}
          .
        </p>
        {error ? <p className="text-chico text-peligro">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar} deshabilitado={enviando}>
            Cancelar
          </Boton>
          <Boton variante="principal" cargando={enviando} deshabilitado={!f.descripcion.trim() || cantidad <= 0} onClick={() => void guardar()}>
            Guardar
          </Boton>
        </div>
      </div>
    </Dialogo>
  );
}

export function CompraDetalle() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [compra, setCompra] = useState<CompraDetalleDatos | null>(null);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState<ReactNode>(null);
  const [vinculando, setVinculando] = useState<LineaCompra | null>(null);
  const [dialogoLinea, setDialogoLinea] = useState<{ abierto: boolean; inicial: FormLinea | null }>({ abierto: false, inicial: null });
  const [confirmarRecibir, setConfirmarRecibir] = useState(false);
  const [recibiendo, setRecibiendo] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [notaAnular, setNotaAnular] = useState('');
  const [enviandoAnular, setEnviandoAnular] = useState(false);

  const cargar = useCallback(() => {
    if (!id) return;
    api<CompraDetalleDatos>(`/compras/${id}`)
      .then(setCompra)
      .catch((e) => setError(mensajeError(e, { COMPRA_NO_ENCONTRADA: 'La compra no existe.' })));
  }, [id]);

  useEffect(() => {
    cargar();
    void api<{ ubicaciones: Ubicacion[] }>('/ubicaciones').then((r) => setUbicaciones(r.ubicaciones)).catch(() => {});
  }, [cargar]);

  if (error) return <Banner tono="peligro">{error}</Banner>;
  if (!compra) return <Cargando />;

  const borrador = compra.estado === 'borrador';
  const e = ETIQUETA_ESTADO_COMPRA[compra.estado];
  const sinVincular = compra.lineas.filter((l) => !l.productoId);
  const conProducto = compra.lineas.filter((l) => l.productoId);
  const unidades = conProducto.reduce((a, l) => a + l.cantidad, 0);

  const patchCompra = async (data: Record<string, unknown>) => {
    try {
      const c = await api<CompraDetalleDatos>(`/compras/${compra.id}`, { method: 'PATCH', body: JSON.stringify(data) });
      setCompra({ ...c, lineas: c.lineas.map((l) => ({ ...l, stockVigente: compra.lineas.find((x) => x.id === l.id)?.stockVigente ?? null })) });
      cargar();
    } catch (err) {
      setAviso(<Banner tono="peligro">{mensajeError(err, { COMPRA_DUPLICADA: 'Ese número ya está cargado para este proveedor.' })}</Banner>);
    }
  };

  const vincularLinea = async (linea: LineaCompra, r: { producto: ResultadoBusquedaProducto | null; unidadesPorBulto: number }) => {
    await api(`/compras/${compra.id}/lineas/${linea.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ productoId: r.producto?.id ?? null, unidadesPorBulto: r.unidadesPorBulto }),
    });
    setVinculando(null);
    cargar();
  };

  const guardarLinea = async (f: FormLinea) => {
    const cuerpo = {
      descripcion: f.descripcion.trim(),
      codigoProveedor: f.codigoProveedor.trim() || null,
      bultos: Number(f.bultos) || 0,
      unidadesPorBulto: Math.max(1, Number(f.unidadesPorBulto) || 1),
      sueltas: Number(f.sueltas) || 0,
      neto: Number(f.neto) || 0,
      total: Number(f.total) || 0,
      impuestos: Math.max(0, (Number(f.total) || 0) - (Number(f.neto) || 0)),
    };
    if (f.id) await api(`/compras/${compra.id}/lineas/${f.id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) });
    else await api(`/compras/${compra.id}/lineas`, { method: 'POST', body: JSON.stringify(cuerpo) });
    setDialogoLinea({ abierto: false, inicial: null });
    cargar();
  };

  const eliminarLinea = async (l: LineaVista) => {
    if (!window.confirm(`¿Quitar la línea «${l.descripcion}» del borrador?`)) return;
    try {
      await api(`/compras/${compra.id}/lineas/${l.clave}`, { method: 'DELETE' });
      cargar();
    } catch (err) {
      setAviso(<Banner tono="peligro">{mensajeError(err)}</Banner>);
    }
  };

  const recibir = async () => {
    setRecibiendo(true);
    try {
      const r = await api<{ movimientos: unknown[]; encendidos: string[]; omitidas: string[] }>(`/compras/${compra.id}/recibir`, {
        method: 'POST',
        body: JSON.stringify({ omitirSinVincular: sinVincular.length > 0 }),
      });
      setConfirmarRecibir(false);
      setAviso(
        <Banner tono="ok">
          Recibida: {unidades} unidades entraron a {compra.ubicacion.nombre} en {r.movimientos.length} movimiento(s)
          {r.encendidos.length ? ` · ${r.encendidos.length} producto(s) empiezan a controlar stock` : ''}
          {r.omitidas.length ? ` · ${r.omitidas.length} línea(s) sin producto quedaron fuera` : ''}.
        </Banner>,
      );
      cargar();
    } catch (err) {
      setConfirmarRecibir(false);
      setAviso(
        <Banner tono="peligro">
          {mensajeError(err, { SIN_LINEAS: 'Ninguna línea tiene producto: no hay nada que ingresar.', COMPRA_NO_EDITABLE: 'La compra ya no está en borrador.' })}
        </Banner>,
      );
    } finally {
      setRecibiendo(false);
    }
  };

  const anular = async () => {
    setEnviandoAnular(true);
    try {
      await api(`/compras/${compra.id}/anular`, { method: 'POST', body: JSON.stringify({ nota: notaAnular.trim() }) });
      setAnulando(false);
      cargar();
    } catch (err) {
      setAviso(<Banner tono="peligro">{mensajeError(err)}</Banner>);
      setAnulando(false);
    } finally {
      setEnviandoAnular(false);
    }
  };

  const objetivoVincular: ObjetivoVincular | null = vinculando
    ? {
        descripcion: vinculando.descripcion,
        codigoProveedor: vinculando.codigoProveedor,
        bultos: vinculando.bultos,
        sueltas: vinculando.sueltas,
        unidadesPorBulto: vinculando.unidadesPorBulto,
        productoActual: vinculando.producto ? { id: vinculando.producto.id, sku: vinculando.producto.sku, nombre: vinculando.producto.nombre, precioVenta: vinculando.producto.precioVenta } : null,
      }
    : null;

  return (
    <div>
      <Encabezado
        titulo={`${ETIQUETA_TIPO_DOC[compra.tipoDocumento]} ${compra.numeroDocumento}`}
        extra={
          <div className="flex items-center gap-3">
            <Insignia tono={e.tono}>{e.texto}</Insignia>
            <Link to="/admin/compras" className="text-chico text-lab2 underline">
              ← Compras
            </Link>
          </div>
        }
      />
      {aviso ? <div className="mb-3">{aviso}</div> : null}

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-tarjeta border border-sep bg-bg p-4 text-cuerpo">
          <div className="text-lab">{compra.proveedor.nombre}</div>
          {compra.proveedor.rut ? <div className="font-mono text-chico text-lab3">{compra.proveedor.rut}</div> : null}
          <div className="mt-2 text-chico text-lab2">
            {compra.origen === 'pdf' ? `Leída del PDF${compra.archivoNombre ? ` «${compra.archivoNombre}»` : ''}` : 'Digitada a mano'} por {compra.usuario.nombre} el {fecha(compra.creadoEn)}.
            {compra.recibidaEn && compra.recibidaPor ? ` Recibida por ${compra.recibidaPor.nombre} el ${fecha(compra.recibidaEn)}.` : ''}
          </div>
          {compra.nota ? <div className="mt-2 whitespace-pre-line text-chico text-lab2">{compra.nota}</div> : null}
        </div>
        <div className="rounded-tarjeta border border-sep bg-bg p-4">
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Fecha del documento" type="date" value={compra.fechaDocumento.slice(0, 10)} onChange={(ev) => void patchCompra({ fechaDocumento: ev.target.value })} disabled={!borrador} />
            <Selecto etiqueta="Entra a" valor={compra.ubicacion.id} onValor={(v) => void patchCompra({ ubicacionId: v })} opciones={(ubicaciones.length ? ubicaciones : [compra.ubicacion]).map((u) => ({ valor: u.id, etiqueta: u.nombre }))} />
          </div>
          {!borrador ? <p className="mt-1 text-chico text-lab3">Una compra {compra.estado} no se edita.</p> : null}
        </div>
      </div>

      {compra.advertencias?.length ? (
        <div className="mb-4 flex flex-col gap-2">
          {compra.advertencias.map((a, i) => (
            <Banner key={i} tono="alerta">
              {a}
            </Banner>
          ))}
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-cuerpo font-semibold text-lab">
          Líneas ({compra.lineas.length}){sinVincular.length ? <span className="ml-2 text-chico font-normal text-peligro">{sinVincular.length} sin vincular</span> : null}
        </h2>
        {borrador ? (
          <div className="w-[160px]">
            <Boton onClick={() => setDialogoLinea({ abierto: true, inicial: null })}>Agregar línea</Boton>
          </div>
        ) : null}
      </div>
      {compra.lineas.length === 0 ? (
        <Vacio mensaje="Sin líneas todavía." />
      ) : (
        <TablaLineas
          editable={borrador}
          lineas={compra.lineas.map((l) => ({ ...l, clave: l.id }))}
          onVincular={(l) => setVinculando(compra.lineas.find((x) => x.id === l.clave) ?? null)}
          onEditar={(l) => {
            const x = compra.lineas.find((y) => y.id === l.clave);
            if (x) setDialogoLinea({ abierto: true, inicial: { id: x.id, descripcion: x.descripcion, codigoProveedor: x.codigoProveedor ?? '', bultos: x.bultos, unidadesPorBulto: x.unidadesPorBulto, sueltas: x.sueltas, neto: x.neto, total: x.total } });
          }}
          onEliminar={(l) => void eliminarLinea(l)}
        />
      )}
      <div className="mt-3">
        <ResumenTotales neto={compra.neto} impuestos={compra.impuestos} total={compra.total} />
      </div>

      {borrador ? (
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <div className="w-[160px]">
            <Boton variante="peligro" onClick={() => setAnulando(true)}>
              Anular borrador
            </Boton>
          </div>
          <div className="w-[260px]">
            <Boton variante="principal" deshabilitado={conProducto.length === 0} motivoDeshabilitado={conProducto.length === 0 ? 'Vincula al menos una línea a un producto' : undefined} onClick={() => setConfirmarRecibir(true)}>
              Recibir mercadería
            </Boton>
          </div>
        </div>
      ) : null}

      <Dialogo abierto={confirmarRecibir} titulo="Recibir mercadería" onCerrar={() => setConfirmarRecibir(false)} cerrable={!recibiendo} ancho={520}>
        <div className="flex flex-col gap-3 text-cuerpo text-lab">
          <p>
            Entran <span className="num font-semibold">{unidades}</span> unidades a <strong>{compra.ubicacion.nombre}</strong> en {conProducto.length} línea(s). Se registra un movimiento de compra por línea y cada producto guarda su costo unitario. Los productos que no controlaban stock empiezan a controlarlo.
          </p>
          {sinVincular.length ? (
            <Banner tono="alerta">
              {sinVincular.length} línea(s) sin producto quedarán fuera del stock: {sinVincular.map((l) => l.descripcion).join(', ')}.
            </Banner>
          ) : null}
          <p className="text-chico text-lab2">Una compra recibida no se anula: si algo vino mal, se corrige con una merma o un ajuste.</p>
          <div className="flex justify-end gap-2">
            <Boton onClick={() => setConfirmarRecibir(false)} deshabilitado={recibiendo}>
              Cancelar
            </Boton>
            <Boton variante="principal" cargando={recibiendo} onClick={() => void recibir()}>
              Recibir
            </Boton>
          </div>
        </div>
      </Dialogo>

      <Dialogo abierto={anulando} titulo="Anular borrador" onCerrar={() => setAnulando(false)} cerrable={!enviandoAnular}>
        <div className="flex flex-col gap-3">
          <p className="text-cuerpo text-lab">El borrador queda anulado y no toca el stock.</p>
          <Campo etiqueta="Motivo (obligatorio)" value={notaAnular} onChange={(ev) => setNotaAnular(ev.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Boton onClick={() => setAnulando(false)} deshabilitado={enviandoAnular}>
              Cancelar
            </Boton>
            <Boton variante="peligro" cargando={enviandoAnular} deshabilitado={!notaAnular.trim()} onClick={() => void anular()}>
              Anular
            </Boton>
          </div>
        </div>
      </Dialogo>

      <DialogoVincular objetivo={objetivoVincular} onCerrar={() => setVinculando(null)} onElegir={(r) => vincularLinea(vinculando!, r)} />
      <DialogoLinea abierto={dialogoLinea.abierto} inicial={dialogoLinea.inicial} onCerrar={() => setDialogoLinea({ abierto: false, inicial: null })} onGuardar={guardarLinea} />
      {!borrador && compra.estado === 'recibida' ? (
        <p className="mt-4 text-chico text-lab3">
          El kardex de cada producto muestra el movimiento con referencia a esta compra. <button type="button" className="underline" onClick={() => navigate('/admin/stock')}>Ir a Stock</button>
        </p>
      ) : null}
    </div>
  );
}
