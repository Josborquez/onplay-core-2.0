# SDD — onplay-core 2.0: despliegue como Web App Node.js de Hostinger
## Especificación ejecutable

**Versión:** 1.0 · **Fecha:** 2026-09-09 · **Estado:** **Fases 0–3 hechas el 2026-09-09; Fase 4 (despliegue) en curso.** §16 recoge lo verificado en el entorno real y **corrige** a §5.1, §5.2, §5.6, §5.7, §5.8, §6 y §9; los desvíos de implementación están en `08` R-020. Decisiones §14 del dueño (2026-09-09): #4 `core.onplaygames.cl`; #6 el plan incluye varias Web Apps; #7 solo reempaquetado (§2); #8/#9 repositorio nuevo `onplay-core-2.0` conectado por Git; base `u382410428_onplaycore`.
**Documento rector:** `01-SDD-general.md` v1.2 (sigue vigente en todo lo que este documento no cambia).
**Referencia de despliegue:** OnplayPOS v2 (`github.com/Josborquez/OnplayPOSv2`), que su documentación ubica en `onplaypos.onplaygames.cl`. **Ojo (R-019, 2026-09-09):** ese sitio no existe en la cuenta de Hostinger; lo que la spec toma de OnplayPOS son lecciones de sus intentos de build, no de una app en producción. Ver §16.

> **Regla de lectura.** Este documento cambia *cómo se empaqueta, arranca y opera* onplay-core. No cambia el modelo de datos, las reglas de negocio, las pantallas ni las etapas E1–E4. Todo lo que aquí no se menciona se hereda tal cual de la 1.x. Una sesión de Claude Code que implemente esta spec debe leer primero `CLAUDE.md` y `01-SDD-general.md` §3 (principios) y §8.3 (reglas S1–S4): siguen siendo vinculantes.

---

## 1. Qué resuelve

La 1.x se diseñó para un VPS (01 §5: Node + MySQL detrás de Nginx, con pm2, `git pull` + `prisma migrate deploy` a mano). El dueño quiere desplegar en el **hosting que ya paga**, usando la función «Deploy Web App» de Hostinger (planes Business/Cloud), igual que OnplayPOS v2. Ese entorno es un Node administrado con estas restricciones, verificadas en la documentación de Hostinger y en la experiencia de OnplayPOS:

| Restricción del entorno | Efecto en la 1.x | Qué hace la 2.0 |
|---|---|---|
| El archivo de inicio debe ser `.js`/`.mjs`/`.cjs`, no un script npm | Producción corre con `tsx src/index.ts` (TypeScript sin compilar, paquetes consumidos desde fuente) | Build a **un solo archivo JavaScript** con esbuild (§5.2) |
| No hay SSH ni terminal | `prisma migrate deploy`, `seed`, `crear-admin`, `renumerar-ind` se corren a mano | **Migrador propio al arrancar** (§5.3), semillas y admin inicial automáticos (§5.4), tareas administrativas como endpoints (§5.5) |
| Los binarios de Prisma no se pueden ejecutar durante el build (`EACCES`, OnplayPOS commit `8381e13`) | `prisma migrate` usa el *schema engine*, un binario | El migrador aplica los `migration.sql` con el **cliente de consultas** (que sí corre, OnplayPOS lo demuestra); nunca invoca `prisma migrate` ni `db push` |
| Sin `mysqldump` ni cron del sistema | Respaldo diario por cron (`docs/despliegue`) | **Respaldo lógico desde la app** (§5.6) + respaldos del panel de Hostinger |
| Proceso administrado: se puede reiniciar sin aviso, recursos compartidos con las tiendas Woo | pm2 con reinicio controlado | Arranque idempotente y rápido, crons tolerantes a reinicio, vigilancia externa de `/salud` (§5.7), lotes chicos |
| Detrás de un proxy de Hostinger con HTTPS propio | Nginx propio con `X-Forwarded-Proto` | `trustProxy` en Fastify; sin Nginx (§5.8) |
| Variables de entorno desde el panel; `PORT` lo asigna la plataforma | `.env` en disco | Sin `.env` en producción; `PORT` obligatorio desde el entorno (§9) |
| Sin elección documentada de subcarpeta para monorepos | Workspaces npm (`apps/*`, `packages/*`) | **Un solo paquete** en la raíz (§4). Decisión D-2.0-1 |
| Un plan incluye un número fijo de Web Apps | Staging en el mismo VPS | Staging = segunda Web App con su propia base (§10) |

Lo que **no** cambia: MySQL/MariaDB con Prisma 5.22, Fastify, React 19 + Vite + Tailwind, un proceso que sirve API y web desde el mismo origen (H7), IndexedDB offline en el mostrador, libros append-only, `dryRun` por defecto, candado `SYNC_SOLO_LECTURA`.

## 2. Qué NO hace esta versión

