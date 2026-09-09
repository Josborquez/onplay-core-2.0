// Arranque autosuficiente (10-SDD §5.1, P10): desde una base vacía el proceso migra, siembra,
// crea el admin inicial y escucha, sin que nadie ejecute un comando. Cada paso deja una línea de
// log con su duración. Si la migración falla, el proceso NO escucha y sale con código 1: es
// preferible una app caída con un log legible a una app viva con esquema desalineado.
import './arranque/tz.js'; // PRIMERO: fija TZ=UTC antes de que nadie lea fechas
import { entorno } from './entorno.js';
import { construirServidor } from './servidor.js';
import { prisma } from './db.js';
import { aplicarMigraciones, ErrorMigracion } from './arranque/migrador.js';
import { sembrar } from './arranque/semillas.js';
import { crearAdminInicial } from './arranque/adminInicial.js';
import { respaldarAntesDeMigrar } from './arranque/respaldo.js';
import { iniciarCronCompleta, iniciarCronIncremental, iniciarCronRespaldo } from './sync/cron.js';
import { abortarCorridasColgadas } from './sync/corridas.js';
import { marcarArranque } from './rutas/salud.js';
import { version } from './version.js';

const inicio = Date.now();
const app = await construirServidor();

async function paso<T>(nombre: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const r = await fn();
  app.log.info({ paso: nombre, ms: Date.now() - t }, 'arranque');
  return r;
}

try {
  // 3. Migrar (con respaldo previo si hay pendientes, §5.3/§5.6).
  const mig = await paso('migrar', () =>
    aplicarMigraciones({ url: entorno.databaseUrl, log: app.log, antesDeAplicar: (pendientes) => respaldarAntesDeMigrar(pendientes, app.log) }),
  );
  if (mig.aplicadas.length > 0) app.log.warn({ aplicadas: mig.aplicadas }, 'migraciones aplicadas al arrancar');
  // 4. Sembrar (idempotente).
  const semillas = await paso('sembrar', () => sembrar(prisma));
  // 5. Admin inicial si no hay usuarios activos.
  const admin = await paso('admin inicial', () => crearAdminInicial(prisma, app.log));
  // 6. E3 §6.1: barrido de arranque — una corrida que quedó en_curso por un reinicio se aborta.
  const abortadas = await paso('barrido de corridas', () => abortarCorridasColgadas());
  if (abortadas > 0) app.log.warn({ abortadas }, 'corridas de sync abortadas por el barrido de arranque');
  // 8. Escuchar. En la Web App PORT no existe: LiteSpeed Node redirige listen() a su socket (R-019).
  await app.listen({ port: entorno.puerto, host: '0.0.0.0' });
  marcarArranque();
  iniciarCronIncremental(app.log); // §6.5: solo en el proceso servidor, no en tests
  iniciarCronCompleta(app.log); // E3 §6.4
  iniciarCronRespaldo(app.log); // 2.0 §5.6
  app.log.info({ version, ms: Date.now() - inicio, admin, semillas, migradas: mig.omitidas + mig.aplicadas.length }, 'onplay-core listo');
} catch (err) {
  app.log.fatal(err, err instanceof ErrorMigracion ? 'ARRANQUE DETENIDO: la migración falló y el proceso no escucha (10-SDD §5.1)' : 'ARRANQUE DETENIDO');
  process.exit(1);
}
