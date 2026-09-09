// V9 — Duplicados (05-SDD §7): dos tarjetas lado a lado, de a un par.
// Nunca hay fusión automática (02-SDD §6.6): "Conservar este" llama a
// POST /productos/:id/fusionar (F11) con el otro como absorbido, previa
// confirmación. "No son el mismo" no tiene endpoint (§14 H6) y no se muestra.
import { useCallback, useEffect, useState } from 'react';
import { api, ErrorApi } from '../../api.js';
import { useEnLinea } from '../../tema.js';
import { ETIQUETA_TIPO, type ProductoAdmin } from '../../tipos.js';
import { clp } from '../../utils/formato.js';
import { Banner, Boton, Cargando, Insignia, Vacio } from '../../components/base.js';
import { Encabezado } from './util.js';

const normalizar = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

interface Par {
  marcado: ProductoAdmin;
  candidato: ProductoAdmin | null;
}

function Tarjeta({
  producto,
  otro,
  ocupado,
  onConservar,
}: {
  producto: ProductoAdmin;
  otro: ProductoAdmin | null;
  ocupado: boolean;
  onConservar: (sobrevive: ProductoAdmin, absorbido: ProductoAdmin) => void;
}) {
  const enLinea = useEnLinea();
  const puedeFusionar = otro !== null && enLinea && !ocupado;
  return (
    <div className="flex-1 rounded-tarjeta border border-sep bg-bg p-4">
      <p className="text-cuerpo text-lab">{producto.nombre}</p>
      <p className="font-mono text-chico text-lab3">{producto.sku}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="num text-cuerpo text-lab">{clp(producto.precioVenta)}</span>
        <Insignia>{ETIQUETA_TIPO[producto.tipo]}</Insignia>
        {!producto.activo ? <Insignia>inactivo</Insignia> : null}
      </div>
      <div className="mt-3">
        <Boton
          deshabilitado={!puedeFusionar}
          cargando={ocupado}
          motivoDeshabilitado={
            otro === null
              ? 'Sin par identificado no hay nada que fusionar.'
              : !enLinea
                ? 'Necesitas conexión para esto.'
                : undefined
          }
          onClick={() => otro && onConservar(producto, otro)}
        >
          Conservar este
        </Boton>
      </div>
    </div>
  );
}

export function Duplicados() {
  const [pares, setPares] = useState<Par[] | null>(null);
  const [error, setError] = useState(false);
  const [errorFusion, setErrorFusion] = useState('');
  const [fusionando, setFusionando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(false);
    try {
      // Los marcados son pocos (§6.6): con tope de 100 alcanza para la revisión.
      const r = await api<{ productos: ProductoAdmin[] }>('/productos?posibleDuplicado=true&limit=100');
      // El par del marcado es el producto ya existente con el mismo nombre normalizado.
      const resultado: Par[] = [];
      for (const marcado of r.productos) {
        const q = encodeURIComponent(marcado.nombre.slice(0, 60));
        const candidatos = await api<{ productos: ProductoAdmin[] }>(`/productos?q=${q}&limit=10`);
        const candidato =
          candidatos.productos.find(
            (p) => p.id !== marcado.id && normalizar(p.nombre) === normalizar(marcado.nombre),
          ) ?? null;
        resultado.push({ marcado, candidato });
      }
      setPares(resultado);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const fusionar = useCallback(
    async (sobrevive: ProductoAdmin, absorbido: ProductoAdmin) => {
      const seguro = window.confirm(
        `Se conserva "${sobrevive.nombre}" (${sobrevive.sku}) y "${absorbido.nombre}" (${absorbido.sku}) quedará inactivo. Sus vínculos con las tiendas pasan al conservado. ¿Fusionar?`,
      );
      if (!seguro) return;
      setErrorFusion('');
      setFusionando(sobrevive.id);
      try {
        await api(`/productos/${sobrevive.id}/fusionar`, {
          method: 'POST',
          body: JSON.stringify({ productoAbsorbidoId: absorbido.id }),
        });
        setPares(null);
        await cargar();
      } catch (e) {
        const detalle = e instanceof ErrorApi && typeof e.cuerpo.detalle === 'string' ? ` ${e.cuerpo.detalle}` : '';
        setErrorFusion(`No se pudo fusionar.${detalle} Intenta de nuevo.`);
      } finally {
        setFusionando(null);
      }
    },
    [cargar],
  );

  return (
    <div className="p-4">
      <Encabezado titulo="Duplicados" />
      {error ? (
        <div className="mb-3">
          <Banner tono="peligro" accion={<Boton onClick={() => void cargar()}>Reintentar</Boton>}>
            No se pudieron cargar los duplicados. Revisa la conexión y vuelve a intentar.
          </Banner>
        </div>
      ) : null}
      {errorFusion ? (
        <div className="mb-3">
          <Banner tono="peligro">{errorFusion}</Banner>
        </div>
      ) : null}
      {pares === null ? (
        <Cargando />
      ) : pares.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje="No hay posibles duplicados pendientes. La próxima importación puede marcar nuevos." />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {pares.map((par) => (
            <div key={par.marcado.id} className="flex flex-col gap-3 sm:flex-row">
              <Tarjeta
                producto={par.marcado}
                otro={par.candidato}
                ocupado={fusionando === par.marcado.id}
                onConservar={(s, a) => void fusionar(s, a)}
              />
              {par.candidato ? (
                <Tarjeta
                  producto={par.candidato}
                  otro={par.marcado}
                  ocupado={fusionando === par.candidato.id}
                  onConservar={(s, a) => void fusionar(s, a)}
                />
              ) : (
                <div className="flex flex-1 items-center rounded-tarjeta border border-sep bg-bg2 p-4">
                  <p className="text-cuerpo text-lab2">
                    No se encontró el par por nombre. Búscalo en Productos antes de decidir.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