- **No agrega funcionalidad** de negocio. Ninguna pantalla, tabla ni regla nueva. Lo que se pida por el camino se agenda (P1).
- **No reescribe** módulos que funcionan: `packages/dominio`, `packages/woo-client`, `apps/api/src/*`, `apps/web/src/*` se **mueven**, no se reescriben. Los 92 tests de dominio y los de woo-client deben pasar sin cambios de lógica.
- **No cambia el esquema** de Prisma ni las migraciones existentes. El migrador nuevo debe aplicar las migraciones actuales tal cual están.
- **No introduce Docker, colas, ni servicios externos** (P6). La vigilancia externa de §5.7 es un ping HTTP, no un servicio nuestro.
- **No abre el candado de E3.** La Fase 0 de E3 (`06` §9) sigue siendo del dueño; en la 2.0 el «entorno de staging» es la segunda Web App de §10.
- **No mantiene dos ramas de producto.** La 2.0 reemplaza a la 1.x; `docs/despliegue/` (VPS) queda como alternativa documentada, no como segundo camino activo.

## 3. Principios adicionales de la 2.0

Se suman a P1–P9 y S1–S4 de `01`:

- **P10 — Arranque autosuficiente.** El proceso debe poder levantarse desde cero (base vacía, sin usuarios) y quedar operativo sin que nadie ejecute un comando: migra, siembra, crea el admin inicial y escucha. Y debe poder reiniciarse cien veces sin efectos acumulados (todo idempotente).
- **P11 — Nada que dependa de un binario ajeno al build.** El proceso en producción solo necesita Node, `node_modules` y la base. Si algo exige ejecutar un binario (schema engine, `mysqldump`, `tsx`), no entra.
- **P12 — Toda operación administrativa que antes era un comando es un endpoint auditado**, con rol admin, `dryRun` donde tenga sentido y resultado visible en el backoffice. Sin excepciones «temporales por phpMyAdmin»: eso es lo que hizo que OnplayPOS tuviera esquema y código desalineados.
- **P13 — Presupuesto de recursos explícito.** El proceso comparte CPU e I/O con las tiendas Woo. Cada tarea pesada (importación completa, verificación de stock, respaldo) declara lote y pausa entre lotes, y es interrumpible por reinicio sin dejar estado a medias.

## 4. Estructura del repositorio

Un solo `package.json` en la raíz, sin workspaces. Se conserva la separación por carpetas; cambia solo el mecanismo de resolución (imports relativos o alias de TypeScript en vez de paquetes npm internos).

```
onplay-core/                       # rama `2.0` hasta la Fase 5; luego reemplaza a main
├── package.json                   # ÚNICO: deps de API + web, scripts build/start/test
├── tsconfig.json                  # base estricta; paths: @dominio/*, @woo/*
├── tsconfig.web.json              # extiende la base para src/web (DOM, JSX)
├── esbuild.config.mjs             # empaqueta src/api → dist/servidor.mjs (§5.2)
├── vite.config.ts                 # src/web → dist/web
├── prisma/
│   ├── schema.prisma              # sin cambios
│   ├── migrations/                # sin cambios; el migrador las lee de aquí (§5.3)
│   └── seed.ts                    # se convierte en función `sembrar(prisma)` (§5.4)
├── src/
│   ├── api/                       # = apps/api/src (Fastify, rutas, sync, stock)
│   │   ├── index.ts               # arranque §5.1
│   │   ├── arranque/              # NUEVO: migrador.ts, semillas.ts, adminInicial.ts
│   │   └── rutas/admin.ts         # NUEVO: tareas administrativas §5.5, respaldo §5.6
│   ├── dominio/                   # = packages/dominio/src (con sus tests)
│   ├── woo/                       # = packages/woo-client/src (con sus tests)
│   └── web/                       # = apps/web/src
├── dist/                          # generado por `npm run build`; NO versionado
│   ├── servidor.mjs               # archivo de inicio que se declara en Hostinger
│   └── web/                       # bundle de la PWA
├── docs/                          # todos los SDD anteriores + este
└── CLAUDE.md                      # actualizado en la Fase 5
```

