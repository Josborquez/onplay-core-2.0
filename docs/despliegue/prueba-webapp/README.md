# Prueba «hola» de la Fase 0 (spec 10 §8)

App mínima para verificar el entorno «Deploy Web App» de Hostinger antes de mover onplay-core: Fastify 5 + Prisma 5.22 + esbuild, `postinstall: prisma generate`, `prisma` y `esbuild` en devDependencies a propósito (para saber si el build del panel las instala).

**Empaquetar:** `tar -a -cf prueba.zip package.json build.mjs prisma src` (sin `node_modules` ni `dist`).

**Ajustes en el panel (verificados el 2026-09-09):** Node 22 · framework Fastify · raíz `.` · **salida `.`** (con `dist` el proceso nunca arranca) · build `build` · archivo de inicio `dist/servidor.mjs` · npm.

**Variables:** `DATABASE_URL` con host **`localhost`** (el `srv1489.hstgr.io` del panel rechaza al usuario desde la Web App), `COOKIE_SECRET`. **No** poner `NODE_ENV`: npm omitiría las devDependencies en el build y el runtime ya lo recibe como `production`. `PORT` no existe (LiteSpeed Node escucha en un socket).

**Rutas y qué responden:** `/` (proxy, `x-forwarded-*`, `PORT`), `/salud` (versión de MySQL, `max_user_connections`, `GET_LOCK`, `UTC_TIMESTAMP(3)` contra las dos URLs), `/ddl` (CREATE/ALTER/FULLTEXT/`_prisma_migrations`, INSERT por el cliente, `FOR UPDATE`; `?limpiar=1` borra las tablas), `/cookie` y `/cookie/leer` (cookie `secure`+`httpOnly`), `/disco` (archivos que sobreviven a reinicios y redespliegues), `/env` (nombres de variables, memoria, CPUs), `/lento?s=70` (timeout del proxy), `/log` (cómo se ven `console.*` y pino en el panel), `/reinicio` (¿la plataforma levanta el proceso sola?).
