import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import type { SesionJwt } from '../plugins/auth.js';

function publicoUsuario(u: { id: string; nombre: string; email: string; rol: string }) {
  return { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol };
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
}
