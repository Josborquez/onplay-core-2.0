// Importación de clientes de los canales — E4 §7.3 (C7).
// Lee wc/v3/customers (NUNCA wp/v2/users: las mismas claves ck_/cs_ de solo
// lectura funcionan y el `id` ES el externoUserId de ClienteCanal).
// Coincidencia por correo. Sin coincidencia se PROPONE crear, nunca se crea
// solo: importar usuarios de un WordPress mal higienizado a ciegas ensucia la
// base desde el primer día. dryRun por defecto (regla S1).
import { ClienteWoo } from '@onplay/woo-client';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import { CANALES_WOO, type CanalWoo } from './importador.js';

export { CANALES_WOO, type CanalWoo };

export interface PropuestaVinculo {
  externoUserId: number;
  email: string;
  nombreCanal: string;
  clienteId: string;
  clienteNombre: string;
}

export interface PropuestaCreacion {
  externoUserId: number;
  email: string;
  nombreCanal: string;
  telefono: string | null;
}

export interface ConflictoVinculo {
  externoUserId: number;
  email: string;
  detalle: string;
}

export interface ResumenClientesCanal {
  canalId: CanalWoo;
  dryRun: boolean;
  totalCanal: number;
  yaVinculados: number;
  /** Cuentas con vínculo desvinculado a mano: se respeta la decisión, no se re-vinculan. */
  desvinculados: number;
  sinEmail: number;
  /** Coincidencia por correo: en dryRun propuestas, en corrida real vínculos creados. */
  vinculos: PropuestaVinculo[];
  /** Sin coincidencia: SIEMPRE propuestas — la creación es decisión humana (§7.3). */
  sinCoincidencia: PropuestaCreacion[];
  conflictos: ConflictoVinculo[];
  duracionMs: number;
}

function nombreDe(u: { first_name: string; last_name: string; email: string }): string {
  const nombre = `${u.first_name} ${u.last_name}`.trim();
  return nombre || u.email;
}

export async function importarClientesCanal(
  canalId: CanalWoo,
  opciones: { dryRun: boolean; usuarioId: string },
): Promise<ResumenClientesCanal> {
  const inicio = Date.now();
  const { dryRun, usuarioId } = opciones;
  const cfg = entorno.canales[canalId];
  if (!cfg.url || !cfg.ck || !cfg.cs) {
    throw new Error(`Canal ${canalId} sin credenciales configuradas (WOO_*).`);
  }

  const woo = new ClienteWoo({
    url: cfg.url,
    ck: cfg.ck,
    cs: cfg.cs,
    soloLectura: entorno.syncSoloLectura,
  });

  // Estado local: vínculos del canal y clientes con correo (volumen chico → memoria).
  const [vinculosCanal, clientesConEmail] = await Promise.all([
    prisma.clienteCanal.findMany({
      where: { canalId },
      select: { clienteId: true, externoUserId: true, desvinculadoEn: true },
    }),
    prisma.cliente.findMany({
      where: { email: { not: null } },
      select: { id: true, nombre: true, email: true },
    }),
  ]);
  const vinculoPorExterno = new Map(vinculosCanal.map((v) => [v.externoUserId, v]));
  const clientePorEmail = new Map(clientesConEmail.map((c) => [c.email!.trim().toLowerCase(), c]));
  const clienteActivoEnCanal = new Set(
    vinculosCanal.filter((v) => v.desvinculadoEn === null).map((v) => v.clienteId),
  );

  const resumen: ResumenClientesCanal = {
    canalId,
    dryRun,
    totalCanal: 0,
    yaVinculados: 0,
    desvinculados: 0,
    sinEmail: 0,
    vinculos: [],
    sinCoincidencia: [],
    conflictos: [],
    duracionMs: 0,
  };

  for await (const lote of woo.paginarClientes()) {
    for (const u of lote) {
      resumen.totalCanal += 1;
      const email = (u.email || u.billing?.email || '').trim().toLowerCase();
      if (!email) {
        resumen.sinEmail += 1;
        continue;
      }
      const existente = vinculoPorExterno.get(u.id);
      if (existente) {
        if (existente.desvinculadoEn === null) resumen.yaVinculados += 1;
        else resumen.desvinculados += 1; // decisión manual previa: no se re-vincula solo
        continue;
      }
      const cliente = clientePorEmail.get(email);
      if (!cliente) {
        resumen.sinCoincidencia.push({
          externoUserId: u.id,
          email,
          nombreCanal: nombreDe(u),
          telefono: u.billing?.phone?.trim() || null,
        });
        continue;
      }
      if (clienteActivoEnCanal.has(cliente.id)) {
        resumen.conflictos.push({
          externoUserId: u.id,
          email,
          detalle: `El cliente ${cliente.nombre} ya tiene otra cuenta vinculada en este canal`,
        });
        continue;
      }
      resumen.vinculos.push({
        externoUserId: u.id,
        email,
        nombreCanal: nombreDe(u),
        clienteId: cliente.id,
        clienteNombre: cliente.nombre,
      });
      clienteActivoEnCanal.add(cliente.id); // dos cuentas del canal con el mismo correo → la segunda es conflicto
    }
  }

  if (!dryRun) {
    // Confirmación por tandas: solo las coincidencias por correo. Cada vínculo
    // se audita (M4/M5). Una fila desvinculada del mismo par cliente-canal se
    // reutiliza (única por [clienteId, canalId] en el schema §5).
    for (const v of resumen.vinculos) {
      await prisma.$transaction(async (tx) => {
        const fila = await tx.clienteCanal.upsert({
          where: { clienteId_canalId: { clienteId: v.clienteId, canalId } },
          create: { clienteId: v.clienteId, canalId, externoUserId: v.externoUserId, externoEmail: v.email },
          update: { externoUserId: v.externoUserId, externoEmail: v.email, vinculadoEn: new Date(), desvinculadoEn: null },
        });
        await tx.auditoria.create({
          data: {
            usuarioId,
            entidad: 'cliente',
            entidadId: v.clienteId,
            accion: 'editar',
            valorNuevo: { vinculo: fila.id, canalId, externoUserId: v.externoUserId, externoEmail: v.email, origen: 'importacion' },
          },
        });
      });
    }
  }

  resumen.duracionMs = Date.now() - inicio;

  // Bitácora del sistema: la última corrida por canal alimenta /clientes/candidatos.
  await prisma.syncLog.create({
    data: {
      canalId,
      operacion: 'clientes',
      resultado: resumen.conflictos.length > 0 ? 'ok_con_errores' : 'ok',
      detalle: JSON.stringify(resumen),
    },
  });

  return resumen;
}
