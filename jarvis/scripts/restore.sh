#!/usr/bin/env bash
# Disaster recovery on a fresh server:
#   1. git clone … && cd jarvis
#   2. put your old .env back (it holds JARVIS_MASTER_KEYS and RESTIC_PASSWORD)
#   3. make the backup repository reachable (copy ./backups or set RESTIC_REPOSITORY to the remote)
#   4. ./scripts/restore.sh [snapshot-id]      (default: latest)
set -euo pipefail
cd "$(dirname "$0")/.."
SNAP="${1:-latest}"
echo "Stopping app containers…"
docker compose stop api worker caddy 2>/dev/null || true
docker compose up -d postgres redis
echo "Restoring snapshot $SNAP (database + data volume)…"
docker compose --profile restore run --rm restore restore "$SNAP"
docker compose up -d
echo "Done. Check: docker compose exec api jarvis doctor && docker compose exec api jarvis verify-audit"
