import { construirServidor } from './servidor.js';
import { entorno } from './entorno.js';
import { iniciarCronCompleta, iniciarCronIncremental } from './sync/cron.js';
import { abortarCorridasColgadas } from './sync/corridas.js';

const app = await construirServidor();

try {
  // E3 §6.1: barrido de arranque — una corrida que quedó en_curso por un reinicio se aborta.
  const abortadas = await abortarCorridasColgadas();
  if (abortadas > 0) app.log.warn({ abortadas }, 'corridas de sync abortadas por el barrido de arranque');
  await app.listen({ port: entorno.puerto, host: '0.0.0.0' });
  iniciarCronIncremental(app.log); // §6.5: solo en el proceso servidor, no en tests
  iniciarCronCompleta(app.log); // E3 §6.4
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
