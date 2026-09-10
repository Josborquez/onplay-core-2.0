// V25/V26/V27 — Compras (11-SDD §8; rediseño 1c/1d/1e/1f, R-029).
// V25 lista con resumen del mes, pestañas de estado con conteos, tabla con menú «⋯» y proveedores plegados.
// V26 cargar factura como flujo por pasos (Archivo → Moneda → Proveedor y documento → Líneas → Confirmar)
//     con advertencias agrupadas y barra fija al pie con el resumen y la acción principal.
// V27 detalle con migas, tarjetas de cifras, columna «X → Y» de stock, pie fijo y diálogo «Recibir».
// Diálogo «Vincular a un producto» en dos pasos: Buscar / Crear → Unidades y precio (con margen).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorApi, api } from '../../api.js';
import { Banner, Boton, Campo, CampoMonto, Cargando, Dialogo, Insignia, PieDialogo, Segmentado, Vacio } from '../../components/base.js';
import { categorias, refrescarCatalogo } from '../../catalogo.js';
import { useConfirmar } from '../../components/Confirmar.js';
import { Icono } from '../../components/iconos.js';
import { MenuAcciones } from '../../components/MenuAcciones.js';
import { Pasos } from '../../components/Pasos.js';
import { Cifra, PieAcciones } from '../../components/PieAcciones.js';
import { CeldaDoble, Tabla, type Columna } from '../../components/Tabla.js';
import { useAvisos } from '../../components/Toast.js';
import { clp, fecha } from '../../utils/formato.js';
import type { TipoProducto } from '../../tipos.js';
import { TIPO_POR_RAIZ } from './AltaSnack.js';
import {
  ETIQUETA_TIPO_DOC,
  type CompraDetalle as CompraDetalleDatos,
  type CompraResumen,
  type EstadoCompra,
  type LectorFactura,
  type Lectura,
  type LineaCompra,
  type LineaPropuesta,
  type Moneda,
  type OpcionLector,
  type Proveedor,
  type ResultadoBusquedaProducto,
  type TipoDocumentoCompra,
} from '../../tiposCompras.js';
import { aplanarCategorias, CampoBuscar, Encabezado, Filtro, Filtros, Paginacion, SeccionPlegable, Selecto, TarjetaCifra, type OpcionCategoria } from './util.js';

/* =========================================================================================
 * Helpers
 * ========================================================================================= */

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

/** Margen sobre el precio de venta, en % (11-SDD §6.6). Null sin precio. */
function margenPct(precioVenta: number, costo: number): number | null {
  if (!(precioVenta > 0)) return null;
  return Math.round(((precioVenta - costo) / precioVenta) * 1000) / 10;
}

/** Precio que deja el margen pedido, redondeado hacia arriba a $10. */
function precioParaMargen(costo: number, margen: number): number {
  return Math.ceil(costo / (1 - margen / 100) / 10) * 10;
}

