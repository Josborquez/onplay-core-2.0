# onplay-core 2.0

Sistema POS/ERP de Comercializadora y Distribuidora BM: fuente de verdad única de productos, precios, inventario, clientes y ventas, por encima de las dos tiendas WooCommerce existentes (onplay.cl y onplaygames.cl), que no se reemplazan.

**2.0 = la misma 1.x (Etapas 1–4 completas) empaquetada para correr como Web App Node.js de Hostinger**, sin VPS, sin shell y sin pm2: un solo paquete, un solo archivo de servidor (`dist/servidor.mjs`), arranque autosuficiente (migra, siembra, crea el admin inicial y escucha), tareas administrativas como endpoints y respaldo desde la propia app. Spec: `docs/10-SDD-onplay-core-2.0-web-app.md` (con §16, lo verificado en el entorno real, y `docs/08` R-019/R-020).

- Documento rector: `docs/01-SDD-general.md`
- Specs por etapa: `02` (mostrador), `03` (inventario), `06` (sincronización), `07` (cliente y monedero), `05` (diseño de interfaz)
- Guía para agentes de código: `CLAUDE.md`

**Hacia WooCommerce el sistema es de solo lectura** mientras `SYNC_SOLO_LECTURA=true` (candado de E1; abrirlo es la Fase 0 de E3).

## Requisitos

- Node.js ≥ 22
- MySQL 8 o MariaDB ≥ 10.4 (en desarrollo, MariaDB de XAMPP; en Hostinger, MariaDB 11.8)
- npm (un solo paquete, sin workspaces)

## Instalación (desarrollo)

```bash
git clone <repo> onplay-core-2.0 && cd onplay-core-2.0
npm install                 # postinstall: prisma generate
cp .env.example .env        # DATABASE_URL local, JWT_SECRET, claves ck_/cs_ (opcionales)
npx prisma migrate dev      # crea la base y aplica migraciones (solo en desarrollo)
npm run dev                 # API en :3010 (tsx watch). Al arrancar migra, siembra y crea el admin inicial
npm run dev:web             # Vite en :5183 con proxy /api → :3010
```

El primer arranque con `ADMIN_INICIAL_EMAIL` y `ADMIN_INICIAL_PASSWORD` en el `.env` crea el admin; esa clave es de un solo uso y la pantalla de entrada obliga a cambiarla. Sin usuarios y sin esas variables, `/salud` responde `sin_usuarios`.

## Variables de entorno

Ver `.env.example` (todas comentadas). Reglas que importan en Hostinger (R-019):

- **No poner `NODE_ENV` en el panel:** npm lo lee durante el `install` y omite las devDependencies, y el build falla. El runtime ya recibe `production` de la plataforma.
- **`PORT` no existe** en la Web App: LiteSpeed Node escucha en un socket. La app usa 3010 por defecto y nunca falla por eso.
- **`DATABASE_URL` con host `localhost`**; el host `srvNNNN.hstgr.io` del panel rechaza al usuario desde la Web App.
- **Ningún secreto en `VITE_*`** (regla S3). La web usa rutas relativas `/api/v1`.

## Build y producción

```bash
npm run build     # tsc (API y web) + vite → dist/web + esbuild → dist/servidor.mjs + dist/migrations
npm start         # node dist/servidor.mjs
npm test          # vitest: dominio, woo-client, API y el migrador (contra la MariaDB local si hay DATABASE_URL)
```

### Web App de Hostinger (verificado en `core.onplaygames.cl`)

| Campo del panel | Valor |
|---|---|
| Framework | Fastify |
| Versión de Node | 22 |
| Directorio raíz | `.` |
| Directorio de salida | `.` (con `dist` el proceso no arranca) |
| Comando de build | `build` |
| Archivo de inicio | `dist/servidor.mjs` |
| Gestor de paquetes | npm |

Fuente: repositorio Git conectado en el panel (cada push a `main` despliega) o zip subido a `public_html`. Variables de entorno desde el panel (sección Web App). Al arrancar, el proceso:

