// V6 — Alta rápida de snack (05-SDD §7): 50 productos seguidos sin tocar el mouse.
// Enter = Guardar y otro (mantiene la categoría, foco al nombre). El tipo se
// deriva de la categoría y SIEMPRE se envía explícito: sin él nacería
// `indeterminado` y el SKU saldría IND-… en vez de SNK-… (02-SDD §6.4).
// R-035: la categoría solo ofrece Snacks y sus subcategorías, con «Nueva categoría» al lado.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ErrorApi } from '../../api.js';
import { buscarLocal, categorias, hidratarCatalogo, olvidarCategorias, refrescarCatalogo, type Categoria, type ProductoCache } from '../../catalogo.js';
import { useEnLinea } from '../../tema.js';
import type { TipoProducto } from '../../tipos.js';
import { clp } from '../../utils/formato.js';
import { Banner, Boton, Campo, CampoMonto, Dialogo, PieDialogo } from '../../components/base.js';
import { useAvisos } from '../../components/Toast.js';
import { aplanarCategorias, Encabezado, Selecto, type OpcionCategoria } from './util.js';

/** Raíz del árbol de categorías → tipo del producto (02-SDD §6.3). */
export const TIPO_POR_RAIZ: Record<string, TipoProducto> = {
  snacks: 'snack',
  accesorios: 'accesorio',
  sellado: 'sellado',
  cartas: 'single',
  'juegos-de-mesa': 'juego_mesa',
  'juegos-de-rol': 'juego_mesa',
  'juguetes-y-coleccion': 'juguete',
  eventos: 'evento',
  'sin-clasificar': 'indeterminado',
};

const normalizar = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const RAIZ_SNACKS = 'snacks';

/** Subcategor\u00edas de Snacks, aplanadas (la ra\u00edz sola si todav\u00eda no tiene hijas). */
function opcionesSnacks(raiz: Categoria | undefined): OpcionCategoria[] {
  if (!raiz) return [];
  if (raiz.hijos.length === 0) return aplanarCategorias([raiz]);
  return aplanarCategorias(raiz.hijos).map((o) => ({ ...o, raizSlug: RAIZ_SNACKS }));
}

function DialogoNuevaCategoria({
  abierto,
  padre,
  onCerrar,
  onCreada,
}: {
  abierto: boolean;
  padre: Categoria | undefined;
  onCerrar: () => void;
  onCreada: (c: Categoria) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (abierto) {
      setNombre('');
      setError(null);
    }
  }, [abierto]);

  const crear = async () => {
    if (!padre || guardando) return;
    if (!nombre.trim()) return setError('Escribe el nombre de la categor\u00eda.');
    setGuardando(true);
    setError(null);
    try {
      const r = await api<{ categoria: Categoria }>('/categorias', {
        method: 'POST',
        body: JSON.stringify({ nombre: nombre.trim(), padreId: padre.id }),
      });
      onCreada(r.categoria);
    } catch (e) {
      setError(
        e instanceof ErrorApi && e.codigo === 'CATEGORIA_DUPLICADA'
          ? 'Ya existe una categor\u00eda con ese nombre en Snacks.'
          : 'No se pudo crear la categor\u00eda. Intenta de nuevo.',
      );
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialogo abierto={abierto} titulo="Nueva categor\u00eda de snacks" onCerrar={onCerrar} cerrable={!guardando}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation(); // no dispara el \u00abGuardar y otro\u00bb del formulario de atr\u00e1s
          void crear();
        }}
      >
        <Campo etiqueta="Nombre" placeholder="Galletas" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        <p className="text-chico text-lab3">Queda dentro de Snacks. Los productos que la usen ser\u00e1n snacks (SKU SNK-\u2026).</p>
        <PieDialogo error={error}>
          <Boton ajustado onClick={onCerrar} deshabilitado={guardando}>
            Cancelar
          </Boton>
          <Boton ajustado variante="principal" type="submit" cargando={guardando}>
            Crear categor\u00eda
          </Boton>
        </PieDialogo>
      </form>
    </Dialogo>
  );
}