function usd(monto: number): string {
  return `US$ ${monto.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const hoyIso = () => new Date().toISOString().slice(0, 10);
const MARGENES_SUGERIDOS = [30, 40, 50];

/** Vocabulario de estados (rediseño 1c): Borrador neutro · Recibida ok · Con pendientes alerta · Anulada peligro. */
function InsigniaCompra({ estado, pendientes }: { estado: EstadoCompra; pendientes?: number }) {
  if (estado === 'recibida' && pendientes) return <Insignia tono="alerta">Con pendientes</Insignia>;
  if (estado === 'recibida') return <Insignia tono="ok">Recibida</Insignia>;
  if (estado === 'anulada') return <Insignia tono="peligro">Anulada</Insignia>;
  return <Insignia>Borrador</Insignia>;
}

function TextoMargen({ precioVenta, costo }: { precioVenta: number; costo: number }) {
  const m = margenPct(precioVenta, costo);
  if (m === null) return <span className="text-lab3">sin precio</span>;
  return (
    <span className={m < 0 ? 'font-semibold text-peligro' : ''}>
      margen <strong className="num font-semibold text-lab">{m} %</strong>
    </span>
  );
}

/* =========================================================================================
 * Proveedores
 * ========================================================================================= */

function DialogoProveedor({ abierto, inicial, lectores, onCerrar, onHecho }: { abierto: boolean; inicial: Partial<Proveedor> | null; lectores: OpcionLector[]; onCerrar: () => void; onHecho: (p: Proveedor) => void }) {
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [lector, setLector] = useState<LectorFactura>('manual');
  const [error, setError] = useState('');
  const [errorRut, setErrorRut] = useState('');
  const [enviando, setEnviando] = useState(false);
  const editando = !!inicial?.id;

  useEffect(() => {
    if (!abierto) return;
    setNombre(inicial?.nombre ?? '');
    setRut(inicial?.rut ?? '');
    setLector(inicial?.lector ?? 'manual');
    setError('');
    setErrorRut('');
  }, [abierto, inicial]);

  const guardar = async () => {
    setEnviando(true);
    setError('');
    setErrorRut('');
    try {
      const cuerpo = JSON.stringify({ nombre: nombre.trim(), rut: rut.trim() || null, lector });
      const p = editando ? await api<Proveedor>(`/proveedores/${inicial!.id}`, { method: 'PATCH', body: cuerpo }) : await api<Proveedor>('/proveedores', { method: 'POST', body: cuerpo });
      onHecho(p);
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'RUT_INVALIDO') {
        setErrorRut('El dígito verificador no cuadra. Revisa el RUT.');
        setError('1 campo por corregir');
      } else if (e instanceof ErrorApi && e.codigo === 'PROVEEDOR_DUPLICADO') {
        setErrorRut('Ya existe un proveedor con ese RUT.');
        setError('1 campo por corregir');
      } else {
        setError(mensajeError(e, { NOMBRE_REQUERIDO: 'Falta el nombre.' }));
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo abierto={abierto} titulo={editando ? 'Editar proveedor' : 'Nuevo proveedor'} onCerrar={onCerrar} cerrable={!enviando}>
      <div className="flex flex-col gap-3">
        <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus placeholder="Ej.: Embotelladora Andina S.A." />
        <Campo etiqueta="RUT (opcional)" value={rut} onChange={(e) => setRut(e.target.value)} placeholder="91.144.000-8" error={errorRut} ayuda="Con RUT, el sistema reconoce sus facturas solo." />
        <Selecto etiqueta="Cómo llegan sus documentos" valor={lector} onValor={(v) => setLector(v as LectorFactura)} opciones={lectores.map((l) => ({ valor: l.clave, etiqueta: l.nombre }))} />
        <PieDialogo error={error}>
          <Boton ajustado onClick={onCerrar} deshabilitado={enviando}>
            Cancelar
          </Boton>
          <Boton ajustado variante="principal" cargando={enviando} deshabilitado={!nombre.trim()} onClick={() => void guardar()}>
            {editando ? 'Guardar' : 'Crear proveedor'}
          </Boton>
        </PieDialogo>
      </div>
    </Dialogo>
  );
}

/* =========================================================================================
 * Vincular a un producto (1f): paso 1 Buscar / Crear · paso 2 Unidades y precio
 * ========================================================================================= */

interface ObjetivoVincular {
  indice: number;
  descripcion: string;
  codigoProveedor: string | null;
  bultos: number;
  sueltas: number;
  unidadesPorBulto: number;
  totalLinea: number;
  productoActual: ResultadoBusquedaProducto | null;
}

function DialogoVincular({ objetivo, onCerrar, onElegir }: { objetivo: ObjetivoVincular | null; onCerrar: () => void; onElegir: (r: { producto: ResultadoBusquedaProducto | null; unidadesPorBulto: number }) => void | Promise<void> }) {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [pestana, setPestana] = useState<'buscar' | 'crear'>('buscar');
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<ResultadoBusquedaProducto[]>([]);
  const [elegido, setElegido] = useState<ResultadoBusquedaProducto | null>(null);
  const [upb, setUpb] = useState<number | ''>(1);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  // Crear producto (paso 1, pestaña Crear): nombre, categoría, código; el precio se fija en el paso 2.
  const [opcionesCategoria, setOpcionesCategoria] = useState<OpcionCategoria[]>([]);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevaCategoria, setNuevaCategoria] = useState('');
  const [nuevoCodigo, setNuevoCodigo] = useState('');
  // Paso 2: precio de venta (nuevo producto) o cambio de precio (existente).
  const [precio, setPrecio] = useState<number | ''>('');

  useEffect(() => {
    if (!objetivo) return;
    setPaso(1);
    setPestana('buscar');
    setQ(objetivo.productoActual ? objetivo.productoActual.nombre : objetivo.descripcion.split(/\s+/).slice(0, 2).join(' '));
    setElegido(objetivo.productoActual);
    setUpb(objetivo.unidadesPorBulto);
    setResultados([]);
    setError('');
    setNuevoNombre(objetivo.descripcion);
    setNuevoCodigo('');
    setPrecio('');
  }, [objetivo]);

  useEffect(() => {
    if (pestana !== 'crear' || opcionesCategoria.length) return;
    void categorias().then((arbol) => {
      const opciones = aplanarCategorias(arbol);
      setOpcionesCategoria(opciones);
      const snacks = opciones.find((o) => o.raizSlug === 'snacks');
      if (snacks) setNuevaCategoria((actual) => actual || snacks.id);
    });
  }, [pestana, opcionesCategoria.length]);

  useEffect(() => {
    if (!objetivo || paso !== 1 || pestana !== 'buscar' || q.trim().length < 2) {
      setResultados([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ resultados: ResultadoBusquedaProducto[] }>(`/productos/buscar?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setResultados(r.resultados.slice(0, 8)))
        .catch(() => setResultados([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, objetivo, paso, pestana]);

  const unidades = objetivo ? calcularCantidad(objetivo.bultos, Number(upb) || 1, objetivo.sueltas) : 0;
  const costoUnitario = objetivo && unidades > 0 ? Math.round(objetivo.totalLinea / unidades) : 0;
  const creando = pestana === 'crear';
  const puedeSeguir = creando ? nuevoNombre.trim().length > 0 && !!nuevaCategoria : !!elegido;
  const precioVigente = precio === '' ? (elegido?.precioVenta ?? 0) : precio;

  const confirmar = async () => {
    setEnviando(true);
    setError('');
    try {
      let producto = elegido;
      if (creando) {
        const opcion = opcionesCategoria.find((o) => o.id === nuevaCategoria);
        if (!opcion || precio === '') {
          setError('Falta el precio de venta.');
          setEnviando(false);
          return;
        }
        const tipo: TipoProducto = TIPO_POR_RAIZ[opcion.raizSlug] ?? 'indeterminado';
        const creado = await api<ResultadoBusquedaProducto>('/productos', {
          method: 'POST',
          body: JSON.stringify({ nombre: nuevoNombre.trim(), tipo, categoriaId: opcion.id, precioVenta: precio, codigoBarras: nuevoCodigo.trim() || null }),
        });
        void refrescarCatalogo();
        producto = { id: creado.id, sku: creado.sku, nombre: creado.nombre, precioVenta: creado.precioVenta };
      } else if (producto && precio !== '' && precio !== producto.precioVenta) {
        await api(`/productos/${producto.id}`, { method: 'PATCH', body: JSON.stringify({ precioVenta: precio }) });
        producto = { ...producto, precioVenta: precio };
      }
      await onElegir({ producto, unidadesPorBulto: Math.max(1, Number(upb) || 1) });
    } catch (e) {
      setError(mensajeError(e, { PRODUCTO_SIN_STOCK: 'Un servicio no tiene stock.', COMPRA_NO_EDITABLE: 'La compra ya no se puede editar.', PRECIO_INVALIDO: 'El precio debe ser un entero ≥ 0.', LINEA_YA_RECIBIDA: 'Esa línea ya entró al stock.' }));
    } finally {
      setEnviando(false);
    }
  };

  const quitar = async () => {
    setEnviando(true);
    setError('');
    try {
      await onElegir({ producto: null, unidadesPorBulto: Math.max(1, Number(upb) || 1) });
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setEnviando(false);
    }
  };

  if (!objetivo) return null;
  const sobreTitulo = `Paso ${paso} de 2 · línea ${objetivo.indice + 1}`;
  const nombreElegido = creando ? nuevoNombre.trim() : (elegido?.nombre ?? '');

  return (
    <Dialogo
      abierto
      ancho={720}
      onCerrar={onCerrar}
      cerrable={!enviando}
      sobreTitulo={sobreTitulo}
      titulo={paso === 1 ? 'Vincular a un producto' : 'Unidades y precio'}
      subtitulo={
        paso === 1 ? (
          <span className="font-mono">
            {objetivo.descripcion} · {objetivo.bultos} × {clp(objetivo.bultos > 0 ? Math.round(objetivo.totalLinea / objetivo.bultos) : objetivo.totalLinea)}
          </span>
        ) : (
          <>
            {nombreElegido}
            {elegido && !creando ? <span className="text-lab3"> · {elegido.sku}</span> : creando ? <span className="text-lab3"> · producto nuevo</span> : null}
          </>
        )
      }
    >
      {paso === 1 ? (
        <div className="flex flex-col gap-4">
          <Segmentado<'buscar' | 'crear'>
            fijo
            valor={pestana}
            onChange={(v) => setPestana(v ?? 'buscar')}
            opciones={[
              { valor: 'buscar', etiqueta: 'Buscar en el maestro' },
              { valor: 'crear', etiqueta: 'Crear producto' },
            ]}
          />
          {!creando ? (
            <>
              <CampoBuscar id="vincular-buscar" etiqueta="Producto del maestro" valor={q} onValor={setQ} placeholder="SKU, nombre o código de barras" />
              {resultados.length > 0 ? (
                <div role="listbox" className="flex flex-col overflow-hidden rounded-tarjeta border border-sep">
                  {resultados.map((r) => {
                    const activo = elegido?.id === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="option"
                        aria-selected={activo}
                        onClick={() => setElegido(r)}
                        className={`grid min-h-fila grid-cols-[minmax(0,1fr)_110px_24px] items-center gap-4 border-t border-sep px-4 py-2 text-left first:border-t-0 ${activo ? 'bg-ac-suave' : ''}`}
                      >
                        <span className="flex min-w-0 flex-col gap-[2px]">
                          <span className={`truncate ${activo ? 'font-semibold' : ''} text-lab`}>{r.nombre}</span>
                          <span className="truncate font-mono text-chico text-lab3">{r.sku}</span>
                        </span>
                        <span className="num text-right text-chico text-lab2">{clp(r.precioVenta)}</span>
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full ${activo ? 'bg-ac text-sobre-ac' : ''}`}>{activo ? <Icono nombre="check" tamano={12} trazo={3} /> : null}</span>
                      </button>
                    );
                  })}
                </div>
              ) : q.trim().length >= 2 ? (
                <p className="text-chico text-lab3">Sin resultados.</p>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <Campo etiqueta="Nombre" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} autoFocus ayuda="Como se verá en el mostrador; puedes acortar lo que dice la factura" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Selecto etiqueta="Categoría" valor={nuevaCategoria} onValor={setNuevaCategoria} opciones={opcionesCategoria.map((o) => ({ valor: o.id, etiqueta: o.etiqueta }))} vacia={opcionesCategoria.length ? '—' : 'Cargando…'} />
                <Campo etiqueta="Código de barras (opcional)" value={nuevoCodigo} onChange={(e) => setNuevoCodigo(e.target.value)} inputMode="numeric" />
              </div>
              <p className="text-chico text-lab3">Se crea con SKU automático y sin stock; al recibir esta compra entra la cantidad y empieza a controlar stock. El precio de venta se fija en el paso 2.</p>
            </div>
          )}
          <PieDialogo error={error}>
            {!creando ? (
              <span className="mr-2 text-chico text-lab3">
                ¿No está?{' '}
                <button type="button" className="font-semibold text-lab2 underline" onClick={() => setPestana('crear')}>
                  Crear producto
                </button>
              </span>
            ) : null}
            {objetivo.productoActual ? (
              <Boton ajustado variante="peligro" deshabilitado={enviando} onClick={() => void quitar()}>
                Quitar vínculo
              </Boton>
            ) : null}
            <Boton ajustado onClick={onCerrar} deshabilitado={enviando}>
              Cancelar
            </Boton>
            <Boton ajustado variante="principal" deshabilitado={!puedeSeguir} onClick={() => setPaso(2)}>
              Siguiente · unidades y precio
            </Boton>
          </PieDialogo>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[200px_1fr]">
            <Campo etiqueta="Unidades por bulto" type="number" inputMode="numeric" min={1} value={upb} onChange={(e) => setUpb(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))} autoFocus />
            <div className="flex min-h-tactil flex-col justify-center rounded-campo bg-bg2 px-4 py-2 text-chico text-lab2">
              <span>
                {objetivo.bultos} bulto{objetivo.bultos === 1 ? '' : 's'} × {Number(upb) || 1}
                {objetivo.sueltas ? ` + ${objetivo.sueltas} sueltas` : ''} = <strong className="num font-semibold text-lab">{unidades} unidades</strong> · costo{' '}
                <strong className="num font-semibold text-lab">{clp(costoUnitario)}</strong> por unidad
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-tarjeta border border-sep p-4">
              <span className="text-rot font-semibold uppercase tracking-[.06em] text-lab3">{creando ? 'Precio de venta' : 'Precio de venta actual'}</span>
              <span className="num text-[26px] font-semibold leading-tight text-lab">{clp(precioVigente)}</span>
              <span className="text-chico text-lab2">
                <TextoMargen precioVenta={precioVigente} costo={costoUnitario} /> con este costo
              </span>
            </div>
            <div className="flex flex-col gap-2 rounded-tarjeta border border-sep p-4">
              <span className="text-rot font-semibold uppercase tracking-[.06em] text-lab3">{creando ? 'Fijar precio de venta' : 'Cambiar precio de venta'}</span>
              <CampoMonto etiqueta={creando ? 'Precio' : 'Nuevo precio (opcional)'} valor={precio} onValor={setPrecio} />
              {costoUnitario > 0 ? (
                <div className="flex flex-wrap gap-[6px]">
                  {MARGENES_SUGERIDOS.map((m) => {
                    const p = precioParaMargen(costoUnitario, m);
                    const activo = precio === p;
                    return (
                      <button key={m} type="button" onClick={() => setPrecio(p)} className={`flex h-[36px] items-center gap-[6px] rounded-full border px-3 text-chico ${activo ? 'border-ac bg-ac-suave font-semibold text-lab' : 'border-sep text-lab2'}`}>
                        {m} %<span className={`num ${activo ? 'font-normal text-lab2' : 'text-lab3'}`}>{clp(p)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
          <PieDialogo error={error}>
            <Boton ajustado variante="fantasma" onClick={() => setPaso(1)} deshabilitado={enviando}>
              Atrás
            </Boton>
            <Boton ajustado onClick={onCerrar} deshabilitado={enviando}>
              Cancelar
            </Boton>
            <Boton ajustado variante="principal" cargando={enviando} deshabilitado={creando && precio === ''} motivoDeshabilitado={creando && precio === '' ? 'Falta el precio de venta' : undefined} onClick={() => void confirmar()}>
              {creando ? 'Crear y vincular' : 'Vincular'} · {unidades} u{precioVigente > 0 ? ` a ${clp(precioVigente)}` : ''}
            </Boton>
          </PieDialogo>
        </div>
      )}
    </Dialogo>
  );
}

/* =========================================================================================
 * Línea a mano
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

const FORM_LINEA_VACIO: FormLinea = { descripcion: '', codigoProveedor: '', bultos: 0, unidadesPorBulto: 1, sueltas: 0, neto: '', total: '' };

function DialogoLinea({ abierto, inicial, onCerrar, onGuardar }: { abierto: boolean; inicial: FormLinea | null; onCerrar: () => void; onGuardar: (f: FormLinea) => Promise<void> }) {
  const [f, setF] = useState<FormLinea>(FORM_LINEA_VACIO);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setF(inicial ?? FORM_LINEA_VACIO);
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <PieDialogo error={error}>
          <Boton ajustado onClick={onCerrar} deshabilitado={enviando}>
            Cancelar
          </Boton>
          <Boton ajustado variante="principal" cargando={enviando} deshabilitado={!f.descripcion.trim() || cantidad <= 0} onClick={() => void guardar()}>
            Guardar
          </Boton>
        </PieDialogo>
      </div>
    </Dialogo>
  );
}

/* =========================================================================================
 * Tabla de líneas (propuesta y detalle comparten la forma)
 * ========================================================================================= */

interface LineaVista {
  clave: string;
  orden: number;
  codigoProveedor: string | null;
  descripcion: string;
  bultos: number;
  unidadesPorBulto: number;
  sueltas: number;
  cantidad: number;
  total: number;
  costoUnitario: number;
  totalOriginal?: number | null;
  producto: { sku: string; nombre: string; costoReferencia?: number | null; precioVenta?: number } | null;
  aprendida?: boolean;
  stockVigente?: number | null;
  movimientoId?: string | null;
}

function TablaLineas({
  lineas,
  moneda = 'CLP',
  modo,
  cargando,
  onVincular,
  onEditar,
  onEliminar,
}: {
  lineas: LineaVista[];
  moneda?: Moneda;
  /** `propuesta`: columna «Producto en el sistema» · `detalle`: columnas «Stock» y «Origen en la factura». */
  modo: 'propuesta' | 'detalle';
  cargando?: boolean;
  onVincular?: (l: LineaVista) => void;
  onEditar?: (l: LineaVista) => void;
  onEliminar?: (l: LineaVista) => void;
}) {
  const celdaProducto = (l: LineaVista) => {
    if (!l.producto) {
      return onVincular && !l.movimientoId ? (
        <span className="flex flex-wrap items-center gap-3">
          <Boton ajustado onClick={() => onVincular(l)}>
            Vincular
          </Boton>
          <span className="text-chico text-lab3">Sin producto todavía</span>
        </span>
      ) : (
        <Insignia tono="alerta">Sin vincular</Insignia>
      );
    }
    const detalle = [`${l.cantidad} u`, `${clp(l.costoUnitario)}/u`];
    if (l.producto.precioVenta !== undefined) {
      const m = margenPct(l.producto.precioVenta, l.costoUnitario);
      detalle.push(m === null ? 'sin precio' : `margen ${m} %`);
    }
    return <CeldaDoble principal={l.producto.nombre} secundaria={`${detalle.join(' · ')}${l.aprendida ? ' · recordado' : ''}`} mono={false} />;
  };

  const columnaNumero: Columna<LineaVista> = { clave: 'n', titulo: '#', ancho: '36px', prioridad: 3, enTarjeta: 'oculto', render: (l) => <span className="num text-lab3">{l.orden}</span> };
  const columnaCantidad: Columna<LineaVista> = {
    clave: 'cant',
    titulo: 'Cant.',
    ancho: '72px',
    alinear: 'derecha',
    enTarjeta: 'cifra',
    render: (l) => (
      <span className="num text-lab">
        {l.cantidad}
        {l.unidadesPorBulto > 1 ? (
          <span className="block text-chico text-lab3">
            {l.bultos} × {l.unidadesPorBulto}
          </span>
        ) : null}
      </span>
    ),
  };

  const columnas: Columna<LineaVista>[] =
    modo === 'propuesta'
      ? [
          columnaNumero,
          { clave: 'doc', titulo: 'Descripción en la factura', ancho: 'minmax(0,1.5fr)', render: (l) => <span className="block truncate font-mono text-chico text-lab">{l.descripcion}</span> },
          columnaCantidad,
          {
            clave: 'total',
            titulo: moneda === 'CLP' ? 'Total' : 'Total (CLP)',
            ancho: '120px',
            alinear: 'derecha',
            enTarjeta: 'cifra',
            render: (l) => (
              <span className="num text-lab">
                {clp(l.total)}
                {moneda !== 'CLP' && l.totalOriginal != null ? <span className="block text-chico text-lab3">{usd(l.totalOriginal)}</span> : null}
              </span>
            ),
          },
          { clave: 'sistema', titulo: 'Producto en el sistema', ancho: 'minmax(0,1.3fr)', render: celdaProducto },
        ]
      : [
          columnaNumero,
          { clave: 'producto', titulo: 'Producto', ancho: 'minmax(0,1.6fr)', render: (l) => (l.producto ? <CeldaDoble principal={l.producto.nombre} secundaria={l.producto.sku} /> : celdaProducto(l)) },
          columnaCantidad,
          {
            clave: 'costo',
            titulo: 'Costo/u',
            ancho: '110px',
            alinear: 'derecha',
            enTarjeta: 'cifra',
            render: (l) => (
              <span className="num text-lab">
                {clp(l.costoUnitario)}
                {l.producto?.precioVenta !== undefined ? (
                  <span className="block text-chico text-lab3">
                    <TextoMargen precioVenta={l.producto.precioVenta} costo={l.costoUnitario} />
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            clave: 'stock',
            titulo: 'Stock',
            ancho: '140px',
            alinear: 'derecha',
            enTarjeta: 'cifra',
            render: (l) =>
              l.movimientoId ? (
                <span className="text-chico text-lab3">recibida</span>
              ) : l.producto && l.stockVigente !== undefined && l.stockVigente !== null ? (
                <span className="num">
                  <span className="text-lab3">{l.stockVigente}</span> → <strong className="font-semibold text-lab">{l.stockVigente + l.cantidad}</strong>
                </span>
              ) : (
                <span className="text-lab3">—</span>
              ),
          },
          {
            clave: 'origen',
            titulo: 'Origen en la factura',
            ancho: 'minmax(0,1fr)',
            prioridad: 2,
            enTarjeta: 'oculto',
            render: (l) => (
              <span className="block truncate font-mono text-chico text-lab3">
                {l.descripcion}
                {l.codigoProveedor ? ` · ${l.codigoProveedor}` : ''}
              </span>
            ),
          },
        ];

  const menu =
    onVincular || onEditar || onEliminar
      ? (l: LineaVista) => [
          ...(onVincular && !l.movimientoId ? [{ etiqueta: l.producto ? 'Cambiar producto' : 'Vincular a un producto', onClick: () => onVincular(l) }] : []),
          ...(onEditar && !l.movimientoId ? [{ etiqueta: 'Editar cantidades y montos', onClick: () => onEditar(l) }] : []),
          ...(onEliminar && !l.movimientoId ? [{ etiqueta: 'Quitar línea', onClick: () => onEliminar(l), tono: 'peligro' as const, separadorAntes: true }] : []),
        ]
      : undefined;

  return <Tabla columnas={columnas} filas={lineas} clave={(l) => l.clave} menu={menu} cargando={cargando} vacio={<Vacio mensaje="Sin líneas todavía." />} />;
}

/** Advertencias del lector agrupadas con conteo (rediseño 1d): muestra 2 y «Ver las N». */
function Advertencias({ lista }: { lista: string[] }) {
  const [todas, setTodas] = useState(false);
  if (lista.length === 0) return null;
  const visibles = todas ? lista : lista.slice(0, 2);
  return (
    <div className="rounded-tarjeta border border-sep bg-bg shadow-tarjeta">
      <div className="flex min-h-[48px] flex-wrap items-center gap-3 px-4">
        <Icono nombre="alerta" tamano={18} trazo={1.8} clase="text-alerta" />
        <span className="font-semibold text-lab">
          {lista.length} advertencia{lista.length === 1 ? '' : 's'} del lector
        </span>
        <span className="text-chico text-lab3">no impiden guardar</span>
        {lista.length > 2 ? (
          <button type="button" onClick={() => setTodas((v) => !v)} aria-expanded={todas} className="ml-auto h-9 px-3 text-chico text-lab2">
            {todas ? 'Ver menos' : `Ver las ${lista.length}`}
          </button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-[6px] px-4 pb-3 pl-[44px] text-chico text-lab2">
        {visibles.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>
    </div>
  );
}

/* =========================================================================================
 * V25 — Lista de compras + proveedores
 * ========================================================================================= */

type FiltroCompras = 'todas' | 'borrador' | 'pendientes' | 'recibida' | 'anulada';

type CompraFila = CompraResumen & { pendientes: number; moneda?: Moneda; tipoCambio?: number | null };

interface RespuestaCompras {
  total: number;
  pagina: number;
  porPagina: number;
  conteos: { borrador: number; recibida: number; anulada: number; conPendientes: number };
  mes: { compras: number; total: number };
  compras: CompraFila[];
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function Compras() {
  const navegar = useNavigate();
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState<RespuestaCompras | null>(null);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<FiltroCompras>('todas');
  const [proveedorId, setProveedorId] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [lectores, setLectores] = useState<OpcionLector[]>([]);
  const [proveedoresAbiertos, setProveedoresAbiertos] = useState(false);
  const [dialogoProveedor, setDialogoProveedor] = useState<{ abierto: boolean; inicial: Partial<Proveedor> | null }>({ abierto: false, inicial: null });

  const cargarProveedores = useCallback(() => {
    api<{ proveedores: Proveedor[]; lectores: OpcionLector[] }>('/proveedores')
      .then((r) => {
        setProveedores(r.proveedores);
        setLectores(r.lectores);
      })
      .catch(() => {});
  }, []);

  useEffect(() => setPagina(1), [filtro, proveedorId, q]);

  const cargar = useCallback(() => {
    const p = new URLSearchParams({ pagina: String(pagina) });
    if (filtro === 'pendientes') p.set('pendientes', 'true');
    else if (filtro !== 'todas') p.set('estado', filtro);
    if (proveedorId) p.set('proveedorId', proveedorId);
    if (q.trim().length >= 2) p.set('q', q.trim());
    setCargando(true);
    const t = setTimeout(() => {
      api<RespuestaCompras>(`/compras?${p.toString()}`)
        .then(setDatos)
        .catch(() => avisar({ tono: 'error', titulo: 'No se pudieron cargar las compras.', detalle: 'Revisa la conexión y vuelve a intentar.' }))
        .finally(() => setCargando(false));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, proveedorId, q, pagina]);
  useEffect(cargar, [cargar]);
  useEffect(cargarProveedores, [cargarProveedores]);

  const ahora = new Date();
  const subtitulo = datos ? `${MESES[ahora.getMonth()]} ${ahora.getFullYear()} · ${datos.mes.compras} compra${datos.mes.compras === 1 ? '' : 's'} · ${clp(datos.mes.total)} recibidos` : undefined;

  const columnas: Columna<CompraFila>[] = [
    {
      clave: 'proveedor',
      titulo: 'Proveedor · documento',
      ancho: 'minmax(0,1.4fr)',
      render: (c) => (
        <CeldaDoble
          principal={
            <button type="button" onClick={() => navegar(`/admin/compras/${c.id}`)} className="truncate text-left font-semibold text-lab underline-offset-2 hover:underline">
              {c.proveedor.nombre}
            </button>
          }
          secundaria={`${ETIQUETA_TIPO_DOC[c.tipoDocumento]} ${c.numeroDocumento} · ${c.moneda ?? 'CLP'}${c.moneda && c.moneda !== 'CLP' && c.tipoCambio ? ` · TC ${clp(Math.round(c.tipoCambio))}` : ''}`}
        />
      ),
    },
    { clave: 'fecha', titulo: 'Fecha', ancho: '110px', prioridad: 2, enTarjeta: 'cifra', render: (c) => <span className="num text-lab2">{fecha(c.fechaDocumento)}</span> },
    { clave: 'lineas', titulo: 'Líneas', ancho: '80px', alinear: 'derecha', prioridad: 3, enTarjeta: 'cifra', render: (c) => <span className="num">{c.totalLineas}</span> },
    { clave: 'sin', titulo: 'Sin vincular', ancho: '110px', alinear: 'derecha', prioridad: 3, enTarjeta: 'cifra', render: (c) => (c.sinVincular ? <span className="num font-semibold">{c.sinVincular}</span> : <span className="text-lab3">—</span>) },
    { clave: 'unidades', titulo: 'Unidades', ancho: '96px', alinear: 'derecha', prioridad: 3, enTarjeta: 'cifra', render: (c) => <span className="num">{c.unidades}</span> },
    { clave: 'total', titulo: 'Total', ancho: '120px', alinear: 'derecha', enTarjeta: 'cifra', render: (c) => <span className={`num font-semibold ${c.estado === 'anulada' ? 'line-through' : ''}`}>{clp(c.total)}</span> },
    { clave: 'estado', titulo: 'Estado', ancho: '130px', enTarjeta: 'titulo', render: (c) => <InsigniaCompra estado={c.estado} pendientes={c.pendientes} /> },
  ];

  return (
    <div className="p-4 sm:px-8 sm:py-6">
      <Encabezado
        titulo="Compras"
        subtitulo={subtitulo}
        acciones={
          <>
            <Boton ajustado onClick={() => navegar('/admin/compras/nueva?modo=manual')}>
              Digitar a mano
            </Boton>
            <Boton ajustado variante="principal" icono="plus" onClick={() => navegar('/admin/compras/nueva')}>
              Cargar factura
            </Boton>
            <MenuAcciones
              variante="cabecera"
              items={[
                { etiqueta: 'Nuevo proveedor', onClick: () => setDialogoProveedor({ abierto: true, inicial: null }) },
                { etiqueta: proveedoresAbiertos ? 'Ocultar proveedores' : 'Ver proveedores', onClick: () => setProveedoresAbiertos((v) => !v) },
              ]}
            />
          </>
        }
      />

      <Filtros>
        <Segmentado<FiltroCompras>
          fijo
          valor={filtro}
          onChange={(v) => setFiltro(v ?? 'todas')}
          opciones={[
            { valor: 'todas', etiqueta: 'Todas' },
            { valor: 'borrador', etiqueta: 'Borradores', conteo: datos?.conteos.borrador },
            { valor: 'pendientes', etiqueta: 'Con pendientes', conteo: datos?.conteos.conPendientes },
            { valor: 'recibida', etiqueta: 'Recibidas' },
            { valor: 'anulada', etiqueta: 'Anuladas' },
          ]}
        />
        <Filtro ancho="0 1 200px">
          <Selecto etiqueta="Proveedor" valor={proveedorId} onValor={setProveedorId} opciones={proveedores.map((p) => ({ valor: p.id, etiqueta: p.nombre }))} vacia="Todos" />
        </Filtro>
        <Filtro ancho="1 1 220px" minimo={200}>
          <CampoBuscar id="buscar-compras" valor={q} onValor={setQ} placeholder="N° de documento o proveedor" />
        </Filtro>
      </Filtros>

      <Tabla
        columnas={columnas}
        filas={datos?.compras ?? []}
        clave={(c) => c.id}
        cargando={cargando}
        atenuada={(c) => c.estado === 'anulada'}
        resumen={
          datos ? (
            <>
              <strong className="num font-semibold text-lab">{datos.total}</strong> compra{datos.total === 1 ? '' : 's'}
              {filtro === 'pendientes' ? ' con líneas pendientes' : filtro !== 'todas' ? ` · ${filtro === 'borrador' ? 'borradores' : filtro === 'recibida' ? 'recibidas' : 'anuladas'}` : ''}
            </>
          ) : (
            'Cargando…'
          )
        }
        vacio={
          <Vacio
            mensaje={filtro === 'todas' && !q && !proveedorId ? 'Todavía no hay compras cargadas.' : 'Ninguna compra calza con el filtro.'}
            accion={
              filtro === 'todas' && !q && !proveedorId ? (
                <Boton ajustado variante="principal" onClick={() => navegar('/admin/compras/nueva')}>
                  Cargar la primera factura
                </Boton>
              ) : undefined
            }
          />
        }
        menu={(c) => [
          { etiqueta: 'Abrir', onClick: () => navegar(`/admin/compras/${c.id}`) },
          ...(c.estado === 'borrador' ? [{ etiqueta: 'Recibir…', onClick: () => navegar(`/admin/compras/${c.id}?recibir=1`) }] : []),
          ...(c.estado === 'recibida' && c.pendientes ? [{ etiqueta: 'Vincular pendientes', onClick: () => navegar(`/admin/compras/${c.id}`) }] : []),
        ]}
        pie={datos && datos.total > datos.porPagina ? <Paginacion pagina={datos.pagina} porPagina={datos.porPagina} total={datos.total} onPagina={setPagina} sustantivo="compras" /> : undefined}
      />

      <div className="mt-4">
        <SeccionPlegable
          titulo="Proveedores"
          resumen={proveedores.length ? `${proveedores.length} · ${proveedores.slice(0, 4).map((p) => p.nombre.split(' ')[0]).join(', ')}${proveedores.length > 4 ? '…' : ''}` : 'ninguno todavía'}
          accion={
            <Boton ajustado onClick={() => setDialogoProveedor({ abierto: true, inicial: null })}>
              Nuevo proveedor
            </Boton>
          }
          abierta={proveedoresAbiertos}
          onToggle={() => setProveedoresAbiertos((v) => !v)}
        >
          <p className="mb-3 text-chico text-lab2">Cada distribuidor manda su documento distinto. Con el RUT cargado, el sistema reconoce sus PDF y usa el lector que corresponde; los que no tienen lector se digitan a mano.</p>
          {proveedores.length ? (
            <Tabla<Proveedor>
              columnas={[
                {
                  clave: 'nombre',
                  titulo: 'Proveedor',
                  render: (p) => (
                    <CeldaDoble
                      principal={
                        <>
                          {p.nombre}
                          {!p.activo ? <span className="text-chico text-lab3"> · inactivo</span> : null}
                        </>
                      }
                      secundaria={p.rut ?? 'sin RUT'}
                    />
                  ),
                },
                { clave: 'lector', titulo: 'Documentos', prioridad: 2, enTarjeta: 'cifra', render: (p) => <span className="text-lab2">{lectores.find((l) => l.clave === p.lector)?.nombre ?? p.lector}</span> },
                { clave: 'compras', titulo: 'Compras', ancho: '90px', alinear: 'derecha', prioridad: 3, enTarjeta: 'cifra', render: (p) => <span className="num">{p.compras ?? 0}</span> },
                { clave: 'rec', titulo: 'Recordados', ancho: '110px', alinear: 'derecha', prioridad: 3, enTarjeta: 'cifra', render: (p) => <span className="num">{p.productosVinculados ?? 0}</span> },
              ]}
              filas={proveedores}
              clave={(p) => p.id}
              menu={(p) => [{ etiqueta: 'Editar', onClick: () => setDialogoProveedor({ abierto: true, inicial: p }) }]}
            />
          ) : null}
        </SeccionPlegable>
      </div>

      <DialogoProveedor
        abierto={dialogoProveedor.abierto}
        inicial={dialogoProveedor.inicial}
        lectores={lectores}
        onCerrar={() => setDialogoProveedor({ abierto: false, inicial: null })}
        onHecho={(p) => {
          setDialogoProveedor({ abierto: false, inicial: null });
          avisar({ tono: 'ok', titulo: 'Proveedor guardado.', detalle: p.nombre });
          cargarProveedores();
        }}
      />
    </div>
  );
}

/* =========================================================================================
 * V26 — Cargar factura por pasos
 * ========================================================================================= */

function leerComoBase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(',')[1] ?? '');
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(archivo);
  });
}

const PASOS = ['Archivo', 'Moneda', 'Proveedor', 'Líneas', 'Confirmar'];

export function CompraNueva() {
  const navegar = useNavigate();
  const { avisar } = useAvisos();
  const manualInicial = new URLSearchParams(window.location.search).get('modo') === 'manual';
  const [paso, setPaso] = useState(manualInicial ? 2 : 0);
  const [modoManual, setModoManual] = useState(manualInicial);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [lectores, setLectores] = useState<OpcionLector[]>([]);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [errorLectura, setErrorLectura] = useState<{ mensaje: string; muestra?: string[] } | null>(null);
  const [archivo, setArchivo] = useState<{ base64: string; nombre: string } | null>(null);
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [lineas, setLineas] = useState<LineaPropuesta[]>([]);
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [numero, setNumero] = useState('');
  const [fechaDoc, setFechaDoc] = useState(hoyIso());
  const [tipoDoc, setTipoDoc] = useState<TipoDocumentoCompra>('factura');
  const [ubicacionId, setUbicacionId] = useState('');
  const [tipoCambio, setTipoCambio] = useState('');
  const [gastosExtra, setGastosExtra] = useState<number | ''>('');
  const [releyendo, setReleyendo] = useState(false);
  const [vinculando, setVinculando] = useState<number | null>(null);
  const [dialogoProveedor, setDialogoProveedor] = useState<Partial<Proveedor> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState('');

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

  const aplicarLectura = (r: Lectura) => {
    setLectura(r);
    setLineas(r.lineas);
    setProveedor(r.proveedor);
    setNumero(r.numeroDocumento ?? '');
    setFechaDoc(r.fechaDocumento ?? hoyIso());
    setTipoDoc(r.tipoDocumento);
  };

  const alElegirArchivo = async (archivoElegido: File | undefined) => {
    if (!archivoElegido) return;
    setLeyendo(true);
    setErrorLectura(null);
    setLectura(null);
    setLineas([]);
    setTipoCambio('');
    setGastosExtra('');
    try {
      const base64 = await leerComoBase64(archivoElegido);
      setArchivo({ base64, nombre: archivoElegido.name });
      const r = await api<Lectura>('/compras/leer', { method: 'POST', body: JSON.stringify({ archivo: base64, nombre: archivoElegido.name }) });
      aplicarLectura(r);
      setModoManual(false);
      setPaso(1);
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'LECTOR_NO_DISPONIBLE') {
        setErrorLectura({
          mensaje: 'Ningún lector entiende este documento todavía. Puedes digitarlo a mano; para que el sistema lo lea solo hay que agregar un lector para este distribuidor.',
          muestra: Array.isArray(e.cuerpo.muestra) ? (e.cuerpo.muestra as string[]) : undefined,
        });
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

  const releerConMoneda = async () => {
    if (!archivo) return;
    setReleyendo(true);
    setErrorLectura(null);
    try {
      const r = await api<Lectura>('/compras/leer', {
        method: 'POST',
        body: JSON.stringify({ archivo: archivo.base64, nombre: archivo.nombre, tipoCambio: Number(tipoCambio.replace(',', '.')), gastosExtra: Number(gastosExtra) || 0 }),
      });
      const previas = new Map(lineas.map((l) => [l.orden, l]));
      aplicarLectura({
        ...r,
        lineas: r.lineas.map((l) => {
          const prev = previas.get(l.orden);
          if (!prev || (!prev.productoId && prev.unidadesPorBulto === l.unidadesPorBulto)) return l;
          const cantidad = calcularCantidad(l.bultos, prev.unidadesPorBulto, l.sueltas);
          return { ...l, unidadesPorBulto: prev.unidadesPorBulto, cantidad, costoUnitario: Math.round(l.total / cantidad), productoId: prev.productoId, producto: prev.producto, aprendida: prev.aprendida };
        }),
      });
      avisar({ tono: 'ok', titulo: 'Costos calculados en pesos.', detalle: `${Number(tipoCambio.replace(',', '.')).toLocaleString('es-CL')} CLP por ${r.moneda}${Number(gastosExtra) ? ` y ${clp(Number(gastosExtra))} de gastos` : ''}.` });
    } catch (e) {
      setErrorLectura({ mensaje: mensajeError(e) });
    } finally {
      setReleyendo(false);
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
  const unidades = lineas.filter((l) => l.productoId).reduce((a, l) => a + l.cantidad, 0);
  const moneda: Moneda = lectura?.moneda ?? 'CLP';
  const requiereTipoCambio = !!lectura?.requiereTipoCambio;

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
          moneda,
          tipoCambio: lectura?.tipoCambio ?? null,
          gastosExtra: lectura?.gastosExtra ?? 0,
          totalOriginal: lectura?.totalOriginal ?? null,
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
            totalOriginal: l.totalOriginal ?? null,
            productoId: l.productoId,
          })),
        }),
      });
      avisar({ tono: 'ok', titulo: 'Borrador guardado.', detalle: lectura ? `${lineas.length} líneas${sinVincular ? ` · ${sinVincular} sin vincular` : ''}.` : 'Agrega las líneas y recibe cuando esté completo.' });
      navegar(`/admin/compras/${c.id}`);
    } catch (e) {
      setErrorGuardar(
        mensajeError(e, {
          COMPRA_DUPLICADA: 'Ese documento ya está cargado para este proveedor.',
          NUMERO_REQUERIDO: 'Falta el número del documento.',
          FECHA_INVALIDA: 'La fecha no es válida.',
          TIPO_CAMBIO_REQUERIDO: 'Falta el tipo de cambio del documento.',
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
      indice: vinculando,
      descripcion: l.descripcion,
      codigoProveedor: l.codigoProveedor,
      bultos: l.bultos,
      sueltas: l.sueltas,
      unidadesPorBulto: l.unidadesPorBulto,
      totalLinea: l.total,
      productoActual: l.producto ? { id: l.producto.id, sku: l.producto.sku, nombre: l.producto.nombre, precioVenta: l.producto.precioVenta } : null,
    };
  }, [vinculando, lineas]);

  // Validez de cada paso (para «Siguiente» y para los detalles del stepper).
  const pasoValido = [!!lectura || modoManual, moneda === 'CLP' || !requiereTipoCambio, !!proveedor && numero.trim().length > 0 && !!ubicacionId, true, true];
  const detalles: (string | undefined)[] = [
    lectura ? (lectura.archivoNombre ?? 'PDF') : modoManual ? 'a mano' : undefined,
    lectura ? (moneda === 'CLP' ? 'CLP' : lectura.tipoCambio ? `${moneda} × ${lectura.tipoCambio.toLocaleString('es-CL')}` : moneda) : modoManual && paso > 1 ? 'CLP' : undefined,
    proveedor ? `${proveedor.nombre.split(' ')[0]}${numero ? ` · ${numero}` : ''}` : undefined,
    lectura ? (sinVincular ? `${sinVincular} sin vincular` : `${lineas.length} listas`) : modoManual && paso > 3 ? 'en el borrador' : undefined,
    undefined,
  ];
  const titulo = proveedor && numero ? `${modoManual ? 'Digitar compra' : 'Cargar factura'} · ${proveedor.nombre} ${numero}` : modoManual ? 'Digitar compra a mano' : 'Cargar factura';
  const ubicacionNombre = ubicaciones.find((u) => u.id === ubicacionId)?.nombre ?? 'bodega';

  const irSiguiente = () => setPaso((p) => Math.min(4, p + 1));
  const irAtras = () => setPaso((p) => Math.max(0, p - 1));
  const motivoSiguiente = !pasoValido[paso] ? (paso === 0 ? 'Elige un PDF o digita a mano' : paso === 1 ? 'Falta el tipo de cambio' : !proveedor ? 'Falta el proveedor' : !numero.trim() ? 'Falta el número' : undefined) : undefined;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-1 flex-col gap-4 p-4 sm:px-8 sm:pt-6">
        <Encabezado
          migas={[{ a: '/admin/compras', etiqueta: 'Compras' }]}
          titulo={titulo}
          acciones={
            <Boton ajustado onClick={() => navegar('/admin/compras')}>
              Descartar
            </Boton>
          }
        />
        <Pasos pasos={PASOS.map((etiqueta, i) => ({ etiqueta, detalle: detalles[i] }))} actual={paso} onIr={(i) => setPaso(i)} />

        {/* Paso 0 · Archivo */}
        {paso === 0 ? (
          <div className="flex flex-col gap-4 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
            <p className="text-cuerpo text-lab">Elige el PDF que mandó el distribuidor. El sistema reconoce de quién es y lee las líneas; tú revisas, vinculas cada línea a un producto y recibes.</p>
            <label className="flex h-boton w-full cursor-pointer items-center justify-center gap-2 rounded-campo border border-dashed border-sep text-cuerpo text-lab2">
              <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void alElegirArchivo(e.target.files?.[0])} disabled={leyendo} />
              <Icono nombre="archivo" tamano={18} />
              {leyendo ? 'Leyendo el PDF…' : lectura?.archivoNombre ? `${lectura.archivoNombre} · elegir otro` : 'Elegir PDF de la factura'}
            </label>
            {errorLectura ? (
              <>
                <Banner tono="alerta">{errorLectura.mensaje}</Banner>
                {errorLectura.muestra?.length ? (
                  <details className="text-chico text-lab3">
                    <summary className="cursor-pointer">Primeras líneas del documento (para agregar el lector)</summary>
                    <pre className="mt-1 overflow-x-auto rounded-campo bg-bg3 p-2">{errorLectura.muestra.join('\n')}</pre>
                  </details>
                ) : null}
              </>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 text-chico text-lab2">
              <span>¿No tienes PDF o el lector no lo entiende?</span>
              <Boton
                ajustado
                onClick={() => {
                  setModoManual(true);
                  setLectura(null);
                  setLineas([]);
                  setPaso(2);
                }}
              >
                Digitar a mano
              </Boton>
            </div>
          </div>
        ) : null}

        {/* Paso 1 · Moneda */}
        {paso === 1 ? (
          <div className="flex flex-col gap-3 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
            {moneda === 'CLP' ? (
              <>
                <p className="text-cuerpo text-lab">
                  El documento está en <strong className="font-semibold">pesos chilenos</strong>. Los costos se toman tal como vienen{lectura?.totales ? `: total ${clp(lectura.totales.total)}` : ''}.
                </p>
                {lectura ? (
                  <Banner tono="ok">
                    Leído con el lector «{lectura.lectorNombre}»: {lectura.lineas.length} línea(s).
                  </Banner>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-cuerpo text-lab">
                  Documento en <strong className="font-semibold">{moneda}</strong>, total {lectura?.totalOriginal != null ? usd(lectura.totalOriginal) : '—'}. Indica a cuántos pesos se pagó cada dólar y, si los hay, los gastos de importación en pesos (flete, aduana, IVA de importación): se reparten entre las líneas según su monto y forman parte del costo.
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Campo etiqueta={`Tipo de cambio (CLP por 1 ${moneda})`} value={tipoCambio} onChange={(e) => setTipoCambio(e.target.value)} inputMode="decimal" placeholder="950" autoFocus />
                  <CampoMonto etiqueta="Gastos de importación (CLP, opcional)" valor={gastosExtra} onValor={setGastosExtra} />
                  <div className="self-end">
                    <Boton ajustado variante={requiereTipoCambio ? 'principal' : 'secundario'} cargando={releyendo} deshabilitado={!(Number(tipoCambio.replace(',', '.')) > 0)} onClick={() => void releerConMoneda()}>
                      Calcular costos en pesos
                    </Boton>
                  </div>
                </div>
                {lectura?.tipoCambio ? (
                  <Banner tono="ok">
                    Costos calculados con {lectura.tipoCambio.toLocaleString('es-CL')} CLP por {moneda}
                    {lectura.gastosExtra ? ` y ${clp(lectura.gastosExtra)} de gastos` : ''} · total {clp(lectura.totales.total)}.
                  </Banner>
                ) : null}
                {errorLectura ? <Banner tono="peligro">{errorLectura.mensaje}</Banner> : null}
              </>
            )}
          </div>
        ) : null}

        {/* Paso 2 · Proveedor y documento */}
        {paso === 2 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
              <h2 className="text-cuerpo font-semibold text-lab">Proveedor</h2>
              {proveedor ? (
                <div className="flex flex-wrap items-center gap-3 text-cuerpo text-lab">
                  <span>
                    {proveedor.nombre}
                    {proveedor.rut ? <span className="font-mono text-chico text-lab3"> · {proveedor.rut}</span> : null}
                  </span>
                  <Boton ajustado variante="fantasma" onClick={() => setProveedor(null)}>
                    Cambiar
                  </Boton>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {lectura?.proveedorSugerido ? (
                    <Banner
                      tono="alerta"
                      accion={
                        <Boton ajustado onClick={() => setDialogoProveedor({ nombre: lectura.proveedorSugerido!.nombre, rut: lectura.proveedorSugerido!.rut, lector: lectura.proveedorSugerido!.lector })}>
                          Crear «{lectura.proveedorSugerido.nombre}»
                        </Boton>
                      }
                    >
                      La factura es de {lectura.proveedorSugerido.nombre}
                      {lectura.proveedorSugerido.rut ? ` (${lectura.proveedorSugerido.rut})` : ''}, que todavía no está como proveedor.
                    </Banner>
                  ) : null}
                  <div className="flex flex-wrap items-end gap-3">
                    <Filtro ancho="0 1 320px" minimo={220}>
                      <Selecto etiqueta="Elegir proveedor" valor="" onValor={(v) => setProveedor(proveedores.find((p) => p.id === v) ?? null)} opciones={proveedores.filter((p) => p.activo).map((p) => ({ valor: p.id, etiqueta: p.nombre }))} vacia="—" />
                    </Filtro>
                    <Boton ajustado onClick={() => setDialogoProveedor({})}>
                      Nuevo proveedor
                    </Boton>
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
              <h2 className="text-cuerpo font-semibold text-lab">Documento</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <Selecto etiqueta="Tipo" valor={tipoDoc} onValor={(v) => setTipoDoc(v as TipoDocumentoCompra)} opciones={(Object.keys(ETIQUETA_TIPO_DOC) as TipoDocumentoCompra[]).map((t) => ({ valor: t, etiqueta: ETIQUETA_TIPO_DOC[t] }))} />
                <Campo etiqueta="Número" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="097397951" error={!numero.trim() && proveedor ? 'Falta el número del documento.' : undefined} />
                <Campo etiqueta="Fecha" type="date" value={fechaDoc} onChange={(e) => setFechaDoc(e.target.value)} />
                <Selecto etiqueta="Entra a" valor={ubicacionId} onValor={setUbicacionId} opciones={ubicaciones.map((u) => ({ valor: u.id, etiqueta: u.nombre }))} />
              </div>
              {lectura?.yaCargada ? (
                <Banner
                  tono="peligro"
                  accion={
                    <Boton ajustado onClick={() => navegar(`/admin/compras/${lectura.yaCargada!.id}`)}>
                      Ver la compra
                    </Boton>
                  }
                >
                  Este documento ya está cargado. No se carga dos veces.
                </Banner>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Paso 3 · Líneas */}
        {paso === 3 ? (
          <div className="flex flex-col gap-4">
            {lectura ? (
              <>
                <Advertencias lista={lectura.advertencias} />
                <TablaLineas modo="propuesta" moneda={moneda} lineas={lineas.map((l, i) => ({ ...l, clave: String(i), stockVigente: null }))} onVincular={(l) => setVinculando(Number(l.clave))} />
              </>
            ) : (
              <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
                <Vacio mensaje="Las líneas se agregan en el borrador, una por una, después de guardar." />
              </div>
            )}
          </div>
        ) : null}

        {/* Paso 4 · Confirmar */}
        {paso === 4 ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TarjetaCifra rotulo="Proveedor" valor={proveedor?.nombre ?? '—'} detalle={proveedor?.rut ?? undefined} />
              <TarjetaCifra rotulo="Documento" valor={`${ETIQUETA_TIPO_DOC[tipoDoc]} ${numero || '—'}`} detalle={`${fecha(`${fechaDoc}T12:00:00`)} · ${moneda}`} />
              <TarjetaCifra rotulo="Entran" valor={`${unidades} u`} detalle={`${lineas.length} línea${lineas.length === 1 ? '' : 's'}${sinVincular ? ` · ${sinVincular} sin vincular` : ''} · a ${ubicacionNombre}`} grande />
              <TarjetaCifra rotulo="Total" valor={clp(lectura?.totales.total ?? 0)} detalle={lectura ? `neto ${clp(lectura.totales.neto)} · impuestos ${clp(lectura.totales.impuestos)}` : 'se calcula con las líneas'} grande />
            </div>
            <div className="rounded-tarjeta bg-bg p-4 text-cuerpo text-lab shadow-tarjeta">
              Se guarda como <strong className="font-semibold">borrador</strong>: podrás vincular, editar o quitar líneas antes de recibir. Nada entra al stock todavía.
            </div>
            {errorGuardar ? <Banner tono="peligro">{errorGuardar}</Banner> : null}
          </div>
        ) : null}
      </div>

      <PieAcciones
        resumen={
          <>
            <Cifra rotulo="Líneas" chico={sinVincular ? `· ${sinVincular} sin vincular` : undefined}>
              {lineas.length}
            </Cifra>
            <Cifra rotulo="Entran">{unidades} u</Cifra>
            <Cifra rotulo="Total">{clp(lectura?.totales.total ?? 0)}</Cifra>
          </>
        }
      >
        {paso > 0 ? (
          <Boton ajustado variante="fantasma" onClick={irAtras}>
            Atrás
          </Boton>
        ) : null}
        {paso >= 2 && paso < 4 ? (
          <Boton ajustado deshabilitado={!pasoValido[2] || !!lectura?.yaCargada || guardando} onClick={() => void guardar()}>
            Guardar borrador
          </Boton>
        ) : null}
        {paso < 4 ? (
          <Boton ajustado variante="principal" tamano="grande" deshabilitado={!pasoValido[paso]} motivoDeshabilitado={motivoSiguiente} onClick={irSiguiente}>
            Siguiente · {PASOS[paso + 1]}
            <Icono nombre="chevronDerecha" tamano={18} trazo={1.8} />
          </Boton>
        ) : (
          <Boton ajustado variante="principal" tamano="grande" cargando={guardando} deshabilitado={!pasoValido[2] || !!lectura?.yaCargada} motivoDeshabilitado={lectura?.yaCargada ? 'Ya está cargada' : undefined} onClick={() => void guardar()}>
            Guardar borrador
          </Boton>
        )}
      </PieAcciones>

      <DialogoVincular objetivo={objetivoVincular} onCerrar={() => setVinculando(null)} onElegir={(r) => vincular(vinculando!, r)} />
      <DialogoProveedor
        abierto={dialogoProveedor !== null}
        inicial={dialogoProveedor}
        lectores={lectores}
        onCerrar={() => setDialogoProveedor(null)}
        onHecho={(p) => {
          setDialogoProveedor(null);
          setProveedor(p);
          avisar({ tono: 'ok', titulo: 'Proveedor creado.', detalle: p.nombre });
          void cargarProveedores().catch(() => {});
        }}
      />
    </div>
  );
}

/* =========================================================================================
 * V27 — Detalle de una compra
 * ========================================================================================= */

export function CompraDetalle() {
  const { id } = useParams<{ id: string }>();
  const navegar = useNavigate();
  const { avisar } = useAvisos();
  const confirmar = useConfirmar();
  const [compra, setCompra] = useState<CompraDetalleDatos | null>(null);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [vinculando, setVinculando] = useState<LineaCompra | null>(null);
  const [dialogoLinea, setDialogoLinea] = useState<{ abierto: boolean; inicial: FormLinea | null }>({ abierto: false, inicial: null });
  const [confirmarRecibir, setConfirmarRecibir] = useState(() => new URLSearchParams(window.location.search).get('recibir') === '1');
  const [recibiendo, setRecibiendo] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [notaAnular, setNotaAnular] = useState('');
  const [enviandoAnular, setEnviandoAnular] = useState(false);

  const cargar = useCallback(() => {
    if (!id) return;
    setCargando(true);
    api<CompraDetalleDatos>(`/compras/${id}`)
      .then(setCompra)
      .catch((e) => setError(mensajeError(e, { COMPRA_NO_ENCONTRADA: 'La compra no existe.' })))
      .finally(() => setCargando(false));
  }, [id]);

  useEffect(() => {
    cargar();
    void api<{ ubicaciones: Ubicacion[] }>('/ubicaciones').then((r) => setUbicaciones(r.ubicaciones)).catch(() => {});
  }, [cargar]);

  if (error) {
    return (
      <div className="p-4 sm:px-8 sm:py-6">
        <Encabezado migas={[{ a: '/admin/compras', etiqueta: 'Compras' }]} titulo="Compra" />
        <Banner tono="peligro">{error}</Banner>
      </div>
    );
  }
  if (!compra) return <Cargando />;

  const borrador = compra.estado === 'borrador';
  const recibida = compra.estado === 'recibida';
  const sinVincular = compra.lineas.filter((l) => !l.productoId && !l.movimientoId);
  const conProducto = compra.lineas.filter((l) => l.productoId && !l.movimientoId);
  const unidades = conProducto.reduce((a, l) => a + l.cantidad, 0);
  const pendientes = recibida ? compra.lineas.filter((l) => !l.movimientoId) : [];
  const unidadesTotales = compra.lineas.filter((l) => l.productoId).reduce((a, l) => a + l.cantidad, 0);
  const puedeVincular = borrador || (recibida && pendientes.length > 0);

  const patchCompra = async (data: Record<string, unknown>) => {
    try {
      await api<CompraDetalleDatos>(`/compras/${compra.id}`, { method: 'PATCH', body: JSON.stringify(data) });
      cargar();
    } catch (err) {
      avisar({ tono: 'error', titulo: 'No se guardó el cambio.', detalle: mensajeError(err, { COMPRA_DUPLICADA: 'Ese número ya está cargado para este proveedor.' }) });
    }
  };

  const vincularLinea = async (linea: LineaCompra, r: { producto: ResultadoBusquedaProducto | null; unidadesPorBulto: number }) => {
    if (linea.movimientoId) return;
    await api(`/compras/${compra.id}/lineas/${linea.id}`, { method: 'PATCH', body: JSON.stringify({ productoId: r.producto?.id ?? null, unidadesPorBulto: r.unidadesPorBulto }) });
    setVinculando(null);
    avisar({ tono: 'ok', titulo: r.producto ? 'Línea vinculada.' : 'Vínculo quitado.', detalle: r.producto ? `${linea.descripcion} → ${r.producto.nombre}.` : linea.descripcion });
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
    avisar({ tono: 'ok', titulo: f.id ? 'Línea actualizada.' : 'Línea agregada.', detalle: cuerpo.descripcion });
    cargar();
  };

  const eliminarLinea = async (l: LineaVista) => {
    const seguro = await confirmar({
      titulo: `¿Quitar la línea ${l.orden}?`,
      cuerpo: (
        <>
          <strong className="font-semibold text-lab">
            {l.descripcion} · {l.cantidad} u × {clp(l.costoUnitario)}
          </strong>{' '}
          sale del borrador. El total baja a <span className="num text-lab">{clp(Math.max(0, compra.total - l.total))}</span>. Puedes volver a agregarla a mano.
        </>
      ),
      accion: 'Quitar línea',
    });
    if (!seguro) return;
    try {
      await api(`/compras/${compra.id}/lineas/${l.clave}`, { method: 'DELETE' });
      avisar({ tono: 'ok', titulo: 'Línea quitada.', detalle: l.descripcion });
      cargar();
    } catch (err) {
      avisar({ tono: 'error', titulo: 'No se pudo quitar la línea.', detalle: mensajeError(err) });
    }
  };

  const recibir = async () => {
    setRecibiendo(true);
    try {
      const r = await api<{ movimientos: unknown[]; encendidos: string[]; omitidas: string[] }>(`/compras/${compra.id}/recibir`, { method: 'POST', body: JSON.stringify({ omitirSinVincular: sinVincular.length > 0 }) });
      setConfirmarRecibir(false);
      avisar({
        tono: 'ok',
        titulo: recibida ? 'Líneas pendientes recibidas.' : 'Compra recibida.',
        detalle: `${unidades} unidades entraron a ${compra.ubicacion.nombre} en ${r.movimientos.length} movimiento(s)${r.encendidos.length ? ` · ${r.encendidos.length} producto(s) empiezan a controlar stock` : ''}${r.omitidas.length ? ` · ${r.omitidas.length} línea(s) quedaron pendientes` : ''}.`,
        accion: { etiqueta: 'Ver stock', onClick: () => navegar('/admin/stock') },
      });
      cargar();
    } catch (err) {
      setConfirmarRecibir(false);
      avisar({ tono: 'error', titulo: 'No se recibió la compra.', detalle: mensajeError(err, { SIN_LINEAS: 'Ninguna línea tiene producto: no hay nada que ingresar.', SIN_PENDIENTES: 'No hay líneas pendientes con producto.', COMPRA_NO_EDITABLE: 'La compra ya no se puede recibir.' }) });
    } finally {
      setRecibiendo(false);
    }
  };

  const anular = async () => {
    setEnviandoAnular(true);
    try {
      await api(`/compras/${compra.id}/anular`, { method: 'POST', body: JSON.stringify({ nota: notaAnular.trim() }) });
      setAnulando(false);
      avisar({ tono: 'ok', titulo: 'Borrador anulado.', detalle: `${compra.proveedor.nombre} · ${compra.numeroDocumento}.` });
      cargar();
    } catch (err) {
      avisar({ tono: 'error', titulo: 'No se pudo anular.', detalle: mensajeError(err) });
      setAnulando(false);
    } finally {
      setEnviandoAnular(false);
    }
  };

  const objetivoVincular: ObjetivoVincular | null = vinculando
    ? {
        indice: vinculando.orden - 1,
        descripcion: vinculando.descripcion,
        codigoProveedor: vinculando.codigoProveedor,
        bultos: vinculando.bultos,
        sueltas: vinculando.sueltas,
        unidadesPorBulto: vinculando.unidadesPorBulto,
        totalLinea: vinculando.total,
        productoActual: vinculando.producto ? { id: vinculando.producto.id, sku: vinculando.producto.sku, nombre: vinculando.producto.nombre, precioVenta: vinculando.producto.precioVenta } : null,
      }
    : null;

  const menuCabecera = [
    ...(borrador ? [{ etiqueta: 'Anular borrador', onClick: () => setAnulando(true), tono: 'peligro' as const }] : []),
    ...(recibida ? [{ etiqueta: 'Ver stock', onClick: () => navegar('/admin/stock') }] : []),
    { etiqueta: 'Volver a Compras', onClick: () => navegar('/admin/compras'), separadorAntes: true },
  ];

  const puedeRecibir = conProducto.length > 0;
  const etiquetaRecibir = recibida ? `Recibir ${conProducto.length} pendiente${conProducto.length === 1 ? '' : 's'}` : `Recibir ${conProducto.length} línea${conProducto.length === 1 ? '' : 's'}`;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-1 flex-col gap-4 p-4 sm:px-8 sm:pt-6">
        <Encabezado
          migas={[{ a: '/admin/compras', etiqueta: 'Compras' }]}
          titulo={`${compra.proveedor.nombre} · ${ETIQUETA_TIPO_DOC[compra.tipoDocumento]} ${compra.numeroDocumento}`}
          insignia={<InsigniaCompra estado={compra.estado} pendientes={pendientes.length} />}
          acciones={
            <>
              {borrador ? (
                <Boton ajustado onClick={() => setDialogoLinea({ abierto: true, inicial: null })}>
                  Agregar línea
                </Boton>
              ) : null}
              {puedeVincular ? (
                <Boton ajustado variante="principal" deshabilitado={!puedeRecibir} onClick={() => setConfirmarRecibir(true)}>
                  {recibida ? 'Recibir pendientes' : 'Recibir'}
                </Boton>
              ) : null}
              <MenuAcciones variante="cabecera" items={menuCabecera} />
            </>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TarjetaCifra rotulo="Proveedor" valor={compra.proveedor.nombre} detalle={compra.proveedor.rut ? <span className="font-mono">{compra.proveedor.rut}</span> : `${compra.origen === 'pdf' ? 'leída del PDF' : 'digitada'} por ${compra.usuario.nombre}`} />
          <TarjetaCifra
            rotulo="Documento"
            valor={`${ETIQUETA_TIPO_DOC[compra.tipoDocumento]} ${compra.numeroDocumento}`}
            detalle={`${fecha(compra.fechaDocumento)} · ${compra.moneda}${compra.moneda !== 'CLP' && compra.tipoCambio ? ` × ${compra.tipoCambio.toLocaleString('es-CL')}` : ''}${compra.recibidaEn && compra.recibidaPor ? ` · recibida ${fecha(compra.recibidaEn)} por ${compra.recibidaPor.nombre}` : ''}`}
          />
          <TarjetaCifra rotulo="Entran" valor={`${unidadesTotales} u`} detalle={`${compra.lineas.length} línea${compra.lineas.length === 1 ? '' : 's'}${sinVincular.length ? ` · ${sinVincular.length} sin vincular` : ''} · ${compra.ubicacion.nombre}`} grande />
          <TarjetaCifra rotulo="Total" valor={clp(compra.total)} detalle={`neto ${clp(compra.neto)} · impuestos ${clp(compra.impuestos)}${compra.gastosExtra ? ` · gastos ${clp(compra.gastosExtra)}` : ''}`} grande />
        </div>

        {borrador ? (
          <div className="grid grid-cols-1 gap-3 rounded-tarjeta bg-bg p-4 shadow-tarjeta sm:grid-cols-2">
            <Campo etiqueta="Fecha del documento" type="date" value={compra.fechaDocumento.slice(0, 10)} onChange={(ev) => void patchCompra({ fechaDocumento: ev.target.value })} />
            <Selecto etiqueta="Entra a" valor={compra.ubicacion.id} onValor={(v) => void patchCompra({ ubicacionId: v })} opciones={(ubicaciones.length ? ubicaciones : [compra.ubicacion]).map((u) => ({ valor: u.id, etiqueta: u.nombre }))} />
          </div>
        ) : null}

        {recibida && pendientes.length ? (
          <Banner tono="alerta">
            {pendientes.length} línea{pendientes.length === 1 ? '' : 's'} quedaron fuera al recibir. Vincúlalas y luego «Recibir pendientes»: entran al stock sin tocar lo que ya se recibió.
          </Banner>
        ) : null}
        {compra.nota ? <div className="whitespace-pre-line text-chico text-lab2">{compra.nota}</div> : null}
        {compra.advertencias?.length ? <Advertencias lista={compra.advertencias} /> : null}

        <TablaLineas
          modo="detalle"
          moneda={compra.moneda}
          cargando={cargando}
          lineas={compra.lineas.map((l) => ({ ...l, clave: l.id }))}
          onVincular={puedeVincular ? (l) => setVinculando(compra.lineas.find((x) => x.id === l.clave) ?? null) : undefined}
          onEditar={
            borrador
              ? (l) => {
                  const x = compra.lineas.find((y) => y.id === l.clave);
                  if (x) setDialogoLinea({ abierto: true, inicial: { id: x.id, descripcion: x.descripcion, codigoProveedor: x.codigoProveedor ?? '', bultos: x.bultos, unidadesPorBulto: x.unidadesPorBulto, sueltas: x.sueltas, neto: x.neto, total: x.total } });
                }
              : undefined
          }
          onEliminar={borrador ? (l) => void eliminarLinea(l) : undefined}
        />
      </div>

      {puedeVincular ? (
        <PieAcciones
          resumen={
            <span className="text-chico text-lab2">
              {conProducto.length} línea{conProducto.length === 1 ? '' : 's'} lista{conProducto.length === 1 ? '' : 's'}
              {sinVincular.length ? ` · ${sinVincular.length} sin vincular quedarán pendientes` : ''}
            </span>
          }
        >
          <Boton ajustado variante="principal" tamano="grande" deshabilitado={!puedeRecibir} motivoDeshabilitado={!puedeRecibir ? 'Vincula al menos una línea a un producto' : undefined} onClick={() => setConfirmarRecibir(true)}>
            {etiquetaRecibir}
          </Boton>
        </PieAcciones>
      ) : null}

      {/* Recibir (1e): números grandes, consecuencia en una frase, una sola acción principal */}
      <Dialogo abierto={confirmarRecibir} titulo={recibida ? 'Recibir líneas pendientes' : 'Recibir mercadería'} onCerrar={() => setConfirmarRecibir(false)} cerrable={!recibiendo} ancho={560}>
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-[2px] rounded-tarjeta bg-bg2 p-4">
              <span className="num text-[30px] font-semibold leading-none tracking-[-.03em] text-lab">{unidades} u</span>
              <span className="text-chico text-lab2">
                entran a <strong className="font-semibold text-lab">{compra.ubicacion.nombre}</strong> · {conProducto.length} línea{conProducto.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex flex-col gap-[2px] rounded-tarjeta bg-bg2 p-4">
              <span className="num text-[30px] font-semibold leading-none tracking-[-.03em] text-lab">{sinVincular.length}</span>
              <span className="text-chico text-lab2">
                línea{sinVincular.length === 1 ? '' : 's'} queda{sinVincular.length === 1 ? '' : 'n'} <strong className="font-semibold text-lab">pendiente{sinVincular.length === 1 ? '' : 's'}</strong>
                {sinVincular.length ? ` · ${sinVincular.reduce((a, l) => a + l.cantidad, 0)} u sin producto` : ''}
              </span>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-campo border border-alerta bg-bg px-4 py-3 text-cuerpo leading-relaxed text-lab">
            <Icono nombre="alerta" tamano={20} trazo={1.8} clase="mt-[2px] text-alerta" />
            <span>
              Después de recibir, la cabecera y las líneas recibidas <strong className="font-semibold">ya no se pueden editar</strong>; lo que vino mal se corrige con una merma o un ajuste.
              {sinVincular.length ? ` Las ${sinVincular.length} pendientes se vinculan y reciben después desde esta misma compra.` : ''}
            </span>
          </div>
          {sinVincular.length ? (
            <details className="text-chico text-lab2">
              <summary className="flex h-9 cursor-pointer list-none items-center gap-2">
                <Icono nombre="chevronDerecha" tamano={14} />
                Ver las {sinVincular.length} líneas pendientes
              </summary>
              <ul className="mt-1 flex flex-col gap-1 pl-6">
                {sinVincular.map((l) => (
                  <li key={l.id}>
                    {l.descripcion} · {l.cantidad} u
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <PieDialogo>
            <Boton ajustado onClick={() => setConfirmarRecibir(false)} deshabilitado={recibiendo}>
              Cancelar
            </Boton>
            <Boton ajustado variante="principal" cargando={recibiendo} deshabilitado={!puedeRecibir} onClick={() => void recibir()}>
              {etiquetaRecibir}
            </Boton>
          </PieDialogo>
        </div>
      </Dialogo>

      <Dialogo abierto={anulando} titulo="¿Anular este borrador?" onCerrar={() => setAnulando(false)} cerrable={!enviandoAnular} rol="alertdialog">
        <div className="flex flex-col gap-3">
          <p className="text-cuerpo leading-relaxed text-lab2">
            <strong className="font-semibold text-lab">
              {compra.proveedor.nombre} · {compra.numeroDocumento}
            </strong>{' '}
            queda anulada y no toca el stock. Se conserva en la lista con su motivo.
          </p>
          <Campo etiqueta="Motivo (obligatorio)" value={notaAnular} onChange={(ev) => setNotaAnular(ev.target.value)} autoFocus />
          <PieDialogo>
            <Boton ajustado onClick={() => setAnulando(false)} deshabilitado={enviandoAnular}>
              Cancelar
            </Boton>
            <Boton ajustado variante="peligro" cargando={enviandoAnular} deshabilitado={!notaAnular.trim()} onClick={() => void anular()}>
              Anular borrador
            </Boton>
          </PieDialogo>
        </div>
      </Dialogo>

      <DialogoVincular objetivo={objetivoVincular} onCerrar={() => setVinculando(null)} onElegir={(r) => vincularLinea(vinculando!, r)} />
      <DialogoLinea abierto={dialogoLinea.abierto} inicial={dialogoLinea.inicial} onCerrar={() => setDialogoLinea({ abierto: false, inicial: null })} onGuardar={guardarLinea} />
    </div>
  );
}
