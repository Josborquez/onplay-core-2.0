// 2.0 §5.5 — «Sistema»: lo que antes eran comandos de terminal, ahora dentro de la pantalla
// Sincronización (sin pantalla nueva): estado de migraciones, respaldos (generar y descargar),
// usuarios (crear y activar/desactivar, H1 mínimo) y renumeración IND- (R-010). Solo admin.
import { useCallback, useEffect, useState } from 'react';
import { ErrorApi, api, descargar } from '../../api.js';
import { Banner, Boton, Campo, Cargando, Insignia } from '../../components/base.js';
import { useConfirmar } from '../../components/Confirmar.js';
import { fecha, hora } from '../../utils/formato.js';

interface Migraciones {
  directorio: string;
  aplicadas: string[];
  pendientes: string[];
  fallidas: string[];
  conflictos: { nombre: string }[];
  alDia: boolean;
}

interface Respaldos {
  directorio: string;
  retencion: number;
  cron: string;
  respaldos: { id: string; bytes: number; creadoEn: string }[];
}

interface UsuarioAdmin {
  id: string;
  nombre: string;
  email: string;
  rol: 'vendedor' | 'encargado' | 'admin';
  activo: boolean;
  debeCambiarClave: boolean;
  creadoEn: string;
}

interface ResumenRenumeracion {
  dryRun: boolean;
  totalInd: number;
  renombrables: number;
  sinForma: number;
  colisiones: number;
  aplicados: number;
  muestra: { de: string; a: string }[];
}

const ROLES: { valor: UsuarioAdmin['rol']; etiqueta: string }[] = [
  { valor: 'vendedor', etiqueta: 'Vendedor' },
  { valor: 'encargado', etiqueta: 'Encargado' },
  { valor: 'admin', etiqueta: 'Administrador' },
];

function kb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