**D-2.0-1 (decisión):** un solo paquete en vez de workspaces. Motivo: la plataforma no documenta selección de subcarpeta ni instalación de workspaces; OnplayPOS funciona con un paquete plano. Costo: los alias `@onplay/dominio` pasan a `@dominio/*`; es un cambio mecánico de imports que TypeScript verifica. Si el dueño confirma que el panel permite «root directory» (§14 #1), la decisión se mantiene igual: menos piezas es mejor en un entorno sin shell.

## 5. Diseño

### 5.1 Arranque (`src/api/index.ts`)

Orden fijo, cada paso escribe una línea de log con duración:

1. Leer entorno (§9). `PORT` y `DATABASE_URL` faltantes → salir con código 1 y mensaje claro (el panel lo muestra).
2. Conectar Prisma con `connection_limit` bajo (§6).
3. **Migrar** (§5.3). Si falla → el proceso **no escucha** y sale con código 1: es preferible una app caída con un log legible a una app viva con esquema desalineado.
4. **Sembrar** (§5.4): canales, categorías, correlativos, ubicaciones, `SRV-000001`, usuario `sistema@onplay.cl`. Idempotente.
5. **Admin inicial** (§5.4) si no existe ningún usuario activo.
6. `abortarCorridasColgadas()` (ya existe) — cubre los reinicios sin aviso.
7. Registrar rutas, estáticos de `dist/web`, crons (§5.7).
8. `listen({ port: PORT, host: '0.0.0.0' })`.

Presupuesto: del paso 1 al 8 en **menos de 10 s** con la base al día (el panel puede declarar la app caída si tarda más en responder tras un reinicio).

### 5.2 Build

```json
"scripts": {
  "build": "npm run build:web && npm run build:api",
  "build:web": "tsc -p tsconfig.web.json --noEmit && vite build",
  "build:api": "tsc -p tsconfig.json --noEmit && node esbuild.config.mjs",
  "start": "node dist/servidor.mjs",
  "test": "vitest run",
  "postinstall": "prisma generate"
}
```

- `esbuild`: `platform: 'node'`, `format: 'esm'`, `target: 'node22'`, `bundle: true`, `external: ['@prisma/client', '.prisma/client', 'argon2']` (nativos), `banner` con `createRequire` para los CJS que lo necesiten. Un solo archivo de salida: `dist/servidor.mjs`.
- `postinstall: prisma generate` está **probado en Hostinger** por OnplayPOS. `prisma migrate`/`db push` en cualquier script de npm están **prohibidos** (fallan con `EACCES` y, peor, podrían funcionar a medias).
- `prisma/migrations/**/*.sql` se copian a `dist/migrations/` en el build (el migrador los lee relativos a `dist/`).
- Ni `tsx` ni `typescript` ni `vite` son necesarios en runtime: van en `devDependencies`. Verificar que el panel instala devDependencies para el build (OnplayPOS: sí, porque `vite build` corre allí — confirmar en §14 #2).
- En Hostinger: **install** = `npm ci` (o `npm install`, según lo que ofrezca el panel), **build** = `npm run build`, **archivo de inicio** = `dist/servidor.mjs`, **Node** = 22.

### 5.3 Migrador propio (`src/api/arranque/migrador.ts`)

Reemplaza a `prisma migrate deploy` en producción sin abandonar Prisma Migrate en desarrollo (en local se sigue usando `npx prisma migrate dev`; los archivos que genera son los que el migrador aplica).

- Lee las carpetas de `dist/migrations/` ordenadas por nombre (Prisma las nombra con marca de tiempo).
- Usa la **misma tabla `_prisma_migrations`** que Prisma, con las mismas columnas (`id`, `checksum` SHA-256 del `migration.sql`, `migration_name`, `finished_at`, `applied_steps_count`, `started_at`, `logs`, `rolled_back_at`). Así una base migrada por Prisma en dev y una migrada por el migrador en producción son indistinguibles, y `prisma migrate status` sigue funcionando en local contra un dump de producción.
- Para cada migración no registrada: abre una transacción, ejecuta cada sentencia del `.sql` con `$executeRawUnsafe` (separando por `;` al final de línea, respetando comentarios `--` y bloques), inserta la fila en `_prisma_migrations`, confirma. MySQL/MariaDB confirman DDL implícitamente: si una migración de varias sentencias falla a la mitad, el migrador registra la fila con `finished_at = NULL` y `logs` con el error, y el arranque **se detiene** (§5.1 paso 3). Reparar es una acción humana: por eso ninguna migración destructiva sin respaldo (01 §11), y por eso el respaldo de §5.6 se dispara automáticamente **antes** de aplicar migraciones pendientes.
- Candado: `SELECT ... FOR UPDATE` sobre una fila de `Correlativo` con clave `migrador` (o `GET_LOCK('onplay_migrador', 60)`) para que dos instancias arrancando a la vez no migren en paralelo.
- Checksum distinto para una migración ya aplicada → error y arranque detenido (alguien editó una migración aplicada).
- **Test obligatorio** (vitest, base MariaDB local): base vacía → aplica todas y el resultado es idéntico al de `prisma migrate deploy` (comparar `SHOW CREATE TABLE` de cada tabla); segunda corrida → 0 aplicadas; migración con error → fila con `finished_at NULL` y excepción.

### 5.4 Semillas y admin inicial

- `prisma/seed.ts` pasa a exportar `sembrar(prisma)`; sigue siendo idempotente (upserts). En dev se puede seguir llamando desde `prisma db seed`.
- Admin inicial: si `SELECT COUNT(*) FROM Usuario WHERE activo = true` es 0 y existen `ADMIN_INICIAL_EMAIL` y `ADMIN_INICIAL_PASSWORD`, se crea el admin con argon2 y se escribe en `Auditoria` (`accion='crear'`, entidad `usuario`, usuario = él mismo) y en el log. Si no existen las variables y no hay usuarios, la app arranca y `/salud` responde `{ estado: 'sin_usuarios' }` para que el problema sea visible. La contraseña del entorno se considera **de un solo uso**: la pantalla de entrada obliga a cambiarla en el primer inicio de sesión (nueva regla mínima, campo `Usuario.debeCambiarClave` — **única** adición al esquema de esta versión, migración `e20_admin_inicial`).

### 5.5 Tareas administrativas como endpoints (`src/api/rutas/admin.ts`, rol admin)

| Antes (comando) | Ahora | Notas |
|---|---|---|
| `npm run renumerar-ind -- [--aplicar]` | `POST /api/v1/admin/renumerar-ind?dryRun=true` | Misma lógica del script; responde el plan; auditado igual que hoy |
| `npm run seed` | Automático al arrancar; además `POST /api/v1/admin/sembrar` | Para re-sembrar tras agregar una semilla nueva sin reiniciar |
| `npm run crear-admin` | `POST /api/v1/admin/usuarios` (crear con rol) | Cierra el hueco H1 de E1 (`/admin/usuarios` no existía) solo en lo mínimo: crear y desactivar. Sin pantalla nueva: se usa desde la pantalla Auditoría/Sync con un formulario de 3 campos. Agendar el resto |
| `prisma migrate status` | `GET /api/v1/admin/migraciones` | Lista aplicadas y pendientes con checksums; visible en la pantalla Sync |
| `mysqldump` | `POST /api/v1/admin/respaldo` y `GET /api/v1/admin/respaldos/:id` | §5.6 |

### 5.6 Respaldo lógico desde la app

Sin `mysqldump` ni cron del sistema, el respaldo lo hace el proceso:

- `POST /api/v1/admin/respaldo` (admin) genera un archivo **SQL** (no JSON: debe poder restaurarse con phpMyAdmin o `mysql` sin herramienta propia) con `INSERT` por tabla en lotes de 500 filas, leyendo con cursor por clave primaria (P13), en el orden de dependencias del esquema, más un encabezado con versión de app, migración vigente y fecha. Se comprime con gzip y se guarda **fuera del árbol de la app** si el panel ofrece almacenamiento persistente, o en `dist/respaldos/` con retención de 7 archivos si no (§14 #5 decide). El backoffice lo descarga con `descargar()` (ya existe para el CSV de stock).
- Automático: cron interno diario a las 03:00 (hora Chile) y **siempre antes de migrar** (§5.3).
- **Segunda copia obligatoria fuera de Hostinger:** el dueño descarga el respaldo semanal desde el backoffice (o activa los respaldos del panel: diarios en Business, y los verifica una vez restaurando). La spec `01` §11 exige respaldo fuera del servidor; en este entorno esa parte es manual y hay que decirlo así en la guía.
- **Verificación:** restaurar un respaldo en la base de staging (§10) y comparar conteos por tabla con producción. Criterio de aceptación #8.

### 5.7 Crons y vigilancia

- Los crons (`node-cron`: incremental cada 30 min, completa E3 cada 15 min, respaldo diario) siguen dentro del proceso. Cada corrida ya toma cerrojo en base (`abrirCorrida`) y `abortarCorridasColgadas()` limpia lo que un reinicio dejó a medias: no hace falta nada nuevo, salvo **guardar `ultimaCorridaCronEn` en `Canal`** para detectar un proceso que lleva horas sin correr sus crons.
- `/salud` se amplía: `{ estado, version, base: ok|error, migraciones: alDia|pendientes, ultimoCronEn, usuarios: n }`. Sin credenciales, respuesta en < 200 ms, no consulta las tiendas Woo (eso lo hace `GET /sync/estado`, que ya existe, con sesión).
- **Vigilancia externa** (única pieza fuera del proceso, y es gratuita): un monitor HTTP (UptimeRobot, Better Stack o el propio de Hostinger si lo tiene) pide `/salud` cada 5 minutos y avisa por correo al dueño si falla o si `ultimoCronEn` tiene más de 60 min. Esto sustituye a la «alerta por correo si falla 3 veces» de `01` §11 sin escribir un servicio de correo (P6).

### 5.8 Proxy, HTTPS y cookies

- Fastify con `trustProxy: true`: la plataforma termina HTTPS y reenvía por HTTP interno. Sin esto la cookie `secure` del refresh token (H7) nunca llega y nadie puede entrar (mismo síntoma que en el VPS sin `X-Forwarded-Proto`).
- Sin Nginx propio. Compresión: sigue `@fastify/compress`.
- CORS: vacío (same-origin). El dominio es el que el panel asigne a la Web App (subdominio de onplay.cl o de onplaygames.cl; §14 #4).
- Timeouts: la plataforma puede cortar respuestas largas. Toda operación que en la 1.x tardaba más de ~60 s en responder (importación completa de onplay.cl: 40–60 s; verificación de stock; respaldo) pasa a **responder en el acto con un `corridaId`** y correr en segundo plano dentro del proceso; el backoffice consulta `GET /sync/corridas/:id` (existe) hasta que termina. La importación de E1 se adapta a ese patrón registrando su corrida en `SyncCorrida` (hoy solo escribe `SyncLog`).

### 5.9 Logs

A `stdout` en JSON (pino, ya está), nivel `info`. Sin archivos con rotación (no hay disco garantizado): el panel muestra la salida. Si el panel no conserva logs (§14 #3), se agrega una tabla `LogApp` acotada (últimas 5.000 líneas de `warn`/`error`, purga en el cron diario) visible en el backoffice. Decisión diferida a la Fase 1.

## 6. Base de datos

- MySQL/MariaDB del panel de Hostinger (la misma familia que usan las tiendas). Prisma `provider = "mysql"` cubre ambos. `DATABASE_URL` con el host que entregue el panel (no siempre `localhost`; OnplayPOS lo tiene resuelto: copiar su forma).
- `connection_limit=5` en la URL: el plan compartido limita conexiones simultáneas por usuario de MySQL; 5 alcanza para un mostrador y los crons. `pool_timeout=20`.
- Los `SELECT ... FOR UPDATE`, `GET_LOCK`, fulltext y `UTC_TIMESTAMP(3)` que usa la 1.x funcionan en MariaDB 10.4+ y MySQL 8. Verificar la versión real en la Fase 0 (§14 #2).
- Zona horaria: `TZ=UTC` se fija en el proceso (`process.env.TZ = 'UTC'` como primera línea de `index.ts`, porque en la Web App no se controla el entorno del sistema).

## 7. Migración desde la 1.x

No hay datos de producción de la 1.x (nunca se desplegó). El camino es:

1. Base nueva y vacía en el panel → primer arranque migra y siembra.
2. Importar ambos canales desde el backoffice (simular, luego importar) y `renumerar-ind` desde su endpoint.
3. El entorno de desarrollo local sigue igual (MariaDB de XAMPP, `prisma migrate dev`). Un dump de dev **no** se sube a producción: tiene datos de prueba.

Si en algún momento hubiera que mover datos entre 1.x y 2.0 (o entre VPS y Web App), el formato es el respaldo SQL de §5.6, que ambas versiones saben restaurar con `mysql`/phpMyAdmin.

## 8. Plan de implementación

Cada fase termina con la app **arrancando y pasando tests**; ninguna deja el repo en un estado intermedio.

### Fase 0 — Verificación del entorno (del dueño + una sesión corta)

Responder §14. Además, **una prueba mínima en Hostinger antes de mover nada**: una Web App «hola» con Fastify + Prisma (`postinstall: prisma generate`, una tabla, un `SELECT 1`, `trustProxy`, cookie `secure`) desplegada desde un repo de prueba. Verificar: arranca, responde por HTTPS, la cookie llega, el cliente Prisma consulta, y **qué pasa al ejecutar `$executeRawUnsafe('CREATE TABLE …')` en runtime** (es lo que hace el migrador; OnplayPOS solo probó el build). Si el DDL en runtime falla, la 2.0 no es viable como está y se detiene aquí: se reporta, no se improvisa.

### Fase 1 — Reestructura (rama `2.0`)

Mover carpetas según §4, un `package.json`, alias de TypeScript, `vite.config.ts` en la raíz, esbuild. **Verificable:** `npm test` con los mismos tests verdes; `npm run build` produce `dist/servidor.mjs` y `dist/web`; `node dist/servidor.mjs` en local levanta la app contra la MariaDB de XAMPP y el mostrador vende (turno, venta, cierre) igual que en la 1.x.

### Fase 2 — Arranque autosuficiente

Migrador (§5.3, con su test), semillas y admin inicial (§5.4), `/salud` ampliado, `trustProxy`, `TZ`. **Verificable:** base vacía + variables → un solo `node dist/servidor.mjs` deja la app operativa con el admin; segundo arranque no repite nada; migración con error deja el proceso caído con log claro; el test de equivalencia migrador vs Prisma pasa.

### Fase 3 — Operación sin shell

Endpoints de §5.5, respaldo de §5.6 (con restauración probada), corridas largas en segundo plano (§5.8), `ultimaCorridaCronEn`. **Verificable:** criterios 5–9 de §12.

### Fase 4 — Despliegue real y staging

Web App de staging (§10) desde la rama `2.0`; luego producción. Guía `docs/11-guia-despliegue-web-app.md` con capturas de cada campo del panel. Monitor externo configurado. **Verificable:** criterios 10–13.

### Fase 5 — Cierre

`CLAUDE.md`, `README.md` y `01` §5/§11 actualizados (la fila «Despliegue» pasa a «Web App Node.js de Hostinger; VPS documentado como alternativa»). La rama `2.0` reemplaza a `main`. `docs/despliegue/` se conserva con una nota de cabecera.

## 9. Variables de entorno (panel de Hostinger)

Las de `02` §11, `03`, `06` §11 y `07` se mantienen. Cambian o se agregan:

```env
PORT=                        # la asigna Hostinger; la app falla al arrancar si falta
NODE_ENV=production
DATABASE_URL="mysql://usuario:clave@HOST:3306/base?connection_limit=5&pool_timeout=20"
ADMIN_INICIAL_EMAIL=         # solo se usa si no hay usuarios activos (§5.4)
ADMIN_INICIAL_PASSWORD=      # de un solo uso; se obliga a cambiarla
RESPALDO_CRON="0 3 * * *"    # hora Chile; vacío desactiva el automático
RESPALDO_RETENCION=7         # archivos que se conservan en el disco de la app
CORS_ORIGINS=                # vacío (same-origin)
```

Reglas: nada en `VITE_*` (S3); las claves `ck_/cs_` solo en el panel; `SYNC_SOLO_LECTURA=true` hasta la Fase 0 de E3.

## 10. Staging

Segunda Web App (`pos-staging.<dominio>`) desplegada desde la rama `2.0` (producción desde `main`), con **su propia base** en el panel. Es el «entorno de staging obligatorio desde E3» de `01` §11 y el lugar donde se restauran los respaldos para verificarlos. Si el plan solo incluye una Web App (§14 #6), staging se hace en el plan de la otra tienda o se contrata el escalón siguiente: no se salta.

## 11. Reglas de seguridad que cambian de forma, no de fondo

- **S3** se cumple igual: secretos solo en el panel. Cuidado con los logs de build del panel: no imprimir `process.env` nunca.
- Los endpoints administrativos de §5.5 exigen rol admin **y** se auditan; los de respaldo devuelven archivos que contienen todos los datos del negocio: solo admin, sin enlaces públicos, y el archivo se borra del disco de la app al superar la retención.
- `trustProxy: true` solo es seguro porque la app **no** es alcanzable sin pasar por el proxy de Hostinger; si algún día se expone el puerto directo, hay que acotarlo a la IP del proxy.

## 12. Criterios de aceptación

1. `npm test` verde con los mismos tests de la 1.x (92 de dominio + woo-client + API) y los nuevos del migrador.
2. `npm run build` en limpio (< 3 min) deja `dist/servidor.mjs` y `dist/web`; `node dist/servidor.mjs` arranca en < 10 s con la base al día.
3. Base vacía + variables → arranque migra, siembra y crea el admin; `/salud` responde `alDia`; segundo arranque no aplica nada.
4. Esquema resultante del migrador idéntico al de `prisma migrate deploy` (comparación de `SHOW CREATE TABLE`).
5. `renumerar-ind` y `sembrar` funcionan como endpoints, auditados, con `dryRun` por defecto donde aplica.
6. Respaldo generado desde el backoffice se restaura con phpMyAdmin en la base de staging y los conteos por tabla coinciden.
7. Una importación completa de onplay.cl responde en < 2 s con `corridaId` y termina en segundo plano; el reinicio del proceso a la mitad deja la corrida `abortada` y la siguiente corre limpia.
8. El respaldo automático se dispara antes de una migración pendiente.
9. Con el proceso reiniciado desde el panel, el cron incremental vuelve a correr en el siguiente cuarto de hora y `ultimoCronEn` avanza.
10. Desplegado en Hostinger: HTTPS, entrar y refrescar sesión funciona (la cookie llega), el mostrador vende con turno abierto, la PWA se instala desde el navegador.
11. El monitor externo avisa cuando la app se apaga desde el panel y deja de avisar al reiniciarla.
12. Staging y producción son dos Web Apps con bases distintas; un push a `2.0` despliega staging y no toca producción.
13. Siete días corridos en producción sin reinicio inexplicado (o con reinicios que el arranque absorbió sin intervención): es el criterio 11 de E1, que sigue vigente.

## 13. Riesgos

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R2.1 | El DDL en runtime también está bloqueado (no solo en build) | Bloqueante | Fase 0 lo prueba antes de mover nada. Si falla: migrador «asistido» que muestra el SQL pendiente para aplicarlo en phpMyAdmin y luego registra la fila; peor, pero explícito |
| R2.2 | La plataforma duerme o reinicia el proceso con frecuencia | Crons que no corren; ingesta de pedidos atrasada | Arranque idempotente, `ultimoCronEn` + monitor externo; si es crónico, volver al VPS (`docs/despliegue/`) es un cambio de `DATABASE_URL` y un respaldo |
| R2.3 | Recursos compartidos con las tiendas: una importación lenta afecta a Woo | Tiendas lentas en horario de venta | Lotes de 50 con pausa de 200 ms entre lotes (P13); importación completa solo manual y fuera de horario; incremental cada 30 min es liviano |
| R2.4 | Timeouts del proxy en respuestas largas | Importaciones «fallidas» que en realidad terminaron | §5.8: toda tarea larga responde en el acto y corre en segundo plano |
| R2.5 | Sin disco persistente: respaldos locales se pierden al redesplegar | Sin respaldo | Descarga semanal manual obligatoria + respaldos del panel; verificar en Fase 0 si el disco persiste |
| R2.6 | Devdependencies no instaladas en el build del panel | Build falla | Fase 0 lo verifica; alternativa: mover `vite`, `esbuild`, `typescript` a `dependencies` (costo: `node_modules` más grande) |
| R2.7 | Deriva entre el esquema y el código por parches en phpMyAdmin (lo que pasó en OnplayPOS) | Errores silenciosos | P12: prohibido tocar el esquema fuera de las migraciones; `GET /admin/migraciones` y el checksum lo delatan |

## 14. Lo que falta decidir (del dueño) antes de la Fase 1

1. **Campos exactos del formulario «Deploy Web App»** tal como los ves para OnplayPOS: ¿hay «root directory»? ¿qué pide en «install command», «build command», «start file»/«entry file», «output directory»? ¿versión de Node elegida? Una captura de pantalla de esa configuración basta.
2. **Datos del entorno de OnplayPOS en producción:** `DATABASE_URL` sin la clave (para ver host y forma), versión de MySQL/MariaDB (phpMyAdmin la muestra arriba), y si el build del panel instala devDependencies (en OnplayPOS `vite` está en devDependencies del client: ¿el build corre allí o subes `server/public` ya compilado?).
3. **Logs:** ¿el panel muestra la salida del proceso (stdout) y cuánto conserva? ¿Has visto reinicios o caídas de OnplayPOS sin que tú lo reiniciaras? ¿Con qué frecuencia?
4. **Dominio** para producción y para staging (`pos.onplay.cl` y `pos-staging.onplay.cl`, o bajo onplaygames.cl como OnplayPOS).
5. **Disco:** ¿los archivos que la app escribe (OnplayPOS tiene `uploads/`) sobreviven a un redespliegue? Define dónde viven los respaldos (§5.6, R2.5).
6. **Plan:** ¿cuántas Web Apps incluye? (staging necesita una segunda).
7. **Alcance:** confirmar que la 2.0 es **solo** cambio de empaquetado y operación (§2), sin funcionalidad nueva. Si quieres sumar algo de OnplayPOS (eventos, dashboard, carga masiva), va como etapa aparte con su spec, no aquí.
8. **Repositorio:** rama `2.0` en este mismo repo (recomendado: conserva historia, tests y docs) o repo nuevo `onplay-core-2.0`.
9. **Despliegue automático:** ¿conectar GitHub para que cada push a `main` despliegue producción, o subir el zip a mano cada vez? Recomendación: GitHub para staging (rama `2.0`) y también para producción (rama `main`) con la regla de que a `main` solo llega lo que ya corrió en staging.

## 15. Referencia: qué se toma de OnplayPOS v2 y qué no

**Se toma:** la evidencia de que Fastify/Express + Prisma 5.22 + `postinstall: prisma generate` corren en la Web App; la forma de `DATABASE_URL` y del subdominio; la lección del `EACCES` (commit `8381e13`); la lección de que las URLs de las tiendas van en variables de entorno y los clientes HTTP llevan timeout (commit `0edb43f`).

**No se toma:** su modelo de datos, su autenticación (Firebase), sus webhooks de wallet, ni el hábito de aplicar cambios de esquema por phpMyAdmin. onplay-core sigue siendo la fuente de verdad descrita en `01`; OnplayPOS sigue siendo un sistema paralelo del que se aprende (ver `01` §5.2 para el criterio: lo que es correcto en una herramienta de un usuario es un defecto en un sistema de negocio).

## 16. Fase 0 — hecha el 2026-09-09 (R-019): lo verificado y lo que corrige a esta spec

Prueba «hola» (`docs/despliegue/prueba-webapp/`) desplegada en `core.onplaygames.cl` con el conector de Hostinger; detalle y cronología en `08` R-019. **Veredicto: la 2.0 es viable como está diseñada; el DDL en runtime funciona.** Ocho hechos del entorno obligan a corregir el texto de las secciones anteriores; hasta que se integren, **esta sección manda**.

| Hecho verificado | Corrige |
|---|---|
| `$executeRawUnsafe` con `CREATE TABLE`, `ALTER TABLE`, `FULLTEXT`, `_prisma_migrations`, `FOR UPDATE`, `GET_LOCK`, `UTC_TIMESTAMP(3)`: todo ok | R2.1 cerrado; §5.3 se mantiene |
| **`PORT` no existe.** LiteSpeed Node (`lsnode`) redirige `listen()` al socket `LSNODE_SOCKET` | §5.1 paso 1 y §9: `PORT` opcional con default 3000; nunca es motivo de salida |
| **`NODE_ENV` no se pone en el panel:** npm lo lee en el `install` y omite las devDependencies (build fallido «Cannot find package 'esbuild'»). Sin la variable el build instala todo y el runtime igual recibe `NODE_ENV=production` de la plataforma | §5.2 y §9: quitar `NODE_ENV` de las variables; R2.6 cerrado, `esbuild`/`vite`/`typescript`/`prisma` siguen en devDependencies |
| **La base solo responde por `localhost`**; el host `srv1489.hstgr.io` del panel rechaza al usuario desde la Web App. MariaDB **11.8.8**, `max_user_connections` 100, `sql_mode NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION`, `time_zone SYSTEM` (UTC) | §6: `DATABASE_URL` con `localhost`; `connection_limit=5` sobra |
| Ajustes del panel que funcionan: Node 22, Fastify, raíz `.`, **salida `.`** (con `dist` el proceso no arranca), script `build`, inicio `dist/servidor.mjs`, npm. `postinstall: prisma generate` corre sin `EACCES`. Cada build va a `hbuilds/versions/<uuid>/nodejs`, `hbuilds/current` apunta a la vigente | §5.2 (fila «En Hostinger»): output = `.` |
| El entorno declara `LSAPI_PGRP_MAX_IDLE=300`, pero el proceso **sobrevivió 333 s sin peticiones con el mismo PID**; tras `process.exit(1)` la plataforma **lo relanzó sola en < 5 s** | **§5.7 se refuerza, no cambia:** `node-cron` sigue en el proceso; se agrega un **cron de cuenta de Hostinger** que pide `/salud` cada 5 min (mantiene despierto si hiciera falta, vigila, deja rastro) en vez de un monitor externo. Si en producción los crons no corren de noche, se pasan a endpoints `POST /api/v1/cron/{incremental,completa,respaldo}` con `CRON_TOKEN` disparados por ese cron. R2.2 pasa de riesgo a vigilado |
| El borde (`hcdn`) devolvió **307 a los ~55 s** en una respuesta de 70 s (`LSAPI_MAX_PROCESS_TIME=180` no es el límite efectivo) | §5.8 confirmado (R2.4): toda tarea > 30 s responde con `corridaId` y sigue en segundo plano; el umbral de §5.8 baja de «~60 s» a 30 s |
| Lo escrito junto al bundle cambia con cada despliegue; **`$HOME` = `/home/<usuario>/domains/core.onplaygames.cl` persiste** (`$HOME/onplay-datos/` probado) | §5.6 y §14 #5: los respaldos van a `$HOME/onplay-respaldos/` con retención 7; R2.5 cerrado |
| `trustProxy` recibe `x-forwarded-proto: https`, `x-forwarded-for`, `x-real-ip`; la cookie `Secure; HttpOnly; SameSite=Strict` llega y vuelve | §5.8 confirmado; H7 se cumple |
| `console.*` y pino JSON se ven en el panel y por API (fecha, nivel, mensaje; ventana de 1 mes) | §5.9: `stdout`; sin `LogApp` |
| En el arranque se vieron **dos instancias** del proceso (dos sockets) | El candado del migrador (§5.3) y `abrirCorrida` son obligatorios, no defensivos |
| **El cgroup LVE del usuario admite ~40 hilos en total** (R-023): el motor de Prisma abre uno por CPU (64) y el segundo sitio cae con «PANIC: timer has gone away» | §9:  en cada sitio; la app lo fija por defecto en  |
| **Hay cron de cuenta** en el plan (comando + horario) | Habilita la opción B de §5.7 y la vigilancia sin servicio externo (P6) |

**Estado de §14 tras la prueba:** #1 respondido (campos: framework, Node, raíz, salida, build, inicio, gestor; zip por TUS o Git); #2 no aplica (OnplayPOS no está desplegado; los datos reales son los de arriba); #3 respondido (logs por API, 1 mes; reinicios: la plataforma relanza el proceso si muere; no se apagó en 5,5 min de inactividad); #5 respondido (`$HOME`). **Quedan del dueño:** #4 dominio (todo indica `core.onplaygames.cl`), #6 cuántas Web Apps incluye Cloud Startup (staging necesita otra), #7 alcance, #8 rama, #9 GitHub vs zip.

**Plan Cloud Startup, cuenta `u382410428`.** Base de prueba `u382410428_coreprueba` (se puede borrar o reutilizar para staging). Las tablas de prueba se eliminaron al terminar.
