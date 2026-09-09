// Cola offline de ventas F10 (02-SDD §7.4, 05-SDD §8.1). Las ventas se
// encolan en IndexedDB con su idempotencyKey PERSISTIDA junto a la venta:
// un reintento horas después, incluso con la app recargada, reusa la misma
// clave y el servidor responde la venta original (nunca duplica).
import { useEffect, useState } from 'react';
import { api, ErrorApi } from './api.js';
import { abrirDb, tx, VENTAS_PENDIENTES } from './catalogo.js';
import type { PagoNuevo, RespuestaVenta } from './tipos.js';

export interface CuerpoVenta {
  idempotencyKey: string;
  /** Cliente registrado asociado a la venta (E4); null = venta sin cliente (M3). */
  clienteId: string | null;
  /** Nombre libre sin cliente registrado, como en E1 (M3). */
  clienteNombre: string | null;
  descuento: number;
  lineas: {
    productoId: string | null;
    descripcion: string;
    cantidad: number;
    precioUnitario: number;
    descuentoLinea: number;
  }[];
  pagos: PagoNuevo[];
  /** E2 §6.9: encargado que vende pese al bloqueo por pedido web pagado; exige nota. */
  forzarReservado?: { nota: string };
  /** E2 §6.9: encargado que vende pese al bloqueo por pedido web pagado; exige nota. */
}

interface VentaPendiente {
  idempotencyKey: string;
  creadaEn: string;
  cuerpo: CuerpoVenta;
}

export interface EstadoCola {
  pendientes: number;
  enviando: boolean;
  /** Resultado de la última corrida de envío; null si nunca corrió. */
  ultimoResultado: { enviadas: number; fallidas: { idempotencyKey: string; detalle: string }[] } | null;
}

let estado: EstadoCola = { pendientes: 0, enviando: false, ultimoResultado: null };
const suscriptores = new Set<() => void>();

function notificar(cambios: Partial<EstadoCola>) {
  estado = { ...estado, ...cambios };
  suscriptores.forEach((fn) => fn());
}

export function estadoCola(): EstadoCola {
  return estado;
}

export function alCambiarCola(fn: () => void): () => void {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}

/** Guarda la venta en IndexedDB y, si hay conexión, intenta vaciarla al tiro. */
export async function encolarVenta(cuerpo: CuerpoVenta): Promise<void> {
  const db = await abrirDb();
  const pendiente: VentaPendiente = {
    idempotencyKey: cuerpo.idempotencyKey,
    creadaEn: new Date().toISOString(),
    cuerpo,
  };
  await tx(db, VENTAS_PENDIENTES, 'readwrite', (s) => s.put(pendiente));
  const total = await tx<number>(db, VENTAS_PENDIENTES, 'readonly', (s) => s.count());
  notificar({ pendientes: total });
  if (navigator.onLine) void enviarPendientes();
}

/**
 * Envía las pendientes en orden de creación. La idempotencia del servidor
 * (misma clave → venta original con 200) hace seguro reintentar. Un rechazo
 * del servidor (ErrorApi) marca la venta como fallida y sigue con la
 * siguiente; un fallo de red aborta la corrida (se reintenta al reconectar).
 */
export async function enviarPendientes(): Promise<void> {
  if (estado.enviando) return;
  const db = await abrirDb();
  const todas = await tx<VentaPendiente[]>(db, VENTAS_PENDIENTES, 'readonly', (s) => s.getAll() as IDBRequest<VentaPendiente[]>);
  if (todas.length === 0) return;
  todas.sort((a, b) => a.creadaEn.localeCompare(b.creadaEn));
  notificar({ enviando: true, pendientes: todas.length });
  let enviadas = 0;
  const fallidas: { idempotencyKey: string; detalle: string }[] = [];
  try {
    for (const venta of todas) {
      try {
        await api<RespuestaVenta>('/ventas', { method: 'POST', body: JSON.stringify(venta.cuerpo) });
        await tx(db, VENTAS_PENDIENTES, 'readwrite', (s) => s.delete(venta.idempotencyKey));
        enviadas += 1;
        notificar({ pendientes: estado.pendientes - 1 });
      } catch (e) {
        if (e instanceof ErrorApi && e.estado !== 401) {
          // El servidor la rechazó (p. ej. turno cerrado): queda en cola y se avisa.
          const detalle = typeof e.cuerpo.detalle === 'string' ? e.cuerpo.detalle : e.codigo;
          fallidas.push({ idempotencyKey: venta.idempotencyKey, detalle });
        } else {
          // Sin red o sin sesión: se corta y se reintenta en la próxima corrida.
          break;
        }
      }
    }
  } finally {
    const total = await tx<number>(db, VENTAS_PENDIENTES, 'readonly', (s) => s.count()).catch(() => estado.pendientes);
    notificar({
      enviando: false,
      pendientes: total,
      ultimoResultado: enviadas > 0 || fallidas.length > 0 ? { enviadas, fallidas } : estado.ultimoResultado,
    });
  }
}

/** Arranque: cuenta lo pendiente, intenta vaciar y escucha el evento online. */
export function iniciarColaVentas(): () => void {
  const alConectar = () => void enviarPendientes();
  window.addEventListener('online', alConectar);
  void (async () => {
    const db = await abrirDb();
    const total = await tx<number>(db, VENTAS_PENDIENTES, 'readonly', (s) => s.count());
    notificar({ pendientes: total });
    if (navigator.onLine && total > 0) void enviarPendientes();
  })();
  return () => window.removeEventListener('online', alConectar);
}

export function useCola(): EstadoCola {
  const [instantanea, setInstantanea] = useState(estado);
  useEffect(() => alCambiarCola(() => setInstantanea(estadoCola())), []);
  return instantanea;
}
