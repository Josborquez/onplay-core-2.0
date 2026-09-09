import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { rolAlcanza, type Rol } from '@onplay/dominio';
import { entorno } from '../entorno.js';

export interface SesionJwt {
  sub: string;
  rol: Rol;
  nombre: string;
  tipo: 'acceso' | 'refresh';
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SesionJwt;
    user: SesionJwt;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    // Autorización por rol, verificada en el servidor en cada endpoint (SDD §10).
    requiereRol: (rolMinimo: Rol) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app: FastifyInstance) => {
  await app.register(jwt, { secret: entorno.jwtSecret });

  app.decorate('requiereRol', (rolMinimo: Rol) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(401).send({ error: 'NO_AUTENTICADO' });
      }
      if (req.user.tipo !== 'acceso') {
        return reply.code(401).send({ error: 'TOKEN_INVALIDO' });
      }
      if (!rolAlcanza(req.user.rol, rolMinimo)) {
        return reply.code(403).send({ error: 'ROL_INSUFICIENTE' });
      }
    };
  });
});
