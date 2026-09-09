// V16 (E4 Fase 3) — Ficha de cliente (07-SDD §8): encabezado con saldo en
// tipografía de total (tinta, no color; negativo en --peligro), secciones
// Movimientos / Compras / Cuentas vinculadas, y para el encargado el botón
// "Cargar saldo" que abre el diálogo V17 (premio/ajuste/reverso — la carga
// con dinero va SIEMPRE por una venta de SRV-000001 en el mostrador, §6.3).
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorApi, api } from '../api.js';
import { Banner, Boton, CampoMonto, Cargando, Dialogo, Insignia, Segmentado, Vacio } from '../components/base.js';
import { useSesion } from '../sesion.js';
import {
  ETIQUETA_MOTIVO,
  ETIQUETA_ORIGEN,
  rolAlcanza,
  type CompraCliente,
  type FichaCliente,
  type MotivoMonedero,
  type MovimientoCliente,
  type RespuestaCompras,
  type RespuestaMovimientos,
} from '../tipos.js';
import { clp, fecha, hora } from '../utils/formato.js';

function FilaCompra({ c, esEncargado }: { c: CompraCliente; esEncargado: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="min-w-0">
        <span className="num text-cuerpo text-lab">
          {fecha(c.creadoEn)} · {hora(c.creadoEn)}
        </span>
        {esEncargado && c.folio ? <span className="num ml-2 text-chico text-lab3">{c.folio}</span> : null}
        {esEncargado && c.usuario ? <span className="ml-2 text-chico text-lab3">{c.usuario.nombre}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Insignia>{ETIQUETA_ORIGEN[c.origen] ?? c.origen}</Insignia>
        {c.estado === 'anulada' ? <Insignia tono="peligro">Anulada</Insignia> : null}
        <span className="num font-semibold text-lab">{clp(c.total)}</span>
      </span>
    </li>
  );
}

function FilaMovimiento({ m, esEncargado }: { m: MovimientoCliente; esEncargado: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="min-w-0">
        <span className="num text-cuerpo text-lab">
          {fecha(m.creadoEn)} · {hora(m.creadoEn)}
        </span>
        <span className="ml-2 text-cuerpo text-lab2">{ETIQUETA_MOTIVO[m.motivo] ?? m.motivo}</span>
        {esEncargado && m.usuario ? <span className="ml-2 text-chico text-lab3">{m.usuario.nombre}</span> : null}
        {m.nota ? <span className="ml-2 truncate text-chico text-lab3">{m.nota}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <span className={`num font-semibold ${m.monto < 0 ? 'text-peligro' : 'text-lab'}`}>
          {m.monto > 0 ? '+' : ''}
          {clp(m.monto)}
        </span>
        <span className="num w-[90px] text-right text-chico text-lab3">{clp(m.saldoDespues)}</span>
      </span>
    </li>
  );
}

/** V17 — Cargar saldo (encargado): premio/ajuste/reverso. Sin "carga": esa va por venta (§6.3). */
function DialogoMovimiento({
  abierto,
  saldo,
  guardando,
  errorApi,
  onCerrar,
  onGuardar,
}: {
  abierto: boolean;
  saldo: number;
  guardando: boolean;
  errorApi: string;
  onCerrar: () => void;
  onGuardar: (motivo: MotivoMonedero, monto: number, nota: string) => void;
}) {
  const [motivo, setMotivo] = useState<MotivoMonedero>('premio_evento');
  const [monto, setMonto] = useState<number | ''>('');
  const [resta, setResta] = useState(false);
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!abierto) return;
    setMotivo('premio_evento');
    setMonto('');
    setResta(false);
    setNota('');
    setError('');
  }, [abierto]);

  // Signo automático (§7.2): premio suma, reverso resta, ajuste elige.
  const negativo = motivo === 'reverso_carga' || (motivo === 'ajuste' && resta);
  const firmado = monto === '' ? 0 : negativo ? -monto : monto;
  const notaObligatoria = motivo === 'ajuste' || motivo === 'reverso_carga';

  const guardar = () => {
    if (monto === '' || monto <= 0) {
      setError('El monto debe ser mayor que $0.');
      return;
    }
    if (notaObligatoria && nota.trim() === '') {
      setError('Un ajuste o reverso sin explicación es un agujero en la auditoría: la nota es obligatoria.');
      return;
    }
    setError('');
    onGuardar(motivo, firmado, nota.trim());
  };

  return (
    <Dialogo abierto={abierto} titulo="Cargar saldo" onCerrar={onCerrar} cerrable={!guardando} ancho={480}>
      <p className="mb-3 text-chico text-lab2">
        La carga con dinero se hace como una venta de «Carga de saldo» en el mostrador y pasa por la caja.
        Aquí solo van los movimientos sin dinero.
      </p>
      <Segmentado
        opciones={[
          { valor: 'premio_evento', etiqueta: 'Premio de evento' },
          { valor: 'ajuste', etiqueta: 'Ajuste' },
          { valor: 'reverso_carga', etiqueta: 'Reverso de carga' },
        ]}
        valor={motivo}
        onChange={(v) => {
          if (v) setMotivo(v);
        }}
      />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <CampoMonto etiqueta="Monto" valor={monto} onValor={setMonto} />
        {motivo === 'ajuste' ? (
          <div>
            <p className="mb-1 text-chico text-lab2">Sentido</p>
            <Segmentado
              opciones={[
                { valor: 'sumar', etiqueta: 'Sumar' },
                { valor: 'restar', etiqueta: 'Restar' },
              ]}
              valor={resta ? 'restar' : 'sumar'}
              onChange={(v) => setResta(v === 'restar')}
            />
          </div>
        ) : (
          <div />
        )}
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-chico text-lab2">
          Nota{notaObligatoria ? '' : ' (opcional)'}
        </label>
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          className="w-full rounded-campo border border-sep bg-bg p-3 text-cuerpo text-lab outline-none"
          placeholder={notaObligatoria ? 'Por qué se hace este movimiento (obligatoria).' : 'Detalle del premio.'}
        />
      </div>
      {monto !== '' && monto > 0 ? (
        <p className="num mt-2 text-cuerpo text-lab2">
          El saldo pasará de {clp(saldo)} a{' '}
          <span className={saldo + firmado < 0 ? 'text-peligro' : 'text-lab'}>{clp(saldo + firmado)}</span>.
        </p>
      ) : null}
      {error || errorApi ? (
        <div className="mt-3">
          <Banner tono="peligro">{error || errorApi}</Banner>
        </div>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Boton onClick={onCerrar} deshabilitado={guardando}>
          Cancelar
        </Boton>
        <Boton variante="principal" cargando={guardando} onClick={guardar}>
          Guardar movimiento
        </Boton>
      </div>
    </Dialogo>
  );
}

export function Cliente() {
  const { id } = useParams<{ id: string }>();
  const { usuario } = useSesion();
  const [ficha, setFicha] = useState<FichaCliente | null | 'cargando'>('cargando');
  const [compras, setCompras] = useState<RespuestaCompras | null>(null);
  const [movimientos, setMovimientos] = useState<RespuestaMovimientos | null>(null);
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorMovimiento, setErrorMovimiento] = useState('');
  const [desvinculando, setDesvinculando] = useState<string | null>(null);
  const [errorVinculo, setErrorVinculo] = useState('');

  const cargar = useCallback(() => {
    if (!id) return;
    void api<FichaCliente>(`/clientes/${id}`)
      .then(setFicha)
      .catch(() => setFicha(null));
    void api<RespuestaCompras>(`/clientes/${id}/compras`)
      .then(setCompras)
      .catch(() => setCompras(null));
    void api<RespuestaMovimientos>(`/clientes/${id}/movimientos`)
      .then(setMovimientos)
      .catch(() => setMovimientos(null));
  }, [id]);

  useEffect(() => {
    setFicha('cargando');
    setCompras(null);
    setMovimientos(null);
    cargar();
  }, [cargar]);

  const guardarMovimiento = (motivo: MotivoMonedero, monto: number, nota: string) => {
    if (!id) return;
    setGuardando(true);
    setErrorMovimiento('');
    api(`/clientes/${id}/monedero`, {
      method: 'POST',
      body: JSON.stringify({ motivo, monto, nota: nota || undefined }),
    })
      .then(() => {
        setDialogoAbierto(false);
        cargar();
      })
      .catch((e: unknown) => {
        const detalle = e instanceof ErrorApi && typeof e.cuerpo.detalle === 'string' ? ` ${e.cuerpo.detalle}` : '';
        setErrorMovimiento(`No se pudo guardar el movimiento.${detalle}`);
      })
      .finally(() => setGuardando(false));
  };

  // §7.3 (criterio 20): desvincular NO borra — la API marca desvinculadoEn.
  const desvincular = (canalId: string, cuenta: string) => {
    if (!id) return;
    const seguro = window.confirm(
      `Se desvincula la cuenta ${cuenta}. El historial no se borra y la importación no la volverá a vincular sola. ¿Desvincular?`,
    );
    if (!seguro) return;
    setErrorVinculo('');
    setDesvinculando(canalId);
    api(`/clientes/${id}/desvincular`, { method: 'POST', body: JSON.stringify({ canalId }) })
      .then(() => cargar())
      .catch((e: unknown) => {
        const detalle = e instanceof ErrorApi && typeof e.cuerpo.detalle === 'string' ? ` ${e.cuerpo.detalle}` : '';
        setErrorVinculo(`No se pudo desvincular.${detalle}`);
      })
      .finally(() => setDesvinculando(null));
  };

  if (ficha === 'cargando') return <Cargando />;
  if (!ficha) {
    return (
      <div className="p-8">
        <Vacio
          mensaje="No se encontró ese cliente."
          accion={
            <Link to="/" className="text-cuerpo text-lab2 underline">
              Volver al mostrador
            </Link>
          }
        />
      </div>
    );
  }

  const esEncargado = usuario ? rolAlcanza(usuario.rol, 'encargado') : false;
  const vinculadas = ficha.canales.filter((c) => c.desvinculadoEn === null);

  return (
    <div className="mx-auto max-w-[720px] p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-tit text-lab">{ficha.nombre}</h1>
          <p className="mt-1 flex flex-wrap gap-x-3 text-chico text-lab2">
            {ficha.rut ? <span className="num">{ficha.rut}</span> : null}
            {ficha.telefono ? <span className="num">{ficha.telefono}</span> : null}
            {ficha.email ? <span>{ficha.email}</span> : null}
            {!ficha.activo ? <Insignia tono="peligro">Inactivo</Insignia> : null}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-chico text-lab2">Saldo</p>
          <p className={`num text-total font-semibold ${ficha.saldo < 0 ? 'text-peligro' : 'text-lab'}`}>
            {clp(ficha.saldo)}
          </p>
          {ficha.saldo < 0 ? <p className="text-chico text-peligro">debe {clp(-ficha.saldo)}</p> : null}
          {esEncargado ? (
            <div className="mt-2">
              <Boton onClick={() => setDialogoAbierto(true)}>Cargar saldo</Boton>
            </div>
          ) : null}
        </div>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 text-cuerpo font-semibold text-lab">Movimientos</h2>
        {movimientos === null ? (
          <Cargando />
        ) : movimientos.movimientos.length === 0 ? (
          <Vacio mensaje="Este cliente todavía no tiene movimientos de saldo." />
        ) : (
          <ul className="divide-y divide-sep rounded-campo border border-sep">
            {movimientos.movimientos.map((m) => (
              <FilaMovimiento key={m.id} m={m} esEncargado={esEncargado} />
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-cuerpo font-semibold text-lab">Compras</h2>
        {compras === null ? (
          <Cargando />
        ) : compras.compras.length === 0 ? (
          <Vacio mensaje="Este cliente todavía no tiene compras." />
        ) : (
          <>
            <ul className="divide-y divide-sep rounded-campo border border-sep">
              {compras.compras.map((c, i) => (
                <FilaCompra key={c.id ?? i} c={c} esEncargado={esEncargado} />
              ))}
            </ul>
            {compras.total > compras.compras.length ? (
              <p className="mt-2 text-chico text-lab3">
                Mostrando {compras.compras.length} de {compras.total}.
              </p>
            ) : null}
            {!compras.pedidosDisponibles ? (
              <p className="mt-2 text-chico text-lab3">
                Los pedidos de las tiendas web aparecerán cuando llegue la sincronización de pedidos (E3).
              </p>
            ) : null}
          </>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-cuerpo font-semibold text-lab">Cuentas vinculadas</h2>
        {errorVinculo ? (
          <div className="mb-2">
            <Banner tono="peligro">{errorVinculo}</Banner>
          </div>
        ) : null}
        {vinculadas.length === 0 ? (
          <Vacio mensaje="Sin cuentas de las tiendas web vinculadas." />
        ) : (
          <ul className="divide-y divide-sep rounded-campo border border-sep">
            {vinculadas.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-cuerpo text-lab">{c.externoEmail ?? `Usuario ${c.externoUserId}`}</span>
                <span className="flex items-center gap-2">
                  <Insignia>{ETIQUETA_ORIGEN[c.canalId] ?? c.canalId}</Insignia>
                  <span className="num text-chico text-lab3">desde {fecha(c.vinculadoEn)}</span>
                  {esEncargado ? (
                    <Boton
                      cargando={desvinculando === c.canalId}
                      deshabilitado={desvinculando !== null}
                      onClick={() => desvincular(c.canalId, c.externoEmail ?? `usuario ${c.externoUserId}`)}
                    >
                      Desvincular
                    </Boton>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DialogoMovimiento
        abierto={dialogoAbierto}
        saldo={ficha.saldo}
        guardando={guardando}
        errorApi={errorMovimiento}
        onCerrar={() => {
          setDialogoAbierto(false);
          setErrorMovimiento('');
        }}
        onGuardar={guardarMovimiento}
      />
    </div>
  );
}
