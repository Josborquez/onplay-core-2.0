process.env.TZ = 'UTC';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const inicio = Date.now();
const aqui = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true, trustProxy: true });
await app.register(cookie, { secret: process.env.COOKIE_SECRET || 'prueba-sin-secreto' });

// Las URLs de base pueden venir del entorno o, para la prueba, de un archivo config.json junto al bundle.
const config = existsSync(join(aqui, 'config.json')) ? JSON.parse(readFileSync(join(aqui, 'config.json'), 'utf8')) : {};
const urls = {
  principal: process.env.DATABASE_URL || config.DATABASE_URL,
  alterna: process.env.DATABASE_URL_2 || config.DATABASE_URL_2,
};
const clientes = {};
function cliente(nombre) {
  if (!urls[nombre]) throw new Error(`sin URL para base ${nombre}`);
  clientes[nombre] ??= new PrismaClient({ datasourceUrl: urls[nombre] });
  return clientes[nombre];
}
const enmascarar = (u) => (u ? u.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@') : null);

async function probarBase(nombre) {
  if (!urls[nombre]) return { nombre, omitida: true };
  const t = Date.now();
  try {
    const p = cliente(nombre);
    const [v] = await p.$queryRawUnsafe(
      'SELECT VERSION() AS version, @@version_comment AS comentario, @@max_user_connections AS maxConexionesUsuario, @@max_connections AS maxConexiones, @@sql_mode AS sqlMode, @@time_zone AS zona, UTC_TIMESTAMP(3) AS utc, NOW(3) AS ahora'
    );
    const [l] = await p.$queryRawUnsafe("SELECT GET_LOCK('onplay_prueba', 5) AS candado");
    await p.$queryRawUnsafe("SELECT RELEASE_LOCK('onplay_prueba')");
    const plano = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'bigint' ? Number(x) : x]));
    return { nombre, url: enmascarar(urls[nombre]), ok: true, ms: Date.now() - t, ...plano, getLock: Number(l.candado) };
  } catch (e) {
    return { nombre, url: enmascarar(urls[nombre]), ok: false, ms: Date.now() - t, error: String(e.message).slice(0, 400) };
  }
}

app.get('/', async (req) => ({
  hola: 'onplay-core prueba Fase 0 (SDD 10)',
  node: process.version,
  pid: process.pid,
  cwd: process.cwd(),
  archivo: aqui,
  arrancadoHace_s: Math.round((Date.now() - inicio) / 1000),
  puerto: process.env.PORT ?? null,
  protocolo: req.protocol,
  hostname: req.hostname,
  ip: req.ip,
  cabeceras: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith('x-forwarded') || k === 'host' || k === 'via' || k === 'x-real-ip')),
  tz: process.env.TZ,
  fechaLocal: new Date().toString(),
}));

app.get('/salud', async () => {
  const t = Date.now();
  const bases = await Promise.all([probarBase('principal'), probarBase('alterna')]);
  return { estado: bases.some((b) => b.ok) ? 'ok' : 'sin_base', ms: Date.now() - t, bases };
});

