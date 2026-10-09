#!/bin/sh
# Consistent, encrypted, versioned backup:
#   1. pg_dump -Fc of the whole database (conversations, memory + vectors, tasks, audit log…)
#   2. restic snapshot of the dump + /data (workspace files, generated master key, config snapshot)
#   3. retention: 7 daily, 4 weekly, 12 monthly; weekly integrity check
set -eu
STAGING=/backups/staging
mkdir -p "$STAGING"
if ! restic cat config >/dev/null 2>&1; then
  echo "[backup] initialising restic repository $RESTIC_REPOSITORY"
  restic init
fi
ts=$(date -u +%Y%m%dT%H%M%SZ)
echo "[backup] $ts dumping database"
pg_dump --format=custom --compress=6 --file="$STAGING/jarvis.dump"
pg_restore --list "$STAGING/jarvis.dump" > /dev/null   # dump is readable
echo "[backup] snapshot"
restic backup "$STAGING" /data --tag jarvis --host jarvis \
  --exclude /data/models --exclude /data/files/.trash
restic forget --tag jarvis --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune
if [ "$(date -u +%u)" = "7" ]; then restic check --read-data-subset=5%; fi
if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then wget -q -O /dev/null "$BACKUP_HEALTHCHECK_URL" || true; fi
echo "[backup] done $ts"
