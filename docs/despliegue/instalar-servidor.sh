#!/usr/bin/env bash
# Primera instalación de onplay-core en un VPS Ubuntu LTS (22.04, 24.04 o 26.04) de Hostinger.
# Se corre UNA vez como root. Idempotente en lo razonable: repetirlo no rompe nada.
# No toca el .env ni arranca la aplicación: eso queda para los pasos 2 y 3 del README.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/var/www/onplay-core}"
DB_NAME="${DB_NAME:-onplay_core}"
DB_USER="${DB_USER:-onplay}"

if [[ $EUID -ne 0 ]]; then
  echo "Este script debe correr como root (sudo)." >&2
  exit 1
fi

echo "==> Paquetes base"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git nginx mysql-server ufw

echo "==> Node.js 22 (repositorio NodeSource)"
# Se agrega el repositorio a mano con el canal «nodistro», que no depende del nombre de la
# versión de Ubuntu: así sirve igual en 26.04 aunque el script setup_22.x aún no la reconozca.
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi
node -v && npm -v

echo "==> pm2"
command -v pm2 >/dev/null || npm install -g pm2

echo "==> MySQL: base ${DB_NAME} y usuario ${DB_USER}"
if [[ -z "${DB_PASS:-}" ]]; then
  read -r -s -p "Clave para el usuario MySQL '${DB_USER}': " DB_PASS; echo
fi
mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
echo "    DATABASE_URL=\"mysql://${DB_USER}:<clave>@localhost:3306/${DB_NAME}\""

echo "==> Firewall: solo 22, 80 y 443"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status | sed 's/^/    /'

echo "==> Carpeta de respaldos"
mkdir -p /var/respaldos && chmod 700 /var/respaldos

echo "==> Repositorio"
if [[ -d "${REPO_DIR}/.git" ]]; then
  echo "    ya existe ${REPO_DIR}"
else
  echo "    falta clonar el repo en ${REPO_DIR} (ver README de docs/despliegue)"
fi

cat <<FIN

Listo. Siguientes pasos (README de docs/despliegue):
  1. Crear ${REPO_DIR}/apps/api/.env (NODE_ENV=production, DATABASE_URL de arriba, JWT_SECRET nuevo, claves Woo).
  2. cd ${REPO_DIR} && npm ci && npm run build && (cd apps/api && npx prisma migrate deploy) && npm run seed
  3. npm run crear-admin -- admin@onplay.cl "Admin" '<password>'
  4. (cd apps/api && pm2 start npm --name onplay-core -- run start) && pm2 save && pm2 startup
  5. Nginx + certbot, respaldo (archivos de esta carpeta).
FIN
