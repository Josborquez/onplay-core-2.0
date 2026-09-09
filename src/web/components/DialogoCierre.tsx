// V4 — Cierre de caja (05-SDD §7.3): arqueo con desglose completo, nota
// obligatoria si hay diferencia, advertencia de irreversibilidad e impresión.
import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api.js';
import { ETIQUETA_MEDIO, type MedioPago, type ResumenTurno, type Turno } from '../tipos.js';
import { clp, fecha, hora } from '../utils/formato.js';
import { Banner, Boton, CampoMonto, Cargando, Dialogo } from './base.js';

interface Props {
  abierto: boolean;
  turno: Turno;
  onCerrar: () => void;
  onCerrado: () => void;
}

export function DialogoCierre({ abierto, turno, onCerrar, onCerrado }: Props) {
  const [resumen, setResumen] = useState<ResumenTurno | null>(null);
  const [declarado, setDeclarado] = useState<number | ''>('');
  const [notas, setNotas] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [cerrado, setCerrado] = useState<Turno | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setResumen(null);
    setDeclarado('');
    setNotas('');
    setError('');
    setEnviando(false);
    setCerrado(null);
    void api<ResumenTurno>(`/turnos/${turno.id}/resumen`)
      .then(setResumen)
      .catch(() => setError('No se pudo cargar el resumen del turno.'));
  }, [abierto, turno.id]);

  const efectivoVentas =
    resumen?.totalesPorMedio.find((m) => m.medio === 'efectivo')?.total ?? 0;
  // E2 §6.7: el servidor ya aplica devoluciones e ingresos/retiros de caja.
  const esperado = resumen?.montoEsperado ?? (resumen?.montoApertura ?? 0) + efectivoVentas;
  const diferencia = declarado === '' ? null : declarado - esperado;
  const notaFalta = diferencia !== null && diferencia !== 0 && notas.trim() === '';

  const motivo =
    declarado === ''
      ? 'Cuenta el efectivo y escribe el monto.'
      : notaFalta
        ? 'Escribe una nota explicando la diferencia.'
        : undefined;

  const cerrarTurno = async () => {
    if (declarado === '' || notaFalta || enviando) return;
    setEnviando(true);
    setError('');
    try {
      const r = await api<Turno>(`/turnos/${turno.id}/cerrar`, {
        method: 'POST',
        body: JSON.stringify({ montoDeclarado: declarado, notas: notas.trim() || undefined }),
      });
      setCerrado(r);
    } catch (e) {
      const detalle = e instanceof ErrorApi && typeof e.cuerpo.detalle === 'string' ? ` ${e.cuerpo.detalle}` : '';
      setError(`No se pudo cerrar el turno.${detalle}`);
      setEnviando(false);
    }
  };

  const filaMedio = (medio: MedioPago, total: number) => (
    <div key={medio} className="num flex items-center justify-between text-cuerpo text-lab">
      <span className="text-lab2">{ETIQUETA_MEDIO[medio]}</span>
      <span>{clp(total)}</span>
    </div>
  );

  return (
    <>
    <Dialogo
      abierto={abierto}
      titulo={cerrado ? 'Turno cerrado' : 'Cerrar caja'}
      onCerrar={cerrado ? onCerrado : onCerrar}
      cerrable={!enviando}
      ancho={480}
    >
      {!resumen && !error ? (
        <Cargando texto="Cargando el resumen…" />
      ) : cerrado ? (
        <div>
          <div className="mb-3 text-chico text-lab2">
            Cierre del {fecha(cerrado.cerradoEn ?? '')} a las {hora(cerrado.cerradoEn ?? '')}
          </div>
          <div className="flex flex-col gap-1 border-b border-sep pb-3">
            {resumen?.totalesPorMedio.map((m) => filaMedio(m.medio, m.total))}
            <div className="num mt-1 flex items-center justify-between font-semibold text-lab">
              <span>Total vendido · {resumen?.cantidadVentas} ventas</span>
              <span>{clp(resumen?.totalVendido ?? 0)}</span>
            </div>
          </div>
          <div className="num mt-3 flex flex-col gap-1 text-cuerpo text-lab">
            <div className="flex justify-between"><span className="text-lab2">Monto de apertura</span><span>{clp(cerrado.montoApertura)}</span></div>
            <div className="flex justify-between"><span className="text-lab2">+ Ventas en efectivo</span><span>{clp(efectivoVentas)}</span></div>
            {resumen?.devolucionesEfectivo ? <div className="flex justify-between"><span className="text-lab2">− Devoluciones en efectivo</span><span>{clp(resumen.devolucionesEfectivo)}</span></div> : null}
            {resumen?.ingresosCaja ? <div className="flex justify-between"><span className="text-lab2">+ Ingresos de caja</span><span>{clp(resumen.ingresosCaja)}</span></div> : null}
            {resumen?.retirosCaja ? <div className="flex justify-between"><span className="text-lab2">− Retiros de caja</span><span>{clp(resumen.retirosCaja)}</span></div> : null}
            <div className="flex justify-between border-t border-sep pt-1 font-semibold"><span>Debería haber</span><span>{clp(cerrado.montoEsperado ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-lab2">Declarado</span><span>{clp(cerrado.montoDeclarado ?? 0)}</span></div>
          </div>
          <div className="mt-3">
            {cerrado.diferencia === 0 ? (
              <Banner tono="ok">La caja cuadra.</Banner>
            ) : (
              <Banner tono="alerta">
                Diferencia: {clp(cerrado.diferencia ?? 0)} (
                {(cerrado.diferencia ?? 0) < 0 ? 'falta' : 'sobra'} efectivo)
              </Banner>
            )}
          </div>
          {cerrado.notas ? <p className="mt-2 text-chico text-lab2">Nota: {cerrado.notas}</p> : null}
          <div className="no-imprimir mt-4 grid grid-cols-2 gap-3">
            <Boton onClick={() => window.print()}>Imprimir</Boton>
            <Boton variante="principal" onClick={onCerrado}>Listo</Boton>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {resumen ? (
            <>
              <div className="flex flex-col gap-1 rounded-campo border border-sep p-3">
                {resumen.totalesPorMedio.length === 0 ? (
                  <p className="text-cuerpo text-lab3">No hubo ventas en este turno.</p>
                ) : (
                  resumen.totalesPorMedio.map((m) => filaMedio(m.medio, m.total))
                )}
                <div className="num mt-1 flex items-center justify-between border-t border-sep pt-1 text-cuerpo font-semibold text-lab">
                  <span>{resumen.cantidadVentas} ventas · ticket promedio {clp(resumen.ticketPromedio)}</span>
                  <span>{clp(resumen.totalVendido)}</span>
                </div>
              </div>

              <div className="num flex flex-col gap-1 rounded-campo border border-sep p-3 text-cuerpo text-lab">
                <div className="flex justify-between"><span className="text-lab2">Monto de apertura</span><span>{clp(resumen.montoApertura)}</span></div>
                <div className="flex justify-between"><span className="text-lab2">+ Ventas en efectivo</span><span>{clp(efectivoVentas)}</span></div>
                <div className="flex justify-between border-t border-sep pt-1 font-semibold"><span>Debería haber</span><span>{clp(esperado)}</span></div>
              </div>

              <CampoMonto
                etiqueta="Efectivo contado al cierre"
                valor={declarado}
                onValor={setDeclarado}
                autoFocus
              />

              {diferencia !== null ? (
                diferencia === 0 ? (
                  <Banner tono="ok">La caja cuadra.</Banner>
                ) : (
                  <Banner tono="alerta">
                    Diferencia: {clp(diferencia)} ({diferencia < 0 ? 'falta' : 'sobra'} efectivo)
                  </Banner>
                )
              ) : null}

              {diferencia !== null && diferencia !== 0 ? (
                <div>
                  <label htmlFor="nota-cierre" className="mb-1 block text-chico text-lab2">
                    Nota (obligatoria con diferencia)
                  </label>
                  <textarea
                    id="nota-cierre"
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    rows={2}
                    className="w-full rounded-campo border border-sep bg-bg p-3 text-lab outline-none"
                  />
                </div>
              ) : null}

              {error ? <Banner tono="peligro">{error}</Banner> : null}

              <p className="text-chico text-lab3">Al cerrar no se pueden registrar más ventas en este turno.</p>
              <Boton
                variante="principal"
                tamano="grande"
                cargando={enviando}
                deshabilitado={motivo !== undefined}
                motivoDeshabilitado={motivo}
                onClick={() => void cerrarTurno()}
              >
                Cerrar el turno
              </Boton>
            </>
          ) : (
            <Banner tono="peligro">{error}</Banner>
          )}
        </div>
      )}
    </Dialogo>

    {/* Resumen imprimible en blanco y negro (05-SDD V4): lo único visible al imprimir. */}
    {cerrado && abierto ? (
      <div className="solo-imprimir" style={{ color: '#000', background: '#fff', fontFamily: 'monospace' }}>
        <h1 style={{ fontSize: 16, marginBottom: 8 }}>OnPlay · Cierre de caja</h1>
        <p>
          {fecha(cerrado.cerradoEn ?? '')} · {hora(cerrado.cerradoEn ?? '')}
        </p>
        <hr />
        {resumen?.totalesPorMedio.map((m) => (
          <p key={m.medio}>
            {ETIQUETA_MEDIO[m.medio]}: {clp(m.total)}
          </p>
        ))}
        <p>Total vendido ({resumen?.cantidadVentas} ventas): {clp(resumen?.totalVendido ?? 0)}</p>
        <hr />
        <p>Monto de apertura: {clp(cerrado.montoApertura)}</p>
        <p>+ Ventas en efectivo: {clp(efectivoVentas)}</p>
        <p>Debería haber: {clp(cerrado.montoEsperado ?? 0)}</p>
        <p>Declarado: {clp(cerrado.montoDeclarado ?? 0)}</p>
        <p>
          {cerrado.diferencia === 0
            ? 'La caja cuadra.'
            : `Diferencia: ${clp(cerrado.diferencia ?? 0)} (${(cerrado.diferencia ?? 0) < 0 ? 'falta' : 'sobra'} efectivo)`}
        </p>
        {cerrado.notas ? <p>Nota: {cerrado.notas}</p> : null}
      </div>
    ) : null}
    </>
  );
}
