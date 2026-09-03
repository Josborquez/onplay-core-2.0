// V13 — Discrepancias (06-SDD §10, encargado+). La pantalla más importante de la etapa:
// tarjetas agrupadas por tipo con los tres números (maestro · canal · publicado), una frase
// que explica qué se deduce, y acciones con su consecuencia escrita ANTES de confirmar.
// Nota obligatoria en todo lo que cambia algo; «El maestro tiene razón» solo admin (§6.2).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorApi, api } from '../../api.js';
import { useSesion } from '../../sesion.js';
import { Banner, Boton, Campo, Cargando, Dialogo, Insignia, Segmentado, Vacio } from '../../components/base.js';
import { clp, fecha } from '../../utils/formato.js';
import { NOMBRE_CANAL, type Discrepancia, type RespuestaDiscrepancias, type TipoDiscrepancia } from '../../tiposSync.js';
import { Encabezado, Paginacion } from './util.js';

type Accion = 'adoptar_canal' | 'imponer_maestro' | 'descartar' | 'contactar_cliente' | 'reembolsar' | 'reponer';

const ORDEN_TIPOS: TipoDiscrepancia[] = [
  'pedido_sin_stock',
  'stock_derivado',
  'producto_sin_mapear',
  'pedido_anulado',
  'producto_desaparecido',
  'canal_sin_gestion',
  'primera_publicacion',
  'precio_en_oferta',
  'precio_derivado',
];

const TIPOS_STOCK: TipoDiscrepancia[] = ['stock_derivado', 'primera_publicacion', 'canal_sin_gestion'];
const TIPOS_PRECIO: TipoDiscrepancia[] = ['precio_derivado', 'precio_en_oferta'];
const INFORMATIVAS: TipoDiscrepancia[] = ['precio_derivado', 'primera_publicacion'];

function esPrecio(d: Discrepancia) {
  return TIPOS_PRECIO.includes(d.tipo);
}

/** Qué pasará si se confirma, en una frase (§10 V13). */
function consecuencia(d: Discrepancia, accion: Accion, cantidad: number): string {
  const n = (v: number | null) => (v === null ? '—' : esPrecio(d) ? clp(v) : String(v));
  switch (accion) {
    case 'adoptar_canal': {
      const dif = (d.valorCanal ?? 0) - (d.valorMaestro ?? 0);
      return `Se creará un ajuste de ${dif > 0 ? '+' : ''}${dif} en el inventario (ubicación online) y el maestro quedará en ${n(d.valorCanal)}.`;
    }
    case 'imponer_maestro':
      return `Se escribirá ${n(d.valorMaestro)} en el canal, reemplazando el ${n(d.valorCanal)} que tiene ahora.`;
    case 'descartar':
      return 'No se cambia nada. Solo se deja de avisar.';
    case 'contactar_cliente':
      return 'No se cambia el stock. Queda registrado que se avisó al cliente; el pedido sigue reservado en el maestro.';
    case 'reembolsar':
      return 'No se cambia el stock aquí: cuando el reembolso quede hecho en la tienda web, la ingesta lo verá como pedido anulado.';
    case 'reponer':
      return `Se registrará un ingreso (compra) de ${cantidad || 0} unidad(es) en la ubicación online.`;
  }
}

const ETIQUETA_ACCION: Record<Accion, string> = {
  adoptar_canal: 'El canal tiene razón',
  imponer_maestro: 'El maestro tiene razón',
  descartar: 'Descartar',
  contactar_cliente: 'Contacté al cliente',
  reembolsar: 'Se reembolsa',
  reponer: 'Llegó otra unidad',
};

function accionesDe(d: Discrepancia, esAdmin: boolean): Accion[] {
  if (d.tipo === 'pedido_sin_stock') return ['reponer', 'contactar_cliente', 'reembolsar', 'descartar'];
  if (TIPOS_STOCK.includes(d.tipo)) return esAdmin ? ['adoptar_canal', 'imponer_maestro', 'descartar'] : ['adoptar_canal', 'descartar'];
  if (TIPOS_PRECIO.includes(d.tipo)) return esAdmin ? ['imponer_maestro', 'descartar'] : ['descartar'];
  return ['descartar'];
}

