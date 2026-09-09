// Auditoría (02-SDD §8, encargado+). 05-SDD la marca bloqueada por §14 H2,
// pero GET /auditoria existe en el contrato desde la Fase 3: H2 quedó resuelto.
// La bitácora humana: quién hizo qué y con qué valores (§4.1).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { clp, fecha, hora } from '../../utils/formato.js';
import { Banner, Boton, Cargando, Insignia, Vacio } from '../../components/base.js';
import { Encabezado, Paginacion, Selecto } from './util.js';

interface Registro {
  id: string;
  usuario: { id: string; nombre: string; email: string };
  entidad: string;
  entidadId: string;
  accion: string;
  valorAnterior: Record<string, unknown> | null;
  valorNuevo: Record<string, unknown> | null;
  creadoEn: string;
}

const ENTIDADES = [
  { valor: 'producto', etiqueta: 'Producto' },
  { valor: 'venta', etiqueta: 'Venta' },
  { valor: 'turno_caja', etiqueta: 'Turno de caja' },
];

const ACCIONES = [
  { valor: 'crear', etiqueta: 'Crear' },
  { valor: 'editar', etiqueta: 'Editar' },
  { valor: 'cambiar_precio', etiqueta: 'Cambiar precio' },
  { valor: 'anular', etiqueta: 'Anular' },
  { valor: 'abrir_turno', etiqueta: 'Abrir turno' },
  { valor: 'cerrar_turno', etiqueta: 'Cerrar turno' },
];

const ETIQUETA_ACCION = Object.fromEntries(ACCIONES.map((a) => [a.valor, a.etiqueta]));

/** El cambio de precio se muestra legible; el resto, como JSON plegado. */
function Cambio({ registro }: { registro: Registro }) {
  if (
    registro.accion === 'cambiar_precio' &&
    typeof registro.valorAnterior?.precioVenta === 'number' &&
    typeof registro.valorNuevo?.precioVenta === 'number'
  ) {
    return (
      <span className="num text-chico text-lab2">
        {clp(registro.valorAnterior.precioVenta)} → {clp(registro.valorNuevo.precioVenta)}
      </span>
    );
  }
  if (!registro.valorAnterior && !registro.valorNuevo) return null;
  return (
    <details>
      <summary className="cursor-pointer text-chico text-lab3">Valores</summary>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-chico text-lab2">
        {JSON.stringify({ anterior: registro.valorAnterior, nuevo: registro.valorNuevo }, null, 2)}
      </pre>
    </details>
  );
}

export function Auditoria() {
  const [entidad, setEntidad] = useState('');
  const [accion, setAccion] = useState('');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<{ total: number; porPagina: number; registros: Registro[] } | null>(null);
  const [error, setError] = useState(false);

  const cargar = useCallback(async () => {
    setError(false);
    const p = new URLSearchParams({ pagina: String(pagina) });
    if (entidad) p.set('entidad', entidad);
    if (accion) p.set('accion', accion);
    try {
      setDatos(await api<{ total: number; porPagina: number; registros: Registro[] }>(`/auditoria?${p}`));
    } catch {
      setError(true);
    }
  }, [entidad, accion, pagina]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="p-4">
      <Encabezado titulo="Auditoría" />

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-[176px]">
          <Selecto
            etiqueta="Entidad"
            valor={entidad}
            onValor={(v) => {
              setEntidad(v);
              setPagina(1);
            }}
            opciones={ENTIDADES}
            vacia="Todas"
          />
        </div>
        <div className="w-[176px]">
          <Selecto
            etiqueta="Acción"
            valor={accion}
            onValor={(v) => {
              setAccion(v);
              setPagina(1);
            }}
            opciones={ACCIONES}
            vacia="Todas"
          />
        </div>
      </div>

      {error ? (
        <div className="mb-3">
          <Banner tono="peligro" accion={<Boton onClick={() => void cargar()}>Reintentar</Boton>}>
            No se pudo cargar la auditoría. Revisa la conexión y vuelve a intentar.
          </Banner>
        </div>
      ) : null}

      {datos === null ? (
        <Cargando />
      ) : datos.registros.length === 0 ? (
        <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
          <Vacio mensaje="No hay registros con estos filtros." />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-sep overflow-hidden rounded-tarjeta bg-bg shadow-tarjeta">
            {datos.registros.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-chico text-lab3">
                    {fecha(r.creadoEn)} {hora(r.creadoEn)}
                  </span>
                  <span className="text-cuerpo text-lab">{r.usuario.nombre}</span>
                  <Insignia>{ETIQUETA_ACCION[r.accion] ?? r.accion}</Insignia>
                  <span className="text-chico text-lab2">{r.entidad}</span>
                  <span className="font-mono text-chico text-lab3">{r.entidadId}</span>
                </div>
                <div className="mt-1">
                  <Cambio registro={r} />
                </div>
              </li>
            ))}
          </ul>
          <Paginacion pagina={pagina} porPagina={datos.porPagina} total={datos.total} onPagina={setPagina} />
        </>
      )}
    </div>
  );
}
