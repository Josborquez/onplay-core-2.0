import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import type { SesionJwt } from '../plugins/auth.js';

function publicoUsuario(u: { id: string; nombre: string; email: string; rol: string; debeCambiarClave?: boolean }) {
  return { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, debeCambiarClave: u.debeCambiarClave ?? false };
}

// H7 (05-SDD §14): el refresh token viaja en cookie httpOnly + SameSite=Strict,
// nunca en localStorage. Alcance limitado a /api/v1/auth.
const COOKIE_REFRESH = 'onplay_refresh';
const opcionesCookie = {
  httpOnly: true,
  sameSite: 'strict',
  secure: entorno.nodeEnv === 'production',
  path: '/api/v1/auth',
  maxAge: 30 * 24 * 60 * 60, // segundos; alineado con REFRESH_EXPIRA=30d
} as const;

export default async function rutasAuth(app: FastifyInstance) {
  app.post<{ Body: { email: string; password: string } }>(
    '/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const usuario = await prisma.usuario.findUnique({ where: { email } });
      // Verificación en tiempo ~constante: no revelar si el email existe.
      const hash = usuario?.passwordHash ?? (await argon2.hash('invalido'));
      const valida = await argon2.verify(hash, password).catch(() => false);
      if (!usuario || !usuario.activo || !valida) {
        return reply.code(401).send({ error: 'CREDENCIALES_INVALIDAS' });
      }
      const base = { sub: usuario.id, rol: usuario.rol, nombre: usuario.nombre } as const;
      const token = app.jwt.sign({ ...base, tipo: 'acceso' } satisfies SesionJwt, {
        expiresIn: entorno.jwtExpira,
      });
      const refreshToken = app.jwt.sign({ ...base, tipo: 'refresh' } satisfies SesionJwt, {
        expiresIn: entorno.refreshExpira,
      });
      reply.setCookie(COOKIE_REFRESH, refreshToken, opcionesCookie);
      return { token, refreshToken, usuario: publicoUsuario(usuario) };
    },
  );

  app.post<{ Body: { refreshToken?: string } | null }>(
    '/auth/refresh',
    {
      schema: {
        body: {
          type: ['object', 'null'],
          properties: { refreshToken: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (req, reply) => {
      // La PWA usa la cookie httpOnly; el body queda para clientes de script.
      const crudo = req.body?.refreshToken ?? req.cookies[COOKIE_REFRESH];
      if (!crudo) return reply.code(401).send({ error: 'REFRESH_INVALIDO' });
      let sesion: SesionJwt;
      try {
        sesion = app.jwt.verify<SesionJwt>(crudo);
      } catch {
        return reply.code(401).send({ error: 'REFRESH_INVALIDO' });
      }
      if (sesion.tipo !== 'refresh') {
        return reply.code(401).send({ error: 'REFRESH_INVALIDO' });
      }
      // Revocación efectiva: desactivar el usuario invalida sus refresh (SDD §10).
      const usuario = await prisma.usuario.findUnique({ where: { id: sesion.sub } });
      if (!usuario || !usuario.activo) {
        return reply.code(401).send({ error: 'REFRESH_INVALIDO' });
      }
      const token = app.jwt.sign(
        { sub: usuario.id, rol: usuario.rol, nombre: usuario.nombre, tipo: 'acceso' } satisfies SesionJwt,
        { expiresIn: entorno.jwtExpira },
      );
      return { token, usuario: publicoUsuario(usuario) };
    },
  );

  app.post('/auth/salir', async (_req, reply) => {
    reply.clearCookie(COOKIE_REFRESH, { path: opcionesCookie.path });
    return { ok: true };
  });

  app.get('/auth/yo', { preHandler: app.requiereRol('vendedor') }, async (req, reply) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.user.sub } });
    if (!usuario) return reply.code(401).send({ error: 'NO_AUTENTICADO' });
    return publicoUsuario(usuario);
  });

  // 2.0 §5.4: cambio de clave del propio usuario. Obligatorio tras entrar con la clave del
  // entorno (debeCambiarClave); disponible siempre. Auditado como `editar` sobre usuario.
  app.post<{ Body: { actual: string; nueva: string } }>(
    '/auth/cambiar-clave',
    {
      preHandler: app.requiereRol('vendedor'),
      schema: {
        body: {
          type: 'object',
          required: ['actual', 'nueva'],
          properties: { actual: { type: 'string', minLength: 1 }, nueva: { type: 'string', minLength: 8, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const usuario = await prisma.usuario.findUnique({ where: { id: req.user.sub } });
      if (!usuario || !usuario.activo) return reply.code(401).send({ error: 'NO_AUTENTICADO' });
      const valida = await argon2.verify(usuario.passwordHash, req.body.actual).catch(() => false);
      if (!valida) return reply.code(422).send({ error: 'CLAVE_ACTUAL_INVALIDA' });
      if (req.body.actual === req.body.nueva) return reply.code(422).send({ error: 'CLAVE_REPETIDA' });
      const passwordHash = await argon2.hash(req.body.nueva, { type: argon2.argon2id });
      const actualizado = await prisma.$transaction(async (tx) => {
        const u = await tx.usuario.update({ where: { id: usuario.id }, data: { passwordHash, debeCambiarClave: false } });
        await tx.auditoria.create({
          data: {
            usuarioId: usuario.id,
            entidad: 'usuario',
            entidadId: usuario.id,
            accion: 'editar',
            valorAnterior: { debeCambiarClave: usuario.debeCambiarClave },
            valorNuevo: { clave: 'cambiada', debeCambiarClave: false },
          },
        });
        return u;
      });
      return publicoUsuario(actualizado);
    },
  );
}
