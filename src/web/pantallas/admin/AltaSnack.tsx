// V6 — Alta rápida de snack (05-SDD §7): 50 productos seguidos sin tocar el mouse.
// Enter = Guardar y otro (mantiene la categoría, foco al nombre). El tipo se
// deriva de la categoría y SIEMPRE se envía explícito: sin él nacería
// `indeterminado` y el SKU saldría IND-… en vez de SNK-… (02-SDD §6.4).
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ErrorApi } from '../../api.js';
import { buscarLocal, categorias, hidratarCatalogo, refrescarCatalogo, type ProductoCache } from '../../catalogo.js';
import { useEnLinea } from '../../tema.js';
import type { TipoProducto } from '../../tipos.js';
import { clp } from '../../utils/formato.js';
import { Banner, Boton, Campo, CampoMonto } from '../../components/base.js';
import { aplanarCategorias, Encabezado, Selecto, type OpcionCategoria } from './util.js';

/** Raíz del árbol de categorías → tipo del producto (02-SDD §6.3). */
const TIPO_POR_RAIZ: Record<string, TipoProducto> = {
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

export function AltaSnack() {
  const [opciones, setOpciones] = useState<OpcionCategoria[]>([]);
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
    void categorias().then((arbol) => setOpciones(aplanarCategorias(arbol)));
  }, []);

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

    const opcion = opciones.find((o) => o.id === categoriaId)!;
    const tipo: TipoProducto = TIPO_POR_RAIZ[opcion.raizSlug] ?? 'indeterminado';

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
    <div className="p-4">
      <Encabezado titulo="Alta rápida de snack" />
      <form onSubmit={(e) => void guardar(e)} className="flex max-w-[480px] flex-col gap-4 rounded-tarjeta bg-bg p-4 shadow-tarjeta">
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
        <Selecto
          etiqueta="Categoría"
          valor={categoriaId}
          onValor={setCategoriaId}
          opciones={opciones.map((o) => ({ valor: o.id, etiqueta: o.etiqueta }))}
          vacia="Elige una categoría…"
          error={errores.categoria}
        />
        <Campo
          etiqueta="Código de barras (opcional)"
          placeholder="Escanéalo aquí"
          value={codigoBarras}
          onChange={(e) => setCodigoBarras(e.target.value)}
          ayuda="Enter en cualquier campo guarda y prepara el siguiente."
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
    </div>
  );
}
