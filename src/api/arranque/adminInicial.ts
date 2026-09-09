// Admin inicial (10-SDD §5.4): si no hay ningún usuario activo y el entorno trae
// ADMIN_INICIAL_EMAIL / ADMIN_INICIAL_PASSWORD, se crea el admin con argon2 y queda en Auditoria.
// La contraseña del entorno es de un solo uso: `debeCambiarClave` obliga a cambiarla al entrar.
import type { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { entorno } from '../entorno.js';

export type ResultadoAdminInicial = 'creado' | 'ya_hay_usuarios' | 'sin_variables';

type Log = { warn: (o: unknown, m?: string) => void; info: (o: unknown, m?: string) => void };

export async function crearAdminInicial(prisma: PrismaClient, log: Log): Promise<ResultadoAdminInicial> {
  const activos = await prisma.usuario.count({ where: { activo: true } });
  if (activos > 0) return 'ya_hay_usuarios';

  const email = entorno.adminInicialEmail;
  const password = entorno.adminInicialPassword;
  if (!email || !password) {
    log.warn({}, 'no hay usuarios activos y faltan ADMIN_INICIAL_EMAIL/ADMIN_INICIAL_PASSWORD: /salud responde sin_usuarios');
    return 'sin_variables';
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    // upsert: si el correo existe pero está inactivo (único admin desactivado), se reactiva.
    const admin = await tx.usuario.upsert({
      where: { email },
      update: { passwordHash, rol: 'admin', activo: true, debeCambiarClave: true },
      create: { email, nombre: 'Administrador', passwordHash, rol: 'admin', activo: true, debeCambiarClave: true },
    });
    await tx.auditoria.create({
      data: {
        usuarioId: admin.id,
        entidad: 'usuario',
        entidadId: admin.id,
        accion: 'crear',
        valorNuevo: { email, rol: 'admin', origen: 'ADMIN_INICIAL', debeCambiarClave: true },
      },
    });
  });
  log.info({ email }, 'admin inicial creado desde el entorno; debe cambiar la clave al entrar');
  return 'creado';
}
