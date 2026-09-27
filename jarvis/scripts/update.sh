#!/usr/bin/env bash
# Update to the latest version: backup first, then rebuild and restart (migrations run on api start).
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/backup-now.sh || { echo "backup failed — aborting update"; exit 1; }
git pull --ff-only
docker compose build
docker compose up -d
docker compose exec api jarvis doctor || true
