// V3 — Cobro (05-SDD §7.2). Teclado dentro del diálogo: foco en Efectivo,
// 1–7 eligen medio, Enter agrega el pago por lo que falta, segundo Enter confirma.
// V15 (E4 §6.2): Monedero solo con cliente asociado y disponible > 0; al
// elegirlo el monto se precarga con min(falta, disponible). La API revalida.
import { useEffect, useRef, useState } from 'react';
import { ErrorApi } from '../api.js';
import { ETIQUETA_MEDIO, MEDIOS_ORDEN, rolAlcanza, type ClienteResumen, type MedioPago, type PagoNuevo, type ReservadoWeb } from '../tipos.js';
import { useSesion } from '../sesion.js';
import { clp } from '../utils/formato.js';
import { Banner, Boton, Campo, CampoMonto, Dialogo, Insignia } from './base.js';
import { SelectorCliente } from './SelectorCliente.js';

const CON_REFERENCIA: MedioPago[] = ['debito', 'credito', 'transferencia'];

interface Exito {
  /** null = quedó encolada sin conexión; el folio lo asigna el servidor al llegar. */
  folio: string | null;
  total: number;
  vuelto: number;
  advertencias: { precio: number; stockNegativo: string[] };
}

type Forzar = { forzarReservado?: { nota: string } };

interface Props {
  abierto: boolean;
  total: number;
  enLinea: boolean;
  /** V15 (E4): cliente asociado a la venta; vive en el Mostrador para llegar al cuerpo. */
  cliente: ClienteResumen | null;
  nombreLibre: string;
  onElegirCliente: (c: ClienteResumen) => void;
  onQuitarCliente: () => void;
  onNombreLibre: (nombre: string) => void;
  onCerrar: () => void;
  /** Hace el POST /ventas y devuelve folio + advertencias. */
  onConfirmar: (pagos: PagoNuevo[], extra?: Forzar) => Promise<{ folio: string; advertencias: Exito['advertencias'] }>;
  /** Sin conexión: encola la venta en IndexedDB (F10). */
  onEncolar: (pagos: PagoNuevo[], extra?: Forzar) => void;
  /** Éxito consumido: limpiar carrito y devolver el foco al buscador. */
  onListo: () => void;
  /** E2 §6.9: productos del carrito que el CACHÉ marca como agotados en la web (uso offline). */
  reservadosCache: ReservadoWeb[];
  onQuitarProducto: (productoId: string) => void;
}