export function Discrepancias() {
  const { usuario } = useSesion();
  const esAdmin = usuario?.rol === 'admin';
  const [datos, setDatos] = useState<RespuestaDiscrepancias | null>(null);
  const [canal, setCanal] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoDiscrepancia | null>(null);
  const [estado, setEstado] = useState<'abierta' | 'resuelta' | 'descartada'>('abierta');
  const [pagina, setPagina] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [activa, setActiva] = useState<{ d: Discrepancia; accion: Accion } | null>(null);
  const [nota, setNota] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [errorDialogo, setErrorDialogo] = useState('');

  const cargar = useCallback(async () => {
    const p = new URLSearchParams({ pagina: String(pagina), estado });
    if (canal) p.set('canalId', canal);
    if (tipo) p.set('tipo', tipo);
    try {
      setDatos(await api<RespuestaDiscrepancias>(`/sync/discrepancias?${p}`));
      setError(null);
    } catch {
      setError('No se pudieron cargar las discrepancias.');
    }
  }, [pagina, estado, canal, tipo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const abrir = (d: Discrepancia, accion: Accion) => {
    setActiva({ d, accion });
    setNota('');
    setCantidad(Math.max(1, d.valorCanal ?? 1));
    setErrorDialogo('');
  };

  const confirmar = async () => {
    if (!activa) return;
    const { d, accion } = activa;
    if (accion !== 'descartar' && !nota.trim()) {
      setErrorDialogo('La nota es obligatoria: es lo que va a leer quien revise la auditoría.');
      return;
    }
    if (accion === 'reponer' && (!Number.isInteger(cantidad) || cantidad <= 0)) {
      setErrorDialogo('La cantidad debe ser un entero mayor que 0.');
      return;
    }
    setEnviando(true);
    setErrorDialogo('');
    try {
      await api(`/sync/discrepancias/${d.id}/resolver`, {
        method: 'POST',
        body: JSON.stringify({ accion, nota: nota.trim(), ...(accion === 'reponer' ? { cantidad } : {}) }),
      });
      setAviso(`${ETIQUETA_ACCION[accion]}: listo.`);
      setActiva(null);
      await cargar();
    } catch (e) {
      if (e instanceof ErrorApi) {
        const m: Record<string, string> = {
          CANDADO_SOLO_LECTURA: 'El candado SYNC_SOLO_LECTURA sigue activo: el maestro todavía no puede escribir en los canales (Fase 0 de E3).',
          ROL_INSUFICIENTE: 'Solo un admin puede escribir en el canal.',
          DISCREPANCIA_CERRADA: 'Esta discrepancia ya se cerró.',
          NOTA_REQUERIDA: 'La nota es obligatoria.',
          STOCK_INSUFICIENTE: 'El ajuste dejaría el stock en negativo (R-014).',
        };
        setErrorDialogo(m[e.codigo] ?? `No se pudo resolver (${e.codigo}).`);
      } else setErrorDialogo('Sin conexión.');
    } finally {
      setEnviando(false);
    }
  };

  const grupos = datos
    ? ORDEN_TIPOS.map((t) => ({ tipo: t, lista: datos.discrepancias.filter((d) => d.tipo === t) })).filter((g) => g.lista.length > 0)
    : [];
  const totalAbiertas = datos ? Object.values(datos.abiertasPorTipo).reduce((a, b) => a + (b ?? 0), 0) : 0;
  const accionables = datos
    ? Object.entries(datos.abiertasPorTipo)
        .filter(([t]) => !INFORMATIVAS.includes(t as TipoDiscrepancia))
        .reduce((a, [, n]) => a + (n ?? 0), 0)
    : 0;

  return (
    <div className="p-4">
      <Encabezado
        titulo="Discrepancias"
        extra={
          datos ? (
            accionables > 0 ? (
              <Insignia tono="alerta">{accionables} por resolver · {totalAbiertas - accionables} informativas</Insignia>
            ) : (
              <Insignia tono="ok">Sin discrepancias por resolver</Insignia>
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

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmentado
          opciones={[
            { valor: 'onplay_cl', etiqueta: 'onplay.cl' },
            { valor: 'onplaygames_cl', etiqueta: 'onplaygames.cl' },
          ]}
          valor={canal}
          onChange={(v) => {
            setCanal(v);
            setPagina(1);
          }}
        />
        <Segmentado<'abierta' | 'resuelta' | 'descartada'>
          opciones={[
            { valor: 'abierta', etiqueta: 'Abiertas' },
            { valor: 'resuelta', etiqueta: 'Resueltas' },
            { valor: 'descartada', etiqueta: 'Descartadas' },
          ]}
          valor={estado}
          onChange={(v) => {
            setEstado(v ?? 'abierta');
            setPagina(1);
          }}
        />
      </div>

      {datos ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {ORDEN_TIPOS.filter((t) => (datos.abiertasPorTipo[t] ?? 0) > 0).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTipo(tipo === t ? null : t);
                setPagina(1);
              }}
              className={`rounded-campo border px-3 py-1 text-chico ${tipo === t ? 'border-ac bg-bg3 font-semibold text-lab' : 'border-sep text-lab2'}`}
            >
              {datos.titulos[t]} · {datos.abiertasPorTipo[t]}
            </button>
          ))}
        </div>
      ) : null}

      {datos === null ? (
        <Cargando />
      ) : datos.discrepancias.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje={estado === 'abierta' ? 'No hay discrepancias abiertas. Ese es el estado esperado al cierre de cada jornada.' : 'Nada en este filtro.'} />
        </div>
      ) : (
        <>
          {grupos.map((g) => (
            <section key={g.tipo} className="mb-5">
              <h2 className="mb-2 text-cuerpo font-semibold text-lab">
                {datos.titulos[g.tipo]}{' '}
                <span className="num text-chico text-lab3">· {g.lista.length}</span>
                {INFORMATIVAS.includes(g.tipo) ? <Insignia>informativa</Insignia> : null}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {g.lista.map((d) => (
                  <Tarjeta key={d.id} d={d} acciones={estado === 'abierta' ? accionesDe(d, esAdmin) : []} onAccion={abrir} />
                ))}
              </div>
            </section>
          ))}
          <Paginacion pagina={pagina} porPagina={datos.porPagina} total={datos.total} onPagina={setPagina} />
        </>
      )}

      <Dialogo abierto={activa !== null} titulo={activa ? ETIQUETA_ACCION[activa.accion] : ''} onCerrar={() => setActiva(null)} cerrable={!enviando} ancho={460}>
        {activa ? (
          <div className="flex flex-col gap-3">
            <p className="text-cuerpo text-lab">{consecuencia(activa.d, activa.accion, cantidad)}</p>
            {activa.accion === 'reponer' ? (
              <Campo etiqueta="Unidades que llegaron" type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} />
            ) : null}
            {activa.accion !== 'descartar' ? (
              <Campo etiqueta="Nota (obligatoria)" value={nota} onChange={(e) => setNota(e.target.value)} autoFocus placeholder="Qué se comprobó y por qué" />
            ) : null}
            {errorDialogo ? <p className="text-chico text-peligro">{errorDialogo}</p> : null}
            <div className="flex justify-end gap-2">
              <Boton onClick={() => setActiva(null)} deshabilitado={enviando}>
                Cancelar
              </Boton>
              <Boton variante={activa.accion === 'descartar' ? 'secundario' : 'principal'} cargando={enviando} onClick={() => void confirmar()}>
                Confirmar
              </Boton>
            </div>
          </div>
        ) : null}
      </Dialogo>
    </div>
  );
}

