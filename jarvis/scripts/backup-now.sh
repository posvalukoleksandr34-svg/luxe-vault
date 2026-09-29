#!/usr/bin/env bash
# Take a backup immediately (database dump + restic snapshot of the data volume).
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose run --rm backup now
docker compose run --rm backup snapshots