app.get('/ddl', async (req) => {
  const nombre = req.query.base === 'alterna' ? 'alterna' : 'principal';
  const pasos = [];
  const paso = async (titulo, fn) => {
    const t = Date.now();
    try { const r = await fn(); pasos.push({ titulo, ok: true, ms: Date.now() - t, resultado: r ?? null }); }
    catch (e) { pasos.push({ titulo, ok: false, ms: Date.now() - t, error: String(e.message).slice(0, 400) }); }
  };
  let p;
  await paso('cliente', async () => { p = cliente(nombre); return enmascarar(urls[nombre]); });
  if (!p) return { base: nombre, pasos };
  await paso('CREATE TABLE Prueba', () => p.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS `Prueba` (`id` INT NOT NULL AUTO_INCREMENT, `nota` VARCHAR(191) NOT NULL, `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  ));
  await paso('ALTER TABLE ADD COLUMN', async () => {
    try { return await p.$executeRawUnsafe('ALTER TABLE `Prueba` ADD COLUMN `extra` VARCHAR(20) NULL'); }
    catch (e) { if (/Duplicate column/i.test(e.message)) return 'ya existia'; throw e; }
  });
  await paso('CREATE TABLE con FULLTEXT', () => p.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS `PruebaTexto` (`id` INT NOT NULL AUTO_INCREMENT, `texto` VARCHAR(191) NOT NULL, PRIMARY KEY (`id`), FULLTEXT INDEX `PruebaTexto_texto_idx`(`texto`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  ));
  await paso('CREATE TABLE _prisma_migrations', () => p.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS `_prisma_migrations` (`id` VARCHAR(36) NOT NULL, `checksum` VARCHAR(64) NOT NULL, `finished_at` DATETIME(3) NULL, `migration_name` VARCHAR(255) NOT NULL, `logs` TEXT NULL, `rolled_back_at` DATETIME(3) NULL, `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `applied_steps_count` INT UNSIGNED NOT NULL DEFAULT 0, PRIMARY KEY (`id`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  ));
  await paso('INSERT via cliente Prisma', () => p.prueba.create({ data: { nota: `desde ${process.pid} ${new Date().toISOString()}` } }));
  await paso('tx SELECT FOR UPDATE + UTC_TIMESTAMP(3)', () => p.$transaction(async (tx) => {
    const filas = await tx.$queryRawUnsafe('SELECT id FROM `Prueba` ORDER BY id DESC LIMIT 1 FOR UPDATE');
    await tx.$executeRawUnsafe('UPDATE `Prueba` SET `creadoEn` = UTC_TIMESTAMP(3) WHERE id = ?', filas[0]?.id ?? 0);
    return filas;
  }));
  await paso('COUNT', async () => ({ filas: await p.prueba.count() }));
  await paso('SHOW CREATE TABLE', async () => (await p.$queryRawUnsafe('SHOW CREATE TABLE `Prueba`'))[0]);
  if (req.query.limpiar === '1') {
    await paso('DROP tablas de prueba', () => p.$executeRawUnsafe('DROP TABLE IF EXISTS `Prueba`, `PruebaTexto`, `_prisma_migrations`'));
  }
  return { base: nombre, pasos };
});

app.get('/cookie', async (req, res) => {
  res.setCookie('prueba_refresh', `ok-${Date.now()}`, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', signed: false });
  return { puesta: true, protocolo: req.protocol };
});
app.get('/cookie/leer', async (req) => ({ cookies: req.cookies, protocolo: req.protocol }));

app.get('/disco', async () => {
  const dir = join(aqui, '..', 'datos');
  mkdirSync(dir, { recursive: true });
  const nombre = `marca-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  writeFileSync(join(dir, nombre), `pid ${process.pid}\n`);
  const info = existsSync(join(aqui, 'build-info.json')) ? JSON.parse(readFileSync(join(aqui, 'build-info.json'), 'utf8')) : null;
  // Segundo directorio FUERA del árbol de la versión desplegada: $HOME es el directorio del dominio.
  let persistente = null;
  try {
    const dir2 = join(process.env.HOME || '/tmp', 'onplay-datos');
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir2, nombre), `pid ${process.pid}\n`);
    persistente = { directorio: dir2, archivos: readdirSync(dir2).sort() };
  } catch (e) { persistente = { error: String(e.message) }; }
  return { directorio: dir, archivos: readdirSync(dir).sort(), buildInfo: info, persistente };
});

app.get('/env', async () => ({
  nombres: Object.keys(process.env).sort(),
  plataforma: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(LS|NODE_OPTIONS|TZ|PATH)/.test(k))),
  version: 2,
  PORT: process.env.PORT ?? null,
  NODE_ENV: process.env.NODE_ENV ?? null,
  HOME: process.env.HOME ?? null,
  USER: process.env.USER ?? null,
  PWD: process.env.PWD ?? null,
  cwd: process.cwd(),
  memoriaMB: Math.round(process.memoryUsage().rss / 1048576),
  cpus: os.cpus().length,
  totalmemMB: Math.round(os.totalmem() / 1048576),
  uptimeSistema_h: Math.round(os.uptime() / 3600),
}));

app.get('/lento', async (req) => {
  const s = Math.min(Number(req.query.s ?? 70), 600);
  await new Promise((r) => setTimeout(r, s * 1000));
  return { espere_s: s, ok: true };
});

app.get('/log', async () => {
  console.log('console.log desde /log');
  console.warn('console.warn desde /log');
  console.error('console.error desde /log');
  app.log.info({ marca: 'pino' }, 'pino info desde /log');
  app.log.warn('pino warn desde /log');
  app.log.error('pino error desde /log');
  return { escrito: true };
});

app.get('/reinicio', async () => {
  setTimeout(() => process.exit(1), 300);
  return { saliendo: true, pid: process.pid };
});

const puerto = Number(process.env.PORT) || 3000;
if (!process.env.PORT) app.log.warn('PORT no viene del entorno; usando 3000');
await app.listen({ port: puerto, host: '0.0.0.0' });
app.log.info({ puerto, ms: Date.now() - inicio }, 'prueba Fase 0 escuchando');