export function DialogoCobro({
  abierto,
  total,
  enLinea,
  cliente,
  nombreLibre,
  onElegirCliente,
  onQuitarCliente,
  onNombreLibre,
  onCerrar,
  onConfirmar,
  onEncolar,
  onListo,
  reservadosCache,
  onQuitarProducto,
}: Props) {
  const { usuario } = useSesion();
  const puedeForzar = rolAlcanza(usuario?.rol ?? 'vendedor', 'encargado');
  // E2 §6.9: bloqueo por pedido web pagado; `reservado` viene del 409 o del caché offline.
  const [reservado, setReservado] = useState<ReservadoWeb | null>(null);
  const [notaForzar, setNotaForzar] = useState('');
  const [medio, setMedio] = useState<MedioPago>('efectivo');
  const [monto, setMonto] = useState<number | ''>('');
  const [recibido, setRecibido] = useState<number | ''>('');
  const [referencia, setReferencia] = useState('');
  const [pagos, setPagos] = useState<PagoNuevo[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState<Exito | null>(null);
  const refEfectivo = useRef<HTMLButtonElement>(null);

  const asignado = pagos.reduce((s, p) => s + p.monto, 0);
  const falta = total - asignado;

  // E4 §6.2: disponible = saldo (+ crédito si lo tiene) menos lo ya asignado a monedero.
  const asignadoMonedero = pagos.filter((p) => p.medio === 'monedero').reduce((s, p) => s + p.monto, 0);
  const disponibleMonedero = cliente
    ? cliente.saldo + (cliente.permiteCredito ? cliente.limiteCredito : 0) - asignadoMonedero
    : 0;
  const monederoHabilitado = cliente !== null && disponibleMonedero > 0;

  // Si el cliente se quita a mitad del cobro, el monedero deja de ser válido.
  useEffect(() => {
    if (cliente) return;
    setPagos((prev) => (prev.some((p) => p.medio === 'monedero') ? prev.filter((p) => p.medio !== 'monedero') : prev));
    setMedio((m) => (m === 'monedero' ? 'efectivo' : m));
  }, [cliente]);

  // Al abrir: estado limpio, monto precargado con el total y foco en Efectivo.
  useEffect(() => {
    if (!abierto) return;
    setMedio('efectivo');
    setMonto(total);
    setRecibido('');
    setReferencia('');
    setPagos([]);
    setEnviando(false);
    setError('');
    setExito(null);
    const id = setTimeout(() => refEfectivo.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [abierto, total]);

  // Éxito: 2 segundos y de vuelta al mostrador (Enter lo adelanta).
  useEffect(() => {
    if (!exito) return;
    const id = setTimeout(onListo, 2000);
    return () => clearTimeout(id);
  }, [exito, onListo]);

  const elegirMedio = (m: MedioPago) => {
    if (m === 'monedero') {
      if (!monederoHabilitado) return;
      // V15: precarga con lo que alcanza a cubrir el saldo.
      setMonto(Math.min(falta, disponibleMonedero));
    }
    setMedio(m);
    setError('');
  };

  const agregarPago = () => {
    const montoNum = monto === '' ? falta : monto;
    if (montoNum <= 0) {
      setError('El monto debe ser mayor que $0.');
      return;
    }
    if (montoNum > falta) {
      setError(`Este pago no puede superar lo que falta (${clp(falta)}).`);
      return;
    }
    if (medio === 'monedero' && montoNum > disponibleMonedero) {
      setError(`El monedero solo tiene ${clp(disponibleMonedero)} disponibles.`);
      return;
    }
    const pago: PagoNuevo = { medio, monto: montoNum };
    if (medio === 'efectivo' && recibido !== '') {
      if (recibido < montoNum) {
        setError('Lo recibido no puede ser menor que el monto en efectivo.');
        return;
      }
      pago.montoRecibido = recibido;
    }
    if (CON_REFERENCIA.includes(medio) && referencia.trim() !== '') {
      pago.referencia = referencia.trim();
    }
    const nuevos = [...pagos, pago];
    setPagos(nuevos);
    setError('');
    setMonto(total - nuevos.reduce((s, p) => s + p.monto, 0));
    setRecibido('');
    setReferencia('');
  };

  const quitarPago = (i: number) => {
    const nuevos = pagos.filter((_, j) => j !== i);
    setPagos(nuevos);
    setMonto(total - nuevos.reduce((s, p) => s + p.monto, 0));
  };

  const vueltoDe = (lista: PagoNuevo[]) =>
    lista.reduce((s, p) => s + (p.montoRecibido != null ? p.montoRecibido - p.monto : 0), 0);

  const encolar = (extra?: Forzar) => {
    onEncolar(pagos, extra);
    setExito({ folio: null, total, vuelto: vueltoDe(pagos), advertencias: { precio: 0, stockNegativo: [] } });
  };

  const confirmar = async (extra?: Forzar) => {
    if (falta !== 0 || enviando) return;
    if (!enLinea) {
      // E2 §6.9 offline: la misma regla con el espejo del caché, salvo que ya venga forzada.
      if (!extra?.forzarReservado && reservadosCache.length > 0) {
        setReservado(reservadosCache[0]!);
        return;
      }
      // F10: sin conexión se encola en IndexedDB, sin ningún diálogo extra.
      encolar(extra);
      return;
    }
    setEnviando(true);
    setError('');
    try {
      const r = await onConfirmar(pagos, extra);
      setReservado(null);
      setExito({ folio: r.folio, total, vuelto: vueltoDe(pagos), advertencias: r.advertencias });
    } catch (e) {
      if (!(e instanceof ErrorApi)) {
        // La red se cayó a mitad del cobro: se encola igual (la idempotencyKey
        // persistida garantiza que si el POST sí llegó, no se duplica).
        encolar(extra);
        return;
      }
      if (e.codigo === 'RESERVADO_WEB') {
        setReservado(e.cuerpo as unknown as ReservadoWeb);
        setEnviando(false);
        return;
      }
      if (e.codigo === 'STOCK_INSUFICIENTE') {
        const c = e.cuerpo as { descripcion?: string | null; disponible?: number; solicitado?: number };
        setError(`Sin stock suficiente de «${c.descripcion ?? 'un producto'}»: quedan ${c.disponible ?? 0} y la venta pide ${c.solicitado ?? '?'}. Ajusta la cantidad.`);
        setEnviando(false);
        return;
      }
      const detalle = typeof e.cuerpo.detalle === 'string' ? ` ${e.cuerpo.detalle}` : '';
      setError(`No se pudo registrar la venta.${detalle} Intenta de nuevo.`);
      setEnviando(false);
    }
  };

  const venderIgual = () => {
    const nota = notaForzar.trim();
    if (!nota) return;
    void confirmar({ forzarReservado: { nota } });
  };

  const quitarReservado = () => {
    if (reservado) onQuitarProducto(reservado.productoId);
    setReservado(null);
    onCerrar();
  };

  const minutosDesde = (iso: string | null) =>
    iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : null;

  const alTeclear = (e: React.KeyboardEvent) => {
    if (exito) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onListo();
      }
      return;
    }
    const enCampo = e.target instanceof HTMLInputElement;
    if (!enCampo && e.key >= '1' && e.key <= '7') {
      const m = MEDIOS_ORDEN[Number(e.key) - 1];
      if (m) {
        e.preventDefault();
        elegirMedio(m);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (reservado) return; // el bloqueo de §6.9 se resuelve con los botones, no con Enter
      if (falta > 0) agregarPago();
      else void confirmar();
    }
  };

  const vueltoVivo = medio === 'efectivo' && recibido !== '' && monto !== '' && recibido >= monto ? recibido - monto : null;

  return (
    <Dialogo
      abierto={abierto}
      titulo={exito ? (exito.folio ? 'Venta registrada' : 'Venta pendiente') : 'Cobrar'}
      onCerrar={exito ? onListo : onCerrar}
      cerrable={!enviando && !exito}
      ancho={480}
    >
      <div onKeyDown={alTeclear}>
        {exito ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            {exito.folio ? (
              <>
                <span aria-hidden="true" className="text-total text-ok">✓</span>
                <p className="text-tit text-lab">{exito.folio}</p>
              </>
            ) : (
              <>
                <span aria-hidden="true" className="text-total text-alerta">⧗</span>
                <p className="text-tit text-lab">Pendiente de enviar</p>
                <p className="text-chico text-lab2">Se enviará sola cuando vuelva la conexión.</p>
              </>
            )}
            <p className="num text-total font-semibold text-lab">{clp(exito.total)}</p>
            {exito.vuelto > 0 ? (
              <p className="num text-tit text-lab">Vuelto: {clp(exito.vuelto)}</p>
            ) : null}
            {exito.advertencias.precio > 0 ? (
              <p className="text-chico text-alerta">
                {exito.advertencias.precio} producto{exito.advertencias.precio > 1 ? 's' : ''} se vendió a un precio
                distinto del catálogo.
              </p>
            ) : null}
            {exito.advertencias.stockNegativo.length > 0 ? (
              <p className="text-chico text-peligro">
                El stock quedó en negativo: {exito.advertencias.stockNegativo.join(', ')}. Avisa al encargado para un recuento.
              </p>
            ) : null}
            <p className="text-chico text-lab3">Enter para seguir vendiendo.</p>
          </div>
        ) : (
          <>
            <p className="num mb-1 text-center text-total font-semibold text-lab">{clp(total)}</p>
            <p className="num mb-4 text-center text-cuerpo text-lab2">
              {falta > 0 ? `Falta por pagar: ${clp(falta)}` : 'Falta por pagar: $0'}
            </p>

            {reservado ? (
              <div className="mb-4 rounded-campo border border-peligro bg-bg p-3">
                <p className="text-cuerpo font-semibold text-peligro">Reservado para un pedido web pagado</p>
                <p className="mt-1 text-chico text-lab">
                  «{reservado.descripcion}» figura agotado en la tienda online
                  {reservado.desdeCache
                    ? ' (dato del caché, sin conexión)'
                    : minutosDesde(reservado.stockCanalEn) !== null
                      ? ` (dato de hace ${minutosDesde(reservado.stockCanalEn)} min)`
                      : ''}
                  . Probablemente lo compró y pagó un cliente web, y ese pedido tiene prioridad sobre la venta en tienda.
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  <Boton variante="principal" onClick={quitarReservado}>
                    Quitar de la venta
                  </Boton>
                  {puedeForzar ? (
                    <>
                      <Campo
                        etiqueta="Vender igual (encargado): motivo"
                        value={notaForzar}
                        onChange={(e) => setNotaForzar(e.target.value)}
                        placeholder="Ej.: cliente en caja, se avisa a la web"
                      />
                      <Boton variante="peligro" deshabilitado={!notaForzar.trim() || enviando} motivoDeshabilitado="Escribe el motivo." onClick={venderIgual}>
                        Vender igual y dejar registro
                      </Boton>
                    </>
                  ) : (
                    <p className="text-chico text-lab3">Solo un encargado puede vender igual, con motivo.</p>
                  )}
                </div>
              </div>
            ) : null}

            <SelectorCliente
              cliente={cliente}
              nombreLibre={nombreLibre}
              enLinea={enLinea}
              onElegir={onElegirCliente}
              onQuitar={onQuitarCliente}
              onNombreLibre={onNombreLibre}
            />

            <div role="group" aria-label="Medio de pago" className="grid grid-cols-3 gap-2">
              {MEDIOS_ORDEN.map((m, i) => {
                const esMonedero = m === 'monedero';
                const deshabilitado = esMonedero && !monederoHabilitado;
                return (
                  <button
                    key={m}
                    type="button"
                    ref={m === 'efectivo' ? refEfectivo : undefined}
                    onClick={() => elegirMedio(m)}
                    disabled={deshabilitado}
                    aria-pressed={medio === m}
                    title={
                      deshabilitado
                        ? cliente
                          ? 'El cliente no tiene saldo disponible.'
                          : 'Asocia un cliente para pagar con monedero.'
                        : undefined
                    }
                    className={`h-tactil rounded-campo border px-2 text-cuerpo ${
                      medio === m
                        ? 'border-ac bg-ac-suave font-semibold text-lab'
                        : deshabilitado
                          ? 'cursor-not-allowed border-sep bg-bg2 text-lab3'
                          : 'border-sep bg-bg text-lab2'
                    }`}
                  >
                    <span aria-hidden="true" className="num mr-1 text-chico text-lab3">{i + 1}</span>
                    {ETIQUETA_MEDIO[m]}
                    {esMonedero && monederoHabilitado ? (
                      <span className="num ml-1 text-chico text-lab3">· {clp(disponibleMonedero)}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <CampoMonto etiqueta="Monto" valor={monto} onValor={setMonto} />
              {medio === 'efectivo' ? (
                <CampoMonto
                  etiqueta="Recibí"
                  valor={recibido}
                  onValor={setRecibido}
                  ayuda={vueltoVivo !== null ? `Vuelto: ${clp(vueltoVivo)}` : 'Opcional, para calcular el vuelto.'}
                />
              ) : CON_REFERENCIA.includes(medio) ? (
                <Campo
                  etiqueta="N° de operación"
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  ayuda="Número del voucher o de la transferencia."
                />
              ) : (
                <div />
              )}
            </div>

            {falta > 0 ? (
              <div className="mt-3">
                <Boton onClick={agregarPago}>Agregar pago · Enter</Boton>
              </div>
            ) : null}

            {pagos.length > 0 ? (
              <ul className="mt-3 divide-y divide-sep rounded-campo border border-sep">
                {pagos.map((p, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2">
                    <span className="text-cuerpo text-lab">
                      {ETIQUETA_MEDIO[p.medio]}
                      {p.montoRecibido != null ? (
                        <span className="ml-2 text-chico text-lab3">
                          recibí {clp(p.montoRecibido)} · vuelto {clp(p.montoRecibido - p.monto)}
                        </span>
                      ) : null}
                      {p.referencia ? <span className="ml-2 font-mono text-chico text-lab3">{p.referencia}</span> : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="num font-semibold text-lab">{clp(p.monto)}</span>
                      <button
                        type="button"
                        onClick={() => quitarPago(i)}
                        aria-label={`Quitar pago de ${ETIQUETA_MEDIO[p.medio]}`}
                        className="flex h-[36px] w-[36px] items-center justify-center rounded text-lab2"
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {error ? (
              <div className="mt-3">
                <Banner tono="peligro">{error}</Banner>
              </div>
            ) : null}

            <div className="mt-4">
              <Boton
                variante="principal"
                tamano="grande"
                cargando={enviando}
                deshabilitado={falta !== 0}
                onClick={() => void confirmar()}
              >
                {falta !== 0
                  ? `Faltan ${clp(falta)} por asignar.`
                  : enLinea
                    ? 'CONFIRMAR VENTA'
                    : 'CONFIRMAR VENTA · sin conexión'}
              </Boton>
            </div>
            {pagos.length === 0 ? (
              <p className="mt-2 text-center text-chico text-lab3">
                <Insignia>Enter agrega el pago por lo que falta</Insignia>
              </p>
            ) : null}
          </>
        )}
      </div>
    </Dialogo>
  );
}