1. lee el entorno (falta `DATABASE_URL` o `JWT_SECRET` → sale con código 1 y mensaje claro);
2. **migra** con el migrador propio (`src/api/arranque/migrador.ts`): aplica los `migration.sql` de Prisma con el cliente de consultas sobre la misma tabla `_prisma_migrations`, con candado `GET_LOCK` y **respaldo automático previo** si hay pendientes; si una migración falla, el proceso **no escucha**;
3. siembra (idempotente) y crea el admin inicial si no hay usuarios activos;
4. aborta corridas de sync colgadas, escucha y programa los crons (incremental, completa, respaldo diario 03:00 Chile).

`/salud` (público, < 200 ms, no consulta las tiendas): `{ estado: ok|sin_usuarios|migraciones|error, migraciones: alDia|pendientes|fallidas, usuarios, version, ultimoCronEn, ultimaCorridaEn }`. Un **cron de cuenta** de Hostinger que pida `/salud` cada 5 minutos mantiene el proceso despierto y vigila.

### Operación sin shell (`/admin/sync` → sección «Sistema», solo admin)

| Antes (comando) | Ahora |
|---|---|
| `prisma migrate status` | `GET /api/v1/admin/migraciones` |
| `npm run seed` | automático al arrancar; `POST /api/v1/admin/sembrar` |
| `npm run crear-admin` | admin inicial por entorno; `POST /api/v1/admin/usuarios` (crear, activar/desactivar) |
| `npm run renumerar-ind` | `POST /api/v1/admin/renumerar-ind?dryRun=true` |
| `mysqldump` | `POST /api/v1/admin/respaldo` → `.sql.gz` en `$HOME/onplay-respaldos` (retención 7); `GET /api/v1/admin/respaldos/:id` descarga |

**Segunda copia fuera de Hostinger:** descargar el respaldo semanal desde el backoffice. Restaurar: `mysql -u usuario -p base < archivo.sql` o importar en phpMyAdmin (el archivo trae `DROP/CREATE + INSERT` con `FOREIGN_KEY_CHECKS=0`).

Los scripts de desarrollo siguen existiendo: `npm run seed`, `npm run crear-admin -- <email> <nombre> [password]`, `npm run renumerar-ind -- [--aplicar]`.

### Staging

`core-staging.onplaygames.cl` es una segunda Web App del mismo plan con base propia (`u382410428_onplaystaging`), mismas variables con secretos distintos y `SYNC_HABILITADO=false`. Ahí se prueba cada versión antes de producción, se restauran respaldos para verificarlos (criterio 6) y se abre primero el candado de E3. Con el panel conectado a Git: rama `staging` → staging, rama `main` → producción; a `main` solo llega lo que ya corrió en staging.

La alternativa VPS (Nginx + pm2 + `prisma migrate deploy`) queda documentada en [`docs/despliegue/`](docs/despliegue/README.md) y sigue funcionando con `npm start`.

## Etapas de negocio

- **E1 Mostrador** (`docs/02`): catálogo desde las tiendas, venta y caja, PWA offline, backoffice.
- **E2 Inventario** (`docs/03`, guía `docs/09`): libro de stock append-only, recuentos, alertas, devoluciones, movimientos de caja. Regla R-014: el stock nunca queda negativo.
- **E3 Sincronización bidireccional** (`docs/06`): ingesta de pedidos, push de precio y de stock con verificación previa, discrepancias. Producción exige la Fase 0 del dueño (claves de escritura, candado, respaldo, staging).
- **E4 Cliente y monedero** (`docs/07`): clientes en el mostrador, saldo como `SUM()`, vinculación con las cuentas de las tiendas. Fase 5 (crédito y fusión) bloqueada hasta aprobación.

## Estructura

```
src/api        Fastify + Prisma: rutas /api/v1, sync, stock, arranque/ (migrador, semillas, admin inicial, respaldo)
src/dominio    Reglas de negocio puras + tests (alias @onplay/dominio)
src/woo        Cliente tipado wc/v3 con el candado de solo lectura (alias @onplay/woo-client)
src/web        PWA React (mostrador + backoffice, un solo bundle)
prisma/        Esquema y migraciones (el migrador las lee de dist/migrations en producción)
scripts/       Utilidades de desarrollo (crear-admin, renumerar-ind)
docs/          SDDs vinculantes, bitácora (08) y app de prueba de la Fase 0 (despliegue/prueba-webapp)
dist/          Salida del build (no versionada): servidor.mjs, web/, migrations/
```
