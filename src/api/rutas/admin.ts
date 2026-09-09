// Tareas administrativas como endpoints (10-SDD §5.5, P12): en la Web App no hay shell, así que
// lo que antes era un comando (seed, crear-admin, renumerar-ind, migrate status, mysqldump) es
// un endpoint con rol admin, dryRun donde tiene sentido y rastro en Auditoria.
import { createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import { estadoMigraciones } from '../arranque/migrador.js';
import { sembrar } from '../arranque/semillas.js';
import { aplicarRenumeracion, planRenumeracion } from '../arranque/renumerar.js';
import { generarRespaldo, listarRespaldos, rutaRespaldo } from '../arranque/respaldo.js';

const ROLES = ['vendedor', 'encargado', 'admin'] as const;
type Rol = (typeof ROLES)[number];

export default async function rutasAdmin(app: FastifyInstance) {
  const soloAdmin = app.requiereRol('admin');

  // `prisma migrate status` sin shell: aplicadas, pendientes, fallidas, conflictos de checksum.
  app.get('/admin/migraciones', { preHandler: soloAdmin }, async () => {
    const e = await estadoMigraciones(prisma);
    return { ...e, alDia: e.pendientes.length === 0 && e.fallidas.length === 0 && e.conflictos.length === 0 };
  });

  // Re-sembrar tras agregar una semilla nueva sin reiniciar. Idempotente.
  app.post('/admin/sembrar', { preHandler: soloAdmin }, async (req) => {
    const r = await sembrar(prisma);
    await prisma.auditoria.create({
      data: { usuarioId: req.user.sub, entidad: 'sistema', entidadId: 'semillas', accion: 'editar', valorNuevo: { ...r } },
    });
    return r;
  });

  // R-010. dryRun por defecto (S1): responde el plan; con dryRun=false renombra y audita.
  app.post<{ Querystring: { dryRun?: string } }>('/admin/renumerar-ind', { preHandler: soloAdmin }, async (req) => {
    const dryRun = req.query.dryRun !== 'false';
    const plan = await planRenumeracion(prisma);
    const resumen = {
      dryRun,
      totalInd: plan.totalInd,
      renombrables: plan.renombrar.length,
      sinForma: plan.sinForma.length,
      colisiones: plan.colisiones.length,
      muestra: plan.renombrar.slice(0, 20),
      sinFormaMuestra: plan.sinForma.slice(0, 20),
      colisionesMuestra: plan.colisiones.slice(0, 20),
    };
    if (dryRun) return { ...resumen, aplicados: 0 };
    const aplicados = await aplicarRenumeracion(prisma, plan, req.user.sub);
    return { ...resumen, aplicados };
  });

  // ─── Usuarios (cierra H1 solo en lo mínimo: listar, crear, activar/desactivar) ───
  app.get('/admin/usuarios', { preHandler: soloAdmin }, async () => {
    const usuarios = await prisma.usuario.findMany({
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      select: { id: true, nombre: true, email: true, rol: true, activo: true, debeCambiarClave: true, creadoEn: true },
    });
    return { usuarios };
  });

  app.post<{ Body: { email: string; nombre: string; rol: Rol; password?: string } }>(
    '/admin/usuarios',
    {
      preHandler: soloAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['email', 'nombre', 'rol'],
          properties: {
            email: { type: 'string', format: 'email' },
            nombre: { type: 'string', minLength: 1, maxLength: 120 },
            rol: { type: 'string', enum: [...ROLES] },
            password: { type: 'string', minLength: 8, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, nombre, rol } = req.body;
      const existente = await prisma.usuario.findUnique({ where: { email } });
      if (existente) return reply.code(409).send({ error: 'EMAIL_YA_EXISTE' });
      const generada = !req.body.password;
      const password = req.body.password ?? randomBytes(9).toString('base64url');
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const creado = await prisma.$transaction(async (tx) => {
        // Clave de un solo uso: quien entra debe cambiarla (misma regla que el admin inicial).
        const u = await tx.usuario.create({ data: { email, nombre, rol, passwordHash, activo: true, debeCambiarClave: true } });
        await tx.auditoria.create({
          data: { usuarioId: req.user.sub, entidad: 'usuario', entidadId: u.id, accion: 'crear', valorNuevo: { email, nombre, rol } },
        });
        return u;
      });
      return reply.code(201).send({
        usuario: { id: creado.id, nombre, email, rol, activo: true, debeCambiarClave: true },
        // Solo se muestra una vez, aquí. No se guarda en ningún lado.
        passwordInicial: generada ? password : null,
      });
    },
  );

  app.patch<{ Params: { id: string }; Body: { activo?: boolean; rol?: Rol; nombre?: string } }>(
    '/admin/usuarios/:id',
    {
      preHandler: soloAdmin,
      schema: {
        body: {
          type: 'object',
          properties: { activo: { type: 'boolean' }, rol: { type: 'string', enum: [...ROLES] }, nombre: { type: 'string', minLength: 1, maxLength: 120 } },
        },
      },
    },
    async (req, reply) => {
      const u = await prisma.usuario.findUnique({ where: { id: req.params.id } });
      if (!u) return reply.code(404).send({ error: 'USUARIO_NO_ENCONTRADO' });
      if (u.id === req.user.sub && (req.body.activo === false || (req.body.rol && req.body.rol !== 'admin'))) {
        return reply.code(422).send({ error: 'NO_PUEDES_DEGRADARTE' });
      }
      const data = { activo: req.body.activo, rol: req.body.rol, nombre: req.body.nombre };
      const actualizado = await prisma.$transaction(async (tx) => {
        const r = await tx.usuario.update({ where: { id: u.id }, data });
        await tx.auditoria.create({
          data: {
            usuarioId: req.user.sub,
            entidad: 'usuario',
            entidadId: u.id,
            accion: 'editar',
            valorAnterior: { activo: u.activo, rol: u.rol, nombre: u.nombre },
            valorNuevo: { activo: r.activo, rol: r.rol, nombre: r.nombre },
          },
        });
        return r;
      });
      return { id: actualizado.id, nombre: actualizado.nombre, email: actualizado.email, rol: actualizado.rol, activo: actualizado.activo };
    },
  );

  // ─── Respaldo lógico (§5.6) ───
  app.get('/admin/respaldos', { preHandler: soloAdmin }, async () => ({
    directorio: entorno.respaldoDir,
    retencion: entorno.respaldoRetencion,
    cron: entorno.respaldoCron,
    respaldos: listarRespaldos(),
  }));

  app.post('/admin/respaldo', { preHandler: soloAdmin }, async (req) => {
    const r = await generarRespaldo({ motivo: 'manual', log: app.log });
    await prisma.auditoria.create({
      data: { usuarioId: req.user.sub, entidad: 'respaldo', entidadId: r.id, accion: 'crear', valorNuevo: { bytes: r.bytes, tablas: r.tablas, filas: r.filas } },
    });
    return r;
  });

  // Descarga: contiene TODOS los datos del negocio. Solo admin, con Bearer (descargar() de api.ts).
  app.get<{ Params: { id: string } }>('/admin/respaldos/:id', { preHandler: soloAdmin }, async (req, reply) => {
    const ruta = rutaRespaldo(req.params.id);
    if (!ruta) return reply.code(404).send({ error: 'RESPALDO_NO_ENCONTRADO' });
    return reply
      .header('Content-Type', 'application/gzip')
      .header('Content-Disposition', `attachment; filename="${req.params.id}"`)
      .send(createReadStream(ruta));
  });
}
