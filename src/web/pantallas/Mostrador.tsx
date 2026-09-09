// V2 — Mostrador (05-SDD §7.1): buscador + accesos rápidos + panel de venta.
// Exige turno abierto (V1). Atajos SOLO con teclas de función (F1/F2/F8).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ulid } from 'ulid';
import { api } from '../api.js';
import { productoPorId, hidratarCatalogo, iniciarRefrescoPeriodico, refrescarCatalogo, type ProductoCache } from '../catalogo.js';
import { encolarVenta, useCola, type CuerpoVenta } from '../cola.js';
import { useEnLinea } from '../tema.js';
import type { ClienteResumen, LineaCarrito, PagoNuevo, RespuestaVenta, Turno, ReservadoWeb } from '../tipos.js';
import { clp, hora } from '../utils/formato.js';
import { AccesoRapido } from '../components/AccesoRapido.js';
import { BarraTotalFija } from '../components/BarraTotalFija.js';
import { Buscador } from '../components/Buscador.js';
import { DialogoApertura } from '../components/DialogoApertura.js';
import { DialogoCierre } from '../components/DialogoCierre.js';
import { DialogoCobro } from '../components/DialogoCobro.js';
import { DialogoItemSuelto } from '../components/DialogoItemSuelto.js';
import { DialogoMovimientoCaja } from '../components/DialogoMovimientoCaja.js';
import { useSesion } from '../sesion.js';
import { rolAlcanza } from '../tipos.js';
import { PanelVenta, motivoNoCobrable } from '../components/PanelVenta.js';
import { Banner, Boton, Dialogo } from '../components/base.js';

type DialogoAbierto = 'ninguno' | 'cobro' | 'suelto' | 'cierre' | 'ayuda';

const ATAJOS: [string, string][] = [
  ['F1', 'Esta lista de atajos'],
  ['F2', 'Abrir el cobro'],
  ['F3', 'Plegar o desplegar la barra lateral'],
  ['F4', 'Ir al backoffice (encargado o superior)'],
  ['F8', 'Vaciar el carrito'],
  ['Esc', 'Limpiar búsqueda · cerrar diálogo'],
  ['↓ ↑ Enter', 'Navegar y agregar resultados'],
];

