import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import estaticos from '@fastify/static';
import authPlugin from './plugins/auth.js';
import rutasAuth from './rutas/auth.js';
import rutasClientes from './rutas/clientes.js';
import rutasProductos from './rutas/productos.js';
import rutasSalud from './rutas/salud.js';
import rutasStock from './rutas/stock.js';
import rutasRecuentos from './rutas/recuentos.js';
import rutasDevoluciones from './rutas/devoluciones.js';
import rutasSync from './rutas/sync.js';
import rutasSincronizacion from './rutas/sincronizacion.js';
import rutasCanales from './rutas/canales.js';
import rutasTurnos from './rutas/turnos.js';
import rutasVentas from './rutas/ventas.js';
import { entorno } from './entorno.js';

export async function construirServidor() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? (entorno.nodeEnv === 'production' ? 'info' : 'debug'),
    },
  });

  await app.register(cors, {
    origin: entorno.corsOrigins.length > 0 ? entorno.corsOrigins : true,
  });
  // gzip para respuestas grandes (catálogo offline §5.2); solo si el cliente lo acepta.
  await app.register(compress, { encodings: ['gzip'] });
  // Cookie httpOnly del refresh token (H7, 05-SDD §14). Sin firma: el JWT ya va firmado.
  await app.register(cookie);
  await app.register(authPlugin);

  await app.register(rutasSalud);
  await app.register(rutasAuth, { prefix: '/api/v1' });
  await app.register(rutasSync, { prefix: '/api/v1' });
  await app.register(rutasSincronizacion, { prefix: '/api/v1' }); // E3 §6.1–6.2
  await app.register(rutasCanales, { prefix: '/api/v1' }); // E3 §6.3
  await app.register(rutasProductos, { prefix: '/api/v1' });
  await app.register(rutasStock, { prefix: '/api/v1' }); // E2 §7.1
  await app.register(rutasRecuentos, { prefix: '/api/v1' }); // E2 §7.2
  await app.register(rutasDevoluciones, { prefix: '/api/v1' }); // E2 §7.3
  await app.register(rutasTurnos, { prefix: '/api/v1' });
  await app.register(rutasVentas, { prefix: '/api/v1' });
  await app.register(rutasClientes, { prefix: '/api/v1' });

  // Producción (P6, H7): el MISMO proceso sirve el build de la web para que la
  // cookie httpOnly SameSite=Strict funcione sin proxy. En dev lo hace Vite.
  if (entorno.nodeEnv === 'production') {
    const aqui = dirname(fileURLToPath(import.meta.url));
    // Desde src/ (tsx) es ../../web/dist; desde dist/src/ (compilado) uno más.
    const webDist = [resolve(aqui, '../../../web/dist'), resolve(aqui, '../../web/dist')].find(existsSync);
    if (webDist) {
      await app.register(estaticos, { root: webDist });
      // SPA: cualquier GET que no sea de la API vuelve a index.html (React Router).
      app.setNotFoundHandler((req, reply) => {
        if (req.method === 'GET' && !req.url.startsWith('/api/')) {
          return reply.sendFile('index.html');
        }
        return reply.code(404).send({ error: 'NO_ENCONTRADO' });
      });
      app.log.info({ webDist }, 'sirviendo la web estática (producción)');
    } else {
      app.log.warn({}, 'apps/web/dist no existe: la API corre sin la web (falta npm run build)');
    }
  }

  return app;
}
