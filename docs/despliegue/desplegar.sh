#!/usr/bin/env bash
# Actualización de onplay-core en producción (README raíz §Despliegue):
#   git pull → npm ci → build (typecheck + web) → prisma migrate deploy → pm2 reload → GET /salud
# Se detiene ante el primer error: si el build o las migraciones fallan, el proceso que está
# corriendo NO se reinicia y sigue sirviendo la versión anterior.
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
APP_NAME="${APP_NAME:-onplay-core}"
PORT="${PORT:-3010}"
RAMA="${RAMA:-main}"

cd "${REPO_DIR}"
echo "==> ${REPO_DIR} (rama ${RAMA})"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Hay cambios locales sin commitear en el servidor; el despliegue exige árbol limpio." >&2
  git status --short >&2
  exit 1
fi

ANTES="$(git rev-parse --short HEAD)"
git fetch origin "${RAMA}"
git checkout -q "${RAMA}"
git pull --ff-only origin "${RAMA}"
DESPUES="$(git rev-parse --short HEAD)"
echo "==> ${ANTES} → ${DESPUES}"
[[ "${ANTES}" != "${DESPUES}" ]] && git log --oneline "${ANTES}..${DESPUES}" | sed 's/^/    /'

echo "==> npm ci"
npm ci --no-audit --no-fund

echo "==> build (typecheck de la API + apps/web/dist)"
npm run build

echo "==> migraciones"
(cd apps/api && npx prisma migrate deploy)

echo "==> pm2"
if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 reload "${APP_NAME}" --update-env
else
  (cd apps/api && pm2 start npm --name "${APP_NAME}" -- run start)
  pm2 save
fi

echo "==> salud"
for i in $(seq 1 15); do
  if RESP="$(curl -fsS "http://127.0.0.1:${PORT}/salud" 2>/dev/null)"; then
    echo "    ${RESP}"
    echo "Desplegado ${DESPUES}."
    exit 0
  fi
  sleep 2
done

echo "La API no respondió en /salud tras 30 s. Revisar: pm2 logs ${APP_NAME} --lines 100" >&2
exit 1
