import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import type { SesionJwt } from '../plugins/auth.js';
import { correoDisponible, describirErrorSmtp, enviarCorreo } from '../correo.js';

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

// R-032: recuperar contraseña por correo.
const VIGENCIA_ENLACE_MIN = 60;
const MAX_POR_USUARIO_HORA = 3;
const MAX_POR_IP_15MIN = 10;
const pedidosPorIp = new Map<string, number[]>();

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Freno en memoria por IP (un proceso, P6): cuenta también los correos que no existen. */
function excedeIp(ip: string): boolean {
  const ahora = Date.now();
  const recientes = (pedidosPorIp.get(ip) ?? []).filter((t) => ahora - t < 15 * 60 * 1000);
  recientes.push(ahora);
  pedidosPorIp.set(ip, recientes);
  return recientes.length > MAX_POR_IP_15MIN;
}

const escaparHtml = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function correoRecuperacion(nombre: string, enlace: string) {
  const texto =
    `Hola ${nombre}:

Pediste restablecer tu contraseña de OnPlay Core. Abre este enlace para elegir una nueva ` +
    `(vence en ${VIGENCIA_ENLACE_MIN} minutos y sirve una sola vez):

${enlace}

` +
    `Si no fuiste tú, ignora este correo: tu contraseña sigue igual.`;
  const html =
    `<p>Hola ${escaparHtml(nombre)}:</p>` +
    `<p>Pediste restablecer tu contraseña de OnPlay Core. El enlace vence en ${VIGENCIA_ENLACE_MIN} minutos y sirve una sola vez.</p>` +
    `<p><a href="${escaparHtml(enlace)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Elegir una contraseña nueva</a></p>` +
    `<p style="color:#666;font-size:13px">Si el botón no funciona, copia esta dirección:<br>${escaparHtml(enlace)}</p>` +
    `<p style="color:#666;font-size:13px">Si no fuiste tú, ignora este correo: tu contraseña sigue igual.</p>`;
  return { texto, html };
}

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
      const exito = !!usuario && usuario.activo && valida;
      // R-026: todo inicio de sesión queda en Auditoria (`entrar`), con éxito o sin él, siempre que
      // el correo exista (sin usuario no hay a quién atribuirlo). IP real vía trustProxy.
      if (usuario) {
        await prisma.auditoria
          .create({
            data: {
              usuarioId: usuario.id,
              entidad: 'usuario',
              entidadId: usuario.id,
              accion: 'entrar',
              valorNuevo: { exito, ip: req.ip, agente: String(req.headers['user-agent'] ?? '').slice(0, 200) },
            },
          })
          .catch((e) => req.log.warn(e, 'no se pudo registrar el inicio de sesión'));
      }
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

  // R-032: la pantalla de entrar pregunta si hay correo configurado antes de ofrecer el enlace.
  app.get('/auth/recuperar', async () => ({ disponible: correoDisponible() }));

  // Siempre responde lo mismo (exista o no el correo) para no revelar quién tiene cuenta.
  app.post<{ Body: { email: string } }>(
    '/auth/recuperar',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          properties: { email: { type: 'string', format: 'email', maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      if (!correoDisponible()) return reply.code(503).send({ error: 'CORREO_NO_CONFIGURADO' });
      if (excedeIp(req.ip)) return reply.code(429).send({ error: 'DEMASIADOS_INTENTOS' });
      const email = req.body.email.trim().toLowerCase();
      const usuario = await prisma.usuario.findUnique({ where: { email } });
      if (usuario?.activo) {
        const recientes = await prisma.recuperacionClave.count({
          where: { usuarioId: usuario.id, creadoEn: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
        });
        if (recientes < MAX_POR_USUARIO_HORA) {
          const token = randomBytes(32).toString('base64url');
          await prisma.recuperacionClave.create({
            data: {
              usuarioId: usuario.id,
              tokenHash: hashToken(token),
              expiraEn: new Date(Date.now() + VIGENCIA_ENLACE_MIN * 60 * 1000),
              ip: req.ip,
            },
          });
          const { texto, html } = correoRecuperacion(usuario.nombre, `${entorno.urlPublica}/restablecer?token=${token}`);
          // Sin await: el tiempo de respuesta no delata si el correo existe.
          // El motivo va en el mensaje: el visor de logs del panel solo muestra `msg`.
          void enviarCorreo(usuario.email, 'Restablecer tu contraseña · OnPlay Core', texto, html).catch((e: unknown) =>
            req.log.error(e, `no se pudo enviar el correo de recuperación: ${describirErrorSmtp(e)}`),
          );
        } else {
          req.log.warn({ usuarioId: usuario.id }, 'recuperación de clave: tope por hora alcanzado');
        }
      }
      return { ok: true };
    },
  );

  app.post<{ Body: { token: string; nueva: string } }>(
    '/auth/restablecer',
    {
      schema: {
        body: {
          type: 'object',
          required: ['token', 'nueva'],
          properties: {
            token: { type: 'string', minLength: 20, maxLength: 200 },
            nueva: { type: 'string', minLength: 8, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const solicitud = await prisma.recuperacionClave.findUnique({
        where: { tokenHash: hashToken(req.body.token) },
        include: { usuario: true },
      });
      if (!solicitud || solicitud.usadoEn || solicitud.expiraEn < new Date() || !solicitud.usuario.activo) {
        return reply.code(422).send({ error: 'ENLACE_INVALIDO' });
      }
      const passwordHash = await argon2.hash(req.body.nueva, { type: argon2.argon2id });
      const usado = await prisma.$transaction(async (tx) => {
        // Marca TODOS los enlaces abiertos del usuario; el `usadoEn: null` evita el doble uso en carrera.
        const marcados = await tx.recuperacionClave.updateMany({
          where: { id: solicitud.id, usadoEn: null },
          data: { usadoEn: new Date() },
        });
        if (marcados.count === 0) return false;
        await tx.recuperacionClave.updateMany({
          where: { usuarioId: solicitud.usuarioId, usadoEn: null },
          data: { usadoEn: new Date() },
        });
        await tx.usuario.update({ where: { id: solicitud.usuarioId }, data: { passwordHash, debeCambiarClave: false } });
        await tx.auditoria.create({
          data: {
            usuarioId: solicitud.usuarioId,
            entidad: 'usuario',
            entidadId: solicitud.usuarioId,
            accion: 'editar',
            valorAnterior: { debeCambiarClave: solicitud.usuario.debeCambiarClave },
            valorNuevo: { clave: 'restablecida por correo', ip: req.ip },
          },
        });
        return true;
      });
      if (!usado) return reply.code(422).send({ error: 'ENLACE_INVALIDO' });
      return { ok: true };
    },
  );
}
