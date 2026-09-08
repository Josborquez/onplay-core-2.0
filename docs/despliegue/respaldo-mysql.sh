#!/usr/bin/env bash
# Respaldo diario de la base onplay_core (spec 01 §11: dump diario retenido 30 días).
# Instalar en /usr/local/bin/respaldo-onplay.sh (chmod 700) y programar con cron-onplay-respaldo.
# Corre como root y usa el socket local de MySQL (auth_socket), sin clave en el archivo.
# La copia semanal FUERA del servidor va aparte (rclone, ver README de docs/despliegue).
set -euo pipefail

DB_NAME="${DB_NAME:-onplay_core}"
DESTINO="${DESTINO:-/var/respaldos}"
RETENCION_DIAS="${RETENCION_DIAS:-30}"

mkdir -p "${DESTINO}"
chmod 700 "${DESTINO}"

ARCHIVO="${DESTINO}/${DB_NAME}-$(date +%F-%H%M).sql.gz"
TMP="${ARCHIVO}.parcial"

# --single-transaction: dump consistente sin bloquear las tablas InnoDB (el mostrador sigue vendiendo).
# --routines/--triggers por si algún día existen; hoy el esquema no los usa.
mysqldump \
  --single-transaction --quick --routines --triggers \
  --set-gtid-purged=OFF \
  "${DB_NAME}" | gzip -9 > "${TMP}"

# Solo se renombra al final: un dump cortado a la mitad nunca queda con nombre de respaldo válido.
mv "${TMP}" "${ARCHIVO}"
chmod 600 "${ARCHIVO}"

# Comprobación mínima: el archivo descomprime y termina con la marca de mysqldump.
if ! gzip -t "${ARCHIVO}" || ! zcat "${ARCHIVO}" | tail -n 5 | grep -q "Dump completed"; then
  echo "Respaldo sospechoso: ${ARCHIVO} no termina con 'Dump completed'" >&2
  exit 1
fi

find "${DESTINO}" -name "${DB_NAME}-*.sql.gz" -type f -mtime "+${RETENCION_DIAS}" -delete

echo "$(date -Is) ok ${ARCHIVO} $(du -h "${ARCHIVO}" | cut -f1)"