export function Sistema({ usuarioActualId }: { usuarioActualId: string }) {
  const confirmar = useConfirmar();
  const [migraciones, setMigraciones] = useState<Migraciones | null>(null);
  const [respaldos, setRespaldos] = useState<Respaldos | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ email: '', nombre: '', rol: 'vendedor' as UsuarioAdmin['rol'] });
  const [claveInicial, setClaveInicial] = useState<{ email: string; clave: string } | null>(null);
  const [renumeracion, setRenumeracion] = useState<ResumenRenumeracion | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [m, r, u] = await Promise.all([api<Migraciones>('/admin/migraciones'), api<Respaldos>('/admin/respaldos'), api<{ usuarios: UsuarioAdmin[] }>('/admin/usuarios')]);
      setMigraciones(m);
      setRespaldos(r);
      setUsuarios(u.usuarios);
    } catch {
      setError('No se pudo leer el estado del sistema.');
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const correr = async (clave: string, fn: () => Promise<void>) => {
    if (ocupado) return;
    setOcupado(clave);
    setError(null);
    setAviso(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ErrorApi ? `Error ${e.codigo}` : 'La operación falló.');
    } finally {
      setOcupado(null);
    }
  };

  const generarRespaldo = () =>
    correr('respaldo', async () => {
      const r = await api<{ id: string; bytes: number; tablas: number; filas: number }>('/admin/respaldo', { method: 'POST' });
      setAviso(`Respaldo ${r.id} generado: ${r.tablas} tablas, ${r.filas} filas, ${kb(r.bytes)}. Descárgalo y guárdalo fuera de Hostinger.`);
      await cargar();
    });

  const crearUsuario = () =>
    correr('usuario', async () => {
      const r = await api<{ usuario: UsuarioAdmin; passwordInicial: string | null }>('/admin/usuarios', { method: 'POST', body: JSON.stringify(nuevo) });
      setClaveInicial(r.passwordInicial ? { email: r.usuario.email, clave: r.passwordInicial } : null);
      setNuevo({ email: '', nombre: '', rol: 'vendedor' });
      await cargar();
    });

  const conmutarActivo = (u: UsuarioAdmin) =>
    correr(`activo:${u.id}`, async () => {
      const seguro = await confirmar({
        titulo: `¿${u.activo ? 'Desactivar' : 'Activar'} a ${u.nombre}?`,
        cuerpo: u.activo ? `${u.email} no podrá entrar hasta que se vuelva a activar. Sus ventas y registros no se tocan.` : `${u.email} volverá a poder entrar con su clave.`,
        accion: u.activo ? 'Desactivar' : 'Activar',
        tono: u.activo ? 'peligro' : 'principal',
      });
      if (!seguro) return;
      await api(`/admin/usuarios/${u.id}`, { method: 'PATCH', body: JSON.stringify({ activo: !u.activo }) });
      await cargar();
    });

  const renumerar = (dryRun: boolean) =>
    correr('renumerar', async () => {
      if (!dryRun) {
        const seguro = await confirmar({
          titulo: '¿Renumerar los SKU IND- derivables?',
          cuerpo: 'Cada producto renombrado queda auditado. Los SKU publicados en las tiendas no se tocan (P3).',
          accion: 'Renumerar',
          tono: 'principal',
        });
        if (!seguro) return;
      }
      setRenumeracion(await api<ResumenRenumeracion>(`/admin/renumerar-ind?dryRun=${dryRun}`, { method: 'POST' }));
    });

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-cuerpo font-semibold text-lab">Sistema</h2>
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
      {migraciones === null || respaldos === null || usuarios === null ? (
        <Cargando />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
            <div className="flex items-center justify-between gap-2">
              <p className="text-cuerpo font-semibold text-lab">Migraciones</p>
              {migraciones.alDia ? <Insignia tono="ok">Al día</Insignia> : <Insignia tono="peligro">Requiere atención</Insignia>}
            </div>
            <p className="mt-1 text-chico text-lab2">
              {migraciones.aplicadas.length} aplicadas · última {migraciones.aplicadas.at(-1) ?? '—'}
            </p>
            {migraciones.pendientes.length > 0 ? <p className="mt-1 text-chico text-peligro">Pendientes: {migraciones.pendientes.join(', ')} (el arranque las aplica; si sigue aquí, revisa el log)</p> : null}
            {migraciones.fallidas.length > 0 ? <p className="mt-1 text-chico text-peligro">A medias: {migraciones.fallidas.join(', ')} — reparación manual en `_prisma_migrations`</p> : null}
            {migraciones.conflictos.length > 0 ? <p className="mt-1 text-chico text-peligro">Checksum distinto: {migraciones.conflictos.map((c) => c.nombre).join(', ')}</p> : null}
          </div>

          <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
            <div className="flex items-center justify-between gap-2">
              <p className="text-cuerpo font-semibold text-lab">Respaldos</p>
              <div className="w-[190px]">
                <Boton variante="principal" cargando={ocupado === 'respaldo'} onClick={() => void generarRespaldo()}>
                  Generar respaldo
                </Boton>
              </div>
            </div>
            <p className="mt-1 text-chico text-lab2">
              Automático {respaldos.cron ? `«${respaldos.cron}» (hora Chile)` : 'desactivado'} · se conservan {respaldos.retencion} · descarga el semanal y guárdalo fuera de Hostinger
            </p>
            {respaldos.respaldos.length === 0 ? (
              <p className="mt-2 text-chico text-lab2">Todavía no hay respaldos.</p>
            ) : (
              <ul className="mt-2 divide-y divide-sep rounded-campo border border-sep">
                {respaldos.respaldos.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-chico text-lab">{r.id}</p>
                      <p className="text-chico text-lab2">
                        {fecha(r.creadoEn)} {hora(r.creadoEn)} · {kb(r.bytes)}
                      </p>
                    </div>
                    <div className="w-[120px]">
                      <Boton onClick={() => void descargar(`/admin/respaldos/${r.id}`, r.id)}>Descargar</Boton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
            <p className="text-cuerpo font-semibold text-lab">Usuarios</p>
            <ul className="mt-2 divide-y divide-sep rounded-campo border border-sep">
              {usuarios.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-chico text-lab">
                      {u.nombre} <span className="text-lab2">· {u.email}</span>
                    </p>
                    <p className="text-chico text-lab2">
                      {ROLES.find((r) => r.valor === u.rol)?.etiqueta ?? u.rol}
                      {!u.activo ? ' · inactivo' : ''}
                      {u.debeCambiarClave ? ' · debe cambiar la clave' : ''}
                    </p>
                  </div>
                  {u.id !== usuarioActualId ? (
                    <div className="w-[120px]">
                      <Boton variante={u.activo ? 'peligro' : 'secundario'} cargando={ocupado === `activo:${u.id}`} onClick={() => void conmutarActivo(u)}>
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </Boton>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_150px_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                void crearUsuario();
              }}
            >
              <Campo etiqueta="Correo" type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} required />
              <Campo etiqueta="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} required />
              <label className="flex flex-col gap-1 text-chico text-lab2">
                Rol
                <select className="h-tactil rounded-campo border border-sep bg-bg px-3 text-cuerpo text-lab" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value as UsuarioAdmin['rol'] })}>
                  {ROLES.map((r) => (
                    <option key={r.valor} value={r.valor}>
                      {r.etiqueta}
                    </option>
                  ))}
                </select>
              </label>
              <div className="w-[120px]">
                <Boton type="submit" variante="principal" cargando={ocupado === 'usuario'}>
                  Crear
                </Boton>
              </div>
            </form>
            {claveInicial ? (
              <div className="mt-3">
                <Banner tono="alerta">
                  Clave inicial de {claveInicial.email}: <span className="num font-semibold">{claveInicial.clave}</span> — se muestra solo una vez; deberá cambiarla al entrar.
                </Banner>
              </div>
            ) : null}
          </div>

          <div className="rounded-tarjeta bg-bg p-4 shadow-tarjeta">
            <p className="text-cuerpo font-semibold text-lab">Renumerar SKU IND- (R-010)</p>
            <p className="mt-1 text-chico text-lab2">Deriva el SKU maestro de los productos IND- cuyo SKU externo tiene forma Magic. Correr una vez tras la importación inicial.</p>
            <div className="mt-2 flex gap-2">
              <div className="w-[130px]">
                <Boton cargando={ocupado === 'renumerar'} onClick={() => void renumerar(true)}>
                  Simular
                </Boton>
              </div>
              <div className="w-[130px]">
                <Boton variante="secundario" cargando={ocupado === 'renumerar'} onClick={() => void renumerar(false)}>
                  Aplicar
                </Boton>
              </div>
            </div>
            {renumeracion ? (
              <p className="mt-2 text-chico text-lab2">
                {renumeracion.dryRun ? 'Simulación' : 'Aplicado'}: {renumeracion.totalInd} IND- · {renumeracion.renombrables} renombrables · {renumeracion.sinForma} sin forma · {renumeracion.colisiones} colisiones
                {!renumeracion.dryRun ? ` · ${renumeracion.aplicados} renombrados` : ''}
                {renumeracion.muestra.length > 0 ? ` · p. ej. ${renumeracion.muestra[0]!.de} → ${renumeracion.muestra[0]!.a}` : ''}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
