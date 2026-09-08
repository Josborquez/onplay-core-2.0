# Despliegue en Hostinger (VPS)

Guía operativa para poner `onplay-core` en producción. Complementa el README de la raíz
(§Despliegue) y la spec `01-SDD-general.md` §11. Todos los archivos de esta carpeta se copian
al servidor tal cual; ninguno lleva secretos.

| Archivo | Para qué |
|---|---|
| `instalar-servidor.sh` | Primera vez: Node 22, Nginx, MySQL, pm2, usuario y base de datos. Se corre UNA vez como root. |
| `desplegar.sh` | Cada actualización: `git pull` → `npm ci` → build → migraciones → `pm2 reload` → comprobación de salud. |
| `nginx-pos.onplay.cl.conf` | Sitio de Nginx que pone HTTPS delante del proceso Node (`:3010`). |
| `respaldo-mysql.sh` | Dump diario de `onplay_core` comprimido, retención 30 días. |
| `cron-onplay-respaldo` | Entrada de `/etc/cron.d/` que ejecuta el respaldo a las 03:00. |

## Requisito: VPS, no hosting compartido

El sistema es un proceso Node permanente que escucha en un puerto (Principio P6). El hosting
compartido donde viven las tiendas Woo no lo permite (Riesgo R1 de la spec 01). Sirve cualquier
VPS de Hostinger con Ubuntu LTS limpio (22.04, 24.04 o 26.04), sin panel (ni CloudPanel ni
plantillas con Docker: Nginx y MySQL los instala el script); el plan más chico alcanza.

Al contratar: región lo más cercana a Chile (São Paulo), acceso por llave SSH en vez de clave,
y anotar la IP pública para el registro A del subdominio.

Antes de empezar: apuntar un subdominio (en la guía se usa `pos.onplay.cl`) a la IP del VPS con
un registro A, y abrir solo los puertos 22, 80 y 443 en el firewall del panel de Hostinger.
El 3010 queda interno.

## Primera instalación

```bash
# 1. Como root en el VPS
apt update && apt install -y git
git clone https://github.com/<usuario>/onplay-core.git /var/www/onplay-core   # o con llave de despliegue si el repo es privado
bash /var/www/onplay-core/docs/despliegue/instalar-servidor.sh                 # pide la clave de MySQL para el usuario onplay

# 2. Variables de entorno (ver README raíz §Variables): NODE_ENV=production, DATABASE_URL con el
#    usuario onplay, JWT_SECRET nuevo (openssl rand -hex 48), claves ck_/cs_ de las tiendas,
#    SYNC_HABILITADO=true, SYNC_SOLO_LECTURA=true (el candado sigue puesto), CORS_ORIGINS vacío.
cp /var/www/onplay-core/apps/api/.env.example /var/www/onplay-core/apps/api/.env
nano /var/www/onplay-core/apps/api/.env
chmod 600 /var/www/onplay-core/apps/api/.env

# 3. Dependencias, base, semillas, primer admin y arranque
cd /var/www/onplay-core
npm ci
npm run build
(cd apps/api && npx prisma migrate deploy)
npm run seed
npm run crear-admin -- admin@onplay.cl "Admin" '<password>'
(cd apps/api && pm2 start npm --name onplay-core -- run start)
pm2 save
pm2 startup            # imprime un comando sudo: ejecutarlo para que pm2 arranque con el servidor

# 4. Nginx + HTTPS (la cookie de sesión es `secure` en producción: sin HTTPS nadie puede entrar)
cp docs/despliegue/nginx-pos.onplay.cl.conf /etc/nginx/sites-available/pos.onplay.cl
ln -s /etc/nginx/sites-available/pos.onplay.cl /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d pos.onplay.cl      # deja el redirect a HTTPS y renueva solo

# 5. Respaldo diario
cp docs/despliegue/respaldo-mysql.sh /usr/local/bin/respaldo-onplay.sh && chmod 700 /usr/local/bin/respaldo-onplay.sh
cp docs/despliegue/cron-onplay-respaldo /etc/cron.d/onplay-respaldo
/usr/local/bin/respaldo-onplay.sh     # primera corrida a mano: debe dejar un .sql.gz en /var/respaldos
```

Si el repo es privado: `ssh-keygen -t ed25519 -C onplay-vps` en el servidor, pegar la llave
pública en GitHub → Settings del repo → Deploy keys (solo lectura) y clonar por `git@github.com:`.

## Primera carga de datos

Desde `https://pos.onplay.cl/admin/sync` (o por curl con el token del admin):

1. Importar onplay.cl y onplaygames.cl: primero «Simular», después «Importar».
2. Una sola vez: `npm run renumerar-ind -- --aplicar` desde la raíz, para que las cartas
   que entraron con SKU `IND-` pasen a `MTG-` (R-010).
3. Revisar la bitácora de Sync y resolver los errores abiertos hasta dejarlos en cero
   (criterio 2 de E1).
4. Crear el usuario vendedor y abrir el primer turno desde el mostrador.

La fecha de la primera venta real inicia el conteo de los 7 días de E1 en producción, que
es la puerta para encender E2 y luego E3 (spec 01 §9).

## Actualizar

```bash
bash /var/www/onplay-core/docs/despliegue/desplegar.sh
```

El script se detiene ante el primer error (no reinicia el proceso si el build o las migraciones
fallan) y termina comprobando `GET /salud`. Si hay que volver atrás: `git log` para ver el
commit anterior, `git checkout <commit>` y correr el script otra vez. Las migraciones de Prisma
no se revierten solas: por eso «ninguna migración destructiva sin respaldo previo verificado»
(spec 01 §11).

## Respaldo fuera del servidor

`respaldo-mysql.sh` deja los dumps en `/var/respaldos`. La spec pide además una copia semanal
fuera del servidor. La forma más simple es `rclone` hacia Google Drive:

```bash
apt install -y rclone && rclone config        # remoto «gdrive»
# semanal, domingo 04:00, en /etc/cron.d/onplay-respaldo-remoto:
0 4 * * 0 root rclone copy /var/respaldos gdrive:onplay-respaldos --max-age 8d
```

Un respaldo que nadie restauró no es un respaldo: al menos una vez, restaurar un dump en una
base `onplay_core_prueba` y comprobar que la API arranca contra ella.

## Diagnóstico rápido

| Síntoma | Dónde mirar |
|---|---|
| La página no carga | `pm2 status`, `pm2 logs onplay-core --lines 100`, `systemctl status nginx` |
| Entra pero al refrescar pide login | Falta HTTPS o Nginx no manda `X-Forwarded-Proto` (la cookie es `secure`) |
| `GET /salud` responde pero la web da 404 | `apps/web/dist` no existe: correr `npm run build` |
| El cron de sync no corre | `SYNC_HABILITADO` en el `.env` y el log de arranque en `pm2 logs` |
| Error `P1001` de Prisma | MySQL caído o `DATABASE_URL` mal: `systemctl status mysql` |
