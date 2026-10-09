#!/bin/sh
set -eu
case "${1:-cron}" in
  cron)
    if [ -z "${RESTIC_PASSWORD:-}" ]; then
      echo "[backup] RESTIC_PASSWORD is not set — backups are DISABLED. Run scripts/setup.sh." >&2
      exec sleep infinity
    fi
    echo "${BACKUP_CRON:-30 3 * * *} /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
    echo "[backup] schedule: ${BACKUP_CRON:-30 3 * * *} → ${RESTIC_REPOSITORY}"
    exec crond -f -l 8
    ;;
  now) exec /usr/local/bin/backup.sh ;;
  restore) shift; exec /usr/local/bin/restore.sh "$@" ;;
  snapshots) exec restic snapshots ;;
  *) exec "$@" ;;
esac
