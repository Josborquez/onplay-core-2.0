// Corridas de la Etapa 3 — docs/06-SDD-etapa3-sincronizacion.md §6.1.
// Cerrojo por (canalId, tipo), barrido de arranque y utilidades comunes a la
// ingesta (§8) y a los push (§4). Ninguna corrida escribe en un canal desde aquí.
import type { EstadoCorrida, SyncCorrida, TipoCorrida } from '@prisma/client';
import { ClienteWoo } from '@onplay/woo-client';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import type { CanalWoo } from './importador.js';

export class ErrorCorrida extends Error {
  constructor(
    public readonly cuerpo: { error: string; detalle?: string; [k: string]: unknown },
    public readonly status = 422,
  ) {
    super(cuerpo.error);
  }
}

export interface ContadoresCorrida {
  leidos: number;
  aEscribir: number;
  escritos: number;
  omitidos: number;
  detenidos: number;
  fallidos: number;
}

export function contadoresVacios(): ContadoresCorrida {
  return { leidos: 0, aEscribir: 0, escritos: 0, omitidos: 0, detenidos: 0, fallidos: 0 };
}

/** Cliente del canal con las credenciales del entorno. 422 si faltan. */
export function clienteDelCanal(canalId: CanalWoo): ClienteWoo {
  const cfg = entorno.canales[canalId];
  if (!cfg.url || !cfg.ck || !cfg.cs) {
    throw new ErrorCorrida({ error: 'CANAL_SIN_CREDENCIALES', detalle: `Canal ${canalId} sin WOO_* configuradas` });
  }
  return new ClienteWoo({ url: cfg.url, ck: cfg.ck, cs: cfg.cs, soloLectura: entorno.syncSoloLectura });
}

/**
 * Abre una corrida tomando el cerrojo: la fila de Canal se bloquea con FOR UPDATE, se
 * comprueba que no haya otra `en_curso` del mismo tipo y recién entonces se crea.
 * Dos peticiones simultáneas → una crea, la otra recibe 409 CORRIDA_EN_CURSO (criterio 13).
 */
export async function abrirCorrida(
  canalId: string,
  tipo: TipoCorrida,
  opciones: { simulacion: boolean; usuarioId: string | null },
): Promise<SyncCorrida> {
  return prisma.$transaction(async (tx) => {
    const canal = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM Canal WHERE id = ${canalId} FOR UPDATE`;
    if (canal.length === 0) throw new ErrorCorrida({ error: 'CANAL_DESCONOCIDO' }, 404);
    const abierta = await tx.syncCorrida.findFirst({
      where: { canalId, tipo, estado: 'en_curso' },
      select: { id: true, iniciadaEn: true },
    });
    if (abierta) {
      throw new ErrorCorrida(
        { error: 'CORRIDA_EN_CURSO', detalle: `Ya hay una corrida de ${tipo} en curso desde ${abierta.iniciadaEn.toISOString()}`, corridaId: abierta.id },
        409,
      );
    }
    return tx.syncCorrida.create({
      data: { canalId, tipo, simulacion: opciones.simulacion, usuarioId: opciones.usuarioId },
    });
  });
}

export async function cerrarCorrida(
  id: string,
  estado: Exclude<EstadoCorrida, 'en_curso'>,
  contadores: ContadoresCorrida,
  mensaje?: string | null,
): Promise<void> {
  await prisma.syncCorrida.update({
    where: { id },
    data: { estado, terminadaEn: new Date(), ...contadores, mensaje: mensaje ?? null },
  });
}

/**
 * Barrido de arranque (§6.1): toda corrida que quedó `en_curso` al morir el proceso
 * pasa a `abortada`, así el cerrojo no queda trabado (criterio 14).
 */
export async function abortarCorridasColgadas(): Promise<number> {
  const r = await prisma.syncCorrida.updateMany({
    where: { estado: 'en_curso' },
    data: { estado: 'abortada', terminadaEn: new Date(), mensaje: 'abortada por reinicio del proceso (barrido de arranque §6.1)' },
  });
  return r.count;
}

let usuarioSistemaCache: string | null = null;

/** Usuario que firma los movimientos de una corrida automática (semilla `sistema@onplay.cl`). */
export async function usuarioSistemaId(): Promise<string> {
  if (usuarioSistemaCache) return usuarioSistemaCache;
  const u = await prisma.usuario.findUnique({ where: { email: 'sistema@onplay.cl' }, select: { id: true } });
  if (!u) {
    throw new ErrorCorrida(
      { error: 'USUARIO_SISTEMA_FALTANTE', detalle: 'Falta el usuario sistema@onplay.cl: corre npm run seed' },
      500,
    );
  }
  usuarioSistemaCache = u.id;
  return u.id;
}
