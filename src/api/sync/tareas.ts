// Tareas en segundo plano dentro del proceso (10-SDD §5.8, P6): el borde de Hostinger corta las
// respuestas a los ~55 s (R-019), así que una operación larga responde en el acto con un
// `tareaId` y sigue corriendo; el backoffice consulta GET /sync/tareas/:id hasta que termina.
// Registro en memoria: si el proceso se reinicia a la mitad, la tarea se pierde y el resultado
// real queda donde siempre (SyncLog / SyncCorrida, con su barrido de arranque).
import { randomUUID } from 'node:crypto';

export type EstadoTarea = 'en_curso' | 'terminada' | 'fallida';

export interface Tarea {
  id: string;
  tipo: string;
  estado: EstadoTarea;
  iniciadaEn: Date;
  terminadaEn: Date | null;
  usuarioId: string | null;
  resultado: unknown;
  error: string | null;
}

const tareas = new Map<string, Tarea>();
const MAX_GUARDADAS = 50;

export function iniciarTarea(tipo: string, usuarioId: string | null, fn: () => Promise<unknown>): Tarea {
  const tarea: Tarea = { id: randomUUID(), tipo, estado: 'en_curso', iniciadaEn: new Date(), terminadaEn: null, usuarioId, resultado: null, error: null };
  tareas.set(tarea.id, tarea);
  // Se poda por antigüedad para que el mapa no crezca sin límite.
  if (tareas.size > MAX_GUARDADAS) {
    const masVieja = [...tareas.values()].filter((t) => t.estado !== 'en_curso').sort((a, b) => a.iniciadaEn.getTime() - b.iniciadaEn.getTime())[0];
    if (masVieja) tareas.delete(masVieja.id);
  }
  void fn()
    .then((r) => {
      tarea.resultado = r;
      tarea.estado = 'terminada';
    })
    .catch((e: unknown) => {
      tarea.error = e instanceof Error ? e.message : String(e);
      tarea.estado = 'fallida';
    })
    .finally(() => {
      tarea.terminadaEn = new Date();
    });
  return tarea;
}

export function obtenerTarea(id: string): Tarea | null {
  return tareas.get(id) ?? null;
}

export function listarTareas(): Tarea[] {
  return [...tareas.values()].sort((a, b) => b.iniciadaEn.getTime() - a.iniciadaEn.getTime());
}