export function AltaSnack() {
  const [raiz, setRaiz] = useState<Categoria | undefined>();
  const [cargadas, setCargadas] = useState(false);
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const opciones = useMemo(() => opcionesSnacks(raiz), [raiz]);
  const { avisar } = useAvisos();
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState<number | ''>('');
  const [categoriaId, setCategoriaId] = useState('');
  const [codigoBarras, setCodigoBarras] = useState('');
  const [errores, setErrores] = useState<{ nombre?: string; precio?: string; categoria?: string }>({});
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState<string | null>(null); // "Guardado como SNK-000018."
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const refNombre = useRef<HTMLInputElement>(null);
  const enLinea = useEnLinea();

  useEffect(() => {
    void hidratarCatalogo(); // el aviso de duplicado se resuelve contra el caché local
    void categorias()
      .then((arbol) => setRaiz(arbol.find((c) => c.slug === RAIZ_SNACKS)))
      .finally(() => setCargadas(true));
  }, []);

  const alCrearCategoria = async (c: Categoria) => {
    setNuevaAbierta(false);
    olvidarCategorias(); // el árbol cambió: se vuelve a pedir
    const arbol = await categorias();
    setRaiz(arbol.find((r) => r.slug === RAIZ_SNACKS));
    setCategoriaId(c.id);
    setErrores((e) => ({ ...e, categoria: undefined }));
    avisar({ tono: 'ok', titulo: `Categoría «${c.nombre}» creada` });
    refNombre.current?.focus();
  };

  // Aviso de duplicado en vivo: nombre normalizado igual a uno del caché. No bloquea.
  const duplicado: ProductoCache | undefined = useMemo(() => {
    const q = normalizar(nombre);
    if (q.length < 3) return undefined;
    return buscarLocal(nombre).find((p) => normalizar(p.nombre) === q);
  }, [nombre]);

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    const nuevosErrores: typeof errores = {};
    if (!nombre.trim()) nuevosErrores.nombre = 'Escribe el nombre del producto.';
    if (precio === '') nuevosErrores.precio = 'Escribe el precio de venta.';
    if (!categoriaId) nuevosErrores.categoria = 'Elige la categoría.';
    setErrores(nuevosErrores);
    if (Object.keys(nuevosErrores).length > 0) return;

    const tipo: TipoProducto = TIPO_POR_RAIZ[RAIZ_SNACKS]!; // todas las opciones cuelgan de Snacks

    setGuardando(true);
    setErrorServidor(null);
    try {
      const creado = await api<{ sku: string }>('/productos', {
        method: 'POST',
        body: JSON.stringify({
          nombre: nombre.trim(),
          tipo,
          categoriaId,
          precioVenta: precio,
          codigoBarras: codigoBarras.trim() || null,
        }),
      });
      // Guardar y otro: limpia nombre/precio/código, MANTIENE la categoría, foco al nombre.
      setNombre('');
      setPrecio('');
      setCodigoBarras('');
      setExito(`Guardado como ${creado.sku}.`);
      refNombre.current?.focus();
      void refrescarCatalogo(); // así el próximo aviso de duplicado ya lo conoce
    } catch (err) {
      if (err instanceof ErrorApi && err.codigo === 'SKU_DUPLICADO') {
        setErrorServidor('Ese SKU ya existe. Revisa el producto en el listado.');
      } else {
        setErrorServidor('Algo salió mal. Si vuelve a pasar, anota la hora y avisa.');
      }
    } finally {
      setGuardando(false);
    }
  };

  // Confirmación de 2 s con el código asignado (V6).
  useEffect(() => {
    if (!exito) return;
    const id = setTimeout(() => setExito(null), 2000);
    return () => clearTimeout(id);
  }, [exito]);

  return (
    <div className="mx-auto w-full max-w-[560px] p-4">
      <Encabezado titulo="Alta rápida de snack" subtitulo="Enter guarda y deja listo el siguiente." />
      {cargadas && !raiz ? (
        <div className="mb-4">
          <Banner tono="alerta">No existe la categoría «Snacks». Revisa las semillas en Sistema.</Banner>
        </div>
      ) : null}
      <form onSubmit={(e) => void guardar(e)} className="flex flex-col gap-4 rounded-tarjeta bg-bg p-5 shadow-tarjeta">
        <div>
          <Campo
            etiqueta="Nombre"
            placeholder="Coca-Cola lata 350 cc"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            error={errores.nombre}
            refInput={refNombre}
            autoFocus
          />
          {duplicado ? (
            <p className="mt-1 text-chico text-alerta">
              Ya existe «{duplicado.nombre}» a {clp(duplicado.precioVenta)}.{' '}
              <Link to={`/admin/productos?q=${encodeURIComponent(duplicado.nombre)}`} className="underline">
                Verlo en Productos
              </Link>
            </p>
          ) : null}
        </div>
        <CampoMonto etiqueta="Precio de venta" valor={precio} onValor={setPrecio} error={errores.precio} />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Selecto
              etiqueta="Categoría"
              valor={categoriaId}
              onValor={setCategoriaId}
              opciones={opciones.map((o) => ({ valor: o.id, etiqueta: o.etiqueta }))}
              vacia="Elige una categoría…"
              error={errores.categoria}
            />
          </div>
          <div className={errores.categoria ? 'mb-[22px]' : undefined}>
            <Boton ajustado onClick={() => setNuevaAbierta(true)} deshabilitado={!raiz || !enLinea}>
              + Nueva categoría
            </Boton>
          </div>
        </div>
        <Campo
          etiqueta="Código de barras (opcional)"
          placeholder="Escanéalo aquí"
          value={codigoBarras}
          onChange={(e) => setCodigoBarras(e.target.value)}
        />

        {errorServidor ? <Banner tono="peligro">{errorServidor}</Banner> : null}
        {exito ? <Banner tono="ok">{exito}</Banner> : null}

        <Boton
          type="submit"
          variante="principal"
          tamano="grande"
          cargando={guardando}
          deshabilitado={!enLinea}
          motivoDeshabilitado={!enLinea ? 'Necesitas conexión para esto.' : undefined}
        >
          Guardar y otro
        </Boton>
      </form>
      <DialogoNuevaCategoria abierto={nuevaAbierta} padre={raiz} onCerrar={() => setNuevaAbierta(false)} onCreada={(c) => void alCrearCategoria(c)} />
    </div>
  );
}