export function Mostrador() {
  const [turno, setTurno] = useState<Turno | null | 'cargando'>('cargando');
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [descuento, setDescuento] = useState<number | ''>('');
  const [dialogo, setDialogo] = useState<DialogoAbierto>('ninguno');
  const [terminoSuelto, setTerminoSuelto] = useState('');
  const [claveVenta, setClaveVenta] = useState<string | null>(null);
  // V15 (E4): cliente asociado a la venta en curso; el texto libre sin elegir
  // a nadie viaja como clienteNombre, igual que en E1 (M3).
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [nombreLibre, setNombreLibre] = useState('');
  const enLinea = useEnLinea();
  const cola = useCola();
  const [bannerEnviadas, setBannerEnviadas] = useState(0);
  // E2 §6.7 (V24): movimientos de caja, solo encargado.
  const { usuario } = useSesion();
  const puedeCaja = rolAlcanza(usuario?.rol ?? 'vendedor', 'encargado');
  const [cajaAbierta, setCajaAbierta] = useState(false);
  const [bannerCaja, setBannerCaja] = useState('');
  useEffect(() => {
    if (!bannerCaja) return;
    const id = setTimeout(() => setBannerCaja(''), 4000);
    return () => clearTimeout(id);
  }, [bannerCaja]);

  useEffect(() => {
    void hidratarCatalogo();
    const detener = iniciarRefrescoPeriodico();
    void api<Turno | null>('/turnos/actual')
      .then(setTurno)
      .catch(() => setTurno(null));
    return detener;
  }, []);

  const totalLineas = carrito.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
  const total = Math.max(0, totalLineas - (descuento || 0));
  const cobrable = motivoNoCobrable(carrito, descuento) === null;

  // R-014: el stock nunca queda negativo. Con control, no se agregan más unidades que las
  // disponibles en la ubicación de venta (dato del caché; el servidor lo revalida al cobrar).
  const [avisoStock, setAvisoStock] = useState('');
  useEffect(() => {
    if (!avisoStock) return;
    const id = setTimeout(() => setAvisoStock(''), 3500);
    return () => clearTimeout(id);
  }, [avisoStock]);

  const agregarProducto = useCallback(async (p: ProductoCache) => {
    let disponible = p.controlaStock && p.stockVenta != null ? p.stockVenta : null;
    // Con conexión, el tope se toma del servidor en el momento (una consulta chica): el caché
    // puede tener stock viejo. Sin conexión vale el caché y el servidor revalida al cobrar.
    if (p.controlaStock && enLinea) {
      try {
        const vivo = await api<{ controlaStock: boolean; stockVenta: number | null }>(`/productos/${p.id}/stock`);
        disponible = vivo.controlaStock && vivo.stockVenta != null ? vivo.stockVenta : null;
      } catch {
        /* sin respuesta: se usa el caché */
      }
    }
    setCarrito((prev) => {
      const existente = prev.find((l) => l.productoId === p.id);
      const enCarrito = existente?.cantidad ?? 0;
      if (disponible !== null && enCarrito + 1 > disponible) {
        setAvisoStock(disponible <= 0 ? `«${p.nombre}» no tiene stock disponible.` : `«${p.nombre}»: solo quedan ${disponible} y ya hay ${enCarrito} en la venta.`);
        return prev;
      }
      if (existente) {
        return prev.map((l) => (l.clave === existente.clave ? { ...l, cantidad: l.cantidad + 1, stockDisponible: disponible } : l));
      }
      return [
        ...prev,
        {
          clave: ulid(),
          productoId: p.id,
          descripcion: p.nombre,
          cantidad: 1,
          precioUnitario: p.precioVenta,
          precioCatalogo: p.precioVenta,
          stockDisponible: disponible,
        },
      ];
    });
  }, [enLinea]);

  const abrirCobro = useCallback(() => {
    setClaveVenta((k) => k ?? ulid()); // estable ante reintentos: criterio 9 de 02-SDD
    setDialogo('cobro');
  }, []);

  // Atajos globales: solo teclas de función (05-SDD V2).
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setDialogo((d) => (d === 'ninguno' ? 'ayuda' : d));
      } else if (e.key === 'F2') {
        e.preventDefault();
        if (dialogo === 'ninguno' && cobrable) abrirCobro();
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (dialogo === 'ninguno' && carrito.length > 0 && window.confirm('¿Vaciar el carrito?')) {
          setCarrito([]);
          setDescuento('');
          setClaveVenta(null);
          setCliente(null);
          setNombreLibre('');
        }
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [dialogo, cobrable, carrito.length, abrirCobro]);

  const construirCuerpo = useCallback(
    (pagos: PagoNuevo[], extra?: { forzarReservado?: { nota: string } }): CuerpoVenta => ({
      ...(extra?.forzarReservado ? { forzarReservado: extra.forzarReservado } : {}),
      idempotencyKey: claveVenta ?? ulid(),
      clienteId: cliente?.id ?? null,
      clienteNombre: cliente ? null : nombreLibre.trim() || null,
      descuento: descuento || 0,
      lineas: carrito.map((l) => ({
        productoId: l.productoId,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        descuentoLinea: 0, // existe en el contrato; la Etapa 1 no lo expone
      })),
      pagos,
    }),
    [claveVenta, cliente, nombreLibre, descuento, carrito],
  );

  const confirmarVenta = useCallback(
    async (pagos: PagoNuevo[], extra?: { forzarReservado?: { nota: string } }) => {
      const r = await api<RespuestaVenta>('/ventas', {
        method: 'POST',
        body: JSON.stringify(construirCuerpo(pagos, extra)),
      });
      return {
        folio: r.venta.folio,
        advertencias: {
          precio: r.advertencias.filter((a) => a.tipo === 'PRECIO_DISTINTO' || !('tipo' in a)).length,
          stockNegativo: r.advertencias.flatMap((a) => (a.tipo === 'STOCK_NEGATIVO' ? [a.descripcion] : [])),
        },
      };
    },
    [construirCuerpo],
  );

  // F10: sin conexión la venta se guarda en IndexedDB con su idempotencyKey.
  const encolar = useCallback(
    (pagos: PagoNuevo[], extra?: { forzarReservado?: { nota: string } }) => void encolarVenta(construirCuerpo(pagos, extra)),
    [construirCuerpo],
  );

  // E2 §6.9 sin conexión: la misma regla con el espejo del caché (más viejo, y el diálogo lo dice).
  const reservadosCache = useMemo<ReservadoWeb[]>(
    () =>
      carrito.flatMap((l) => {
        if (!l.productoId) return [];
        const p = productoPorId(l.productoId);
        if (!p?.controlaStock || p.stockCanalMin == null || p.stockCanalMin > 0 || (p.stockVenta ?? 0) < 1) return [];
        return [{ productoId: p.id, descripcion: p.nombre, canalId: 'web', stockCanal: p.stockCanalMin, stockCanalEn: null, stockPropio: p.stockVenta ?? 0, desdeCache: true }];
      }),
    [carrito],
  );

  const quitarProducto = useCallback(
    (productoId: string) => setCarrito((prev) => prev.filter((l) => l.productoId !== productoId)),
    [],
  );

  // Al vaciarse la cola: banner ok 4 segundos; si algo falló, banner peligro
  // que no se cierra solo (05-SDD §8.1).
  useEffect(() => {
    const r = cola.ultimoResultado;
    if (!r || r.enviadas === 0) return;
    setBannerEnviadas(r.enviadas);
    const id = setTimeout(() => setBannerEnviadas(0), 4000);
    return () => clearTimeout(id);
  }, [cola.ultimoResultado]);

  const ventaLista = useCallback(() => {
    // R-014: tras cobrar, el stock del cache se refresca de inmediato (el delta trae los cambios de stock).
    void refrescarCatalogo();
    setCarrito([]);
    setDescuento('');
    setClaveVenta(null);
    setCliente(null);
    setNombreLibre('');
    setDialogo('ninguno');
    setTimeout(() => document.getElementById('buscador')?.focus(), 0);
  }, []);

  if (turno === 'cargando') {
    return <p className="p-8 text-center text-cuerpo text-lab3">Cargando…</p>;
  }
  if (!turno) {
    return <DialogoApertura onAbierto={setTurno} />;
  }

  const propsPanel = {
    lineas: carrito,
    descuento,
    onDescuento: setDescuento,
    onCantidad: (clave: string, cantidad: number) =>
      setCarrito((prev) =>
        prev.map((l) => {
          if (l.clave !== clave) return l;
          if (l.stockDisponible !== null && cantidad > l.stockDisponible) {
            setAvisoStock(`«${l.descripcion}»: solo quedan ${l.stockDisponible}.`);
            return { ...l, cantidad: l.stockDisponible };
          }
          return { ...l, cantidad };
        }),
      ),
    onPrecio: (clave: string, precio: number) =>
      setCarrito((prev) => prev.map((l) => (l.clave === clave ? { ...l, precioUnitario: precio } : l))),
    onEliminar: (clave: string) => setCarrito((prev) => prev.filter((l) => l.clave !== clave)),
    onCobrar: abrirCobro,
  };

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <header className="no-imprimir mb-3 flex items-center justify-between gap-3">
        <p className="text-chico text-lab2">
          Turno abierto a las {hora(turno.abiertoEn)} · apertura {clp(turno.montoApertura)}
        </p>
        <div className="flex gap-2">
          {puedeCaja ? (
            <div className="w-[120px]">
              <Boton onClick={() => setCajaAbierta(true)}>Caja ±</Boton>
            </div>
          ) : null}
          <div className="w-[160px]">
            <Boton onClick={() => setDialogo('cierre')}>Cerrar caja</Boton>
          </div>
        </div>
      </header>
      <DialogoMovimientoCaja
        abierto={cajaAbierta}
        turnoId={turno.id}
        onCerrar={() => setCajaAbierta(false)}
        onHecho={(m) => setBannerCaja(`${m.tipo === 'retiro' ? 'Retiro' : 'Ingreso'} de ${clp(m.monto)} registrado en la caja.`)}
      />
      {bannerCaja ? (
        <div className="no-imprimir mb-3">
          <Banner tono="ok">{bannerCaja}</Banner>
        </div>
      ) : null}
      {avisoStock ? (
        <div className="no-imprimir mb-3" role="status">
          <Banner tono="alerta">{avisoStock}</Banner>
        </div>
      ) : null}

      {bannerEnviadas > 0 ? (
        <div className="no-imprimir mb-3">
          <Banner tono="ok">
            Se enviaron {bannerEnviadas} venta{bannerEnviadas > 1 ? 's' : ''} pendiente
            {bannerEnviadas > 1 ? 's' : ''}.
          </Banner>
        </div>
      ) : null}
      {cola.ultimoResultado && cola.ultimoResultado.fallidas.length > 0 ? (
        <div className="no-imprimir mb-3">
          <Banner tono="peligro">
            {cola.ultimoResultado.fallidas.length > 1
              ? `${cola.ultimoResultado.fallidas.length} ventas pendientes no se pudieron enviar.`
              : '1 venta pendiente no se pudo enviar.'}
            <details className="mt-1">
              <summary className="cursor-pointer underline">Ver detalle</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {cola.ultimoResultado.fallidas.map((f) => (
                  <li key={f.idempotencyKey} className="font-mono text-chico">
                    {f.idempotencyKey.slice(-6)}: {f.detalle}
                  </li>
                ))}
              </ul>
            </details>
          </Banner>
        </div>
      ) : null}

      <div className="no-imprimir flex min-h-0 flex-1 gap-4">
        <div className="min-w-0 flex-1 overflow-y-auto pb-[96px] lg:pb-0">
          <Buscador
            bloqueado={dialogo !== 'ninguno'}
            cantidadEnCarrito={(id) => carrito.find((l) => l.productoId === id)?.cantidad ?? 0}
            onAgregar={agregarProducto}
            onItemSuelto={(termino) => {
              setTerminoSuelto(termino);
              setDialogo('suelto');
            }}
          />
          <div className="mt-4">
            <AccesoRapido onAgregar={agregarProducto} />
          </div>
          <div className="mt-4 lg:hidden">
            <PanelVenta {...propsPanel} />
          </div>
        </div>
        <aside className="hidden w-[344px] shrink-0 lg:block">
          <PanelVenta {...propsPanel} />
        </aside>
      </div>

      {carrito.length > 0 ? (
        <BarraTotalFija total={total} deshabilitado={!cobrable} onCobrar={abrirCobro} />
      ) : null}

      <DialogoCobro
        abierto={dialogo === 'cobro'}
        total={total}
        enLinea={enLinea}
        cliente={cliente}
        nombreLibre={nombreLibre}
        onElegirCliente={setCliente}
        onQuitarCliente={() => setCliente(null)}
        onNombreLibre={setNombreLibre}
        onCerrar={() => setDialogo('ninguno')}
        onConfirmar={confirmarVenta}
        onEncolar={encolar}
        onListo={ventaLista}
        reservadosCache={reservadosCache}
        onQuitarProducto={quitarProducto}
      />
      <DialogoItemSuelto
        abierto={dialogo === 'suelto'}
        terminoInicial={terminoSuelto}
        onCerrar={() => setDialogo('ninguno')}
        onAgregar={(descripcion, precio) => {
          setCarrito((prev) => [
            ...prev,
            { clave: ulid(), productoId: null, descripcion, cantidad: 1, precioUnitario: precio, precioCatalogo: null, stockDisponible: null },
          ]);
          setDialogo('ninguno');
        }}
      />
      <DialogoCierre
        abierto={dialogo === 'cierre'}
        turno={turno}
        onCerrar={() => setDialogo('ninguno')}
        onCerrado={() => {
          setDialogo('ninguno');
          setTurno(null);
          setCarrito([]);
          setDescuento('');
          setClaveVenta(null);
        }}
      />
      <Dialogo abierto={dialogo === 'ayuda'} titulo="Atajos de teclado" onCerrar={() => setDialogo('ninguno')} ancho={420}>
        <ul className="flex flex-col gap-2">
          {ATAJOS.map(([tecla, accion]) => (
            <li key={tecla} className="flex items-center justify-between text-cuerpo">
              <span className="rounded border border-sep bg-bg3 px-2 py-0.5 font-mono text-chico text-lab">{tecla}</span>
              <span className="text-lab2">{accion}</span>
            </li>
          ))}
        </ul>
      </Dialogo>
    </div>
  );
}
