#!/bin/sh
# Restore a snapshot (default: latest) into the running database and data volume.
#   docker compose run --rm backup restore [snapshot-id]
# The data volume is read-only in the `backup` service; scripts/restore.sh uses the `restore` service (rw).
set -eu
SNAP=${1:-latest}
TARGET=/restore
rm -rf "$TARGET" && mkdir -p "$TARGET"
echo "[restore] restoring snapshot $SNAP"
restic restore "$SNAP" --target "$TARGET"
echo "[restore] database"
pg_restore --clean --if-exists --no-owner --dbname="$PGDATABASE" "$TARGET/backups/staging/jarvis.dump"
if [ -w /data ]; then
  echo "[restore] data volume"
  cp -a "$TARGET/data/." /data/
else
  echo "[restore] /data is read-only here — use scripts/restore.sh to restore files too"
fi
echo "[restore] done. Restart: docker compose restart api worker"