function Tarjeta({ d, acciones, onAccion }: { d: Discrepancia; acciones: Accion[]; onAccion: (d: Discrepancia, a: Accion) => void }) {
  const n = (v: number | null) => (v === null ? '—' : esPrecio(d) ? clp(v) : String(v));
  const sujeto = d.productoCanal
    ? `${d.productoCanal.producto.sku} · ${d.productoCanal.producto.nombre}`
    : d.pedidoCanalLinea
      ? `Pedido ${d.pedidoCanal?.numero ?? ''} · ${d.pedidoCanalLinea.descripcion}`
      : d.pedidoCanal
        ? `Pedido ${d.pedidoCanal.numero} · ${clp(d.pedidoCanal.total)}`
        : d.canalId;
  return (
    <article className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-chico text-lab3">{NOMBRE_CANAL[d.canalId] ?? d.canalId}</span>
        {d.vecesVista > 1 ? (
          <Insignia tono="alerta">
            Detectada {d.vecesVista} veces desde el {fecha(d.creadaEn)}
          </Insignia>
        ) : (
          <span className="text-chico text-lab3">vista el {fecha(d.vistaEn)}</span>
        )}
        {d.estado !== 'abierta' ? <Insignia>{d.estado}{d.accionTomada ? ` · ${d.accionTomada.split(':')[0]}` : ''}</Insignia> : null}
      </div>
      <p className="mt-1 text-cuerpo font-semibold text-lab">{sujeto}</p>
      {d.valorMaestro !== null || d.valorCanal !== null || d.valorPublicado !== null ? (
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          {[
            ['Maestro', d.valorMaestro],
            ['Canal', d.valorCanal],
            ['Publicado', d.valorPublicado],
          ].map(([e, v]) => (
            <div key={String(e)} className="rounded-campo bg-bg3 py-2">
              <p className="text-chico text-lab3">{e}</p>
              <p className="num text-cuerpo font-semibold text-lab">{n(v as number | null)}</p>
            </div>
          ))}
        </div>
      ) : null}
      {d.detalle ? <p className="mt-2 text-chico text-lab2">{d.detalle}</p> : null}
      {d.tipo === 'producto_sin_mapear' && d.estado === 'abierta' ? (
        <p className="mt-2 text-chico">
          <Link to="/admin/pedidos?sinMapear=true" className="text-ac underline">
            Vincular a un producto en Pedidos online
          </Link>
        </p>
      ) : null}
      {acciones.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {acciones.map((a) => (
            <Boton key={a} variante={a === 'descartar' ? 'fantasma' : 'secundario'} onClick={() => onAccion(d, a)} clase="min-w-[150px]">
              {ETIQUETA_ACCION[a]}
            </Boton>
          ))}
        </div>
      ) : null}
    </article>
  );
}
