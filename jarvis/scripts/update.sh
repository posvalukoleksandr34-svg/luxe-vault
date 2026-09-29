#!/usr/bin/env bash
# Update to the latest version with a safety net:
#   1. backup (database + data volume) — abort if it fails
#   2. git pull, rebuild, restart (database migrations run when the api starts)
#   3. wait until the api reports ready; if it does not, roll the CODE back to the previous commit
#
#   ./scripts/update.sh                 update
#   ./scripts/update.sh --rollback SHA  go back to an earlier commit (e.g. the one printed by a previous update)
#
# Code rollback does not undo database migrations. If the previous version cannot start on the migrated
# schema, restore the backup taken in step 1: ./scripts/restore.sh latest
set -euo pipefail
cd "$(dirname "$0")/.."

wait_ready() {
  for _ in $(seq 1 60); do
    if docker compose exec -T api python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/ready', timeout=3).status == 200 else 1)" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

deploy() {
  docker compose build
  docker compose up -d
}

if [[ "${1:-}" == "--rollback" ]]; then
  target="${2:?usage: update.sh --rollback <commit>}"
  echo "Rolling back to $target…"
  git checkout -q "$target"
  deploy
  wait_ready && echo "OK: running $(git rev-parse --short HEAD)" || { echo "api is not ready — see: docker compose logs api"; exit 1; }
  exit 0
fi

prev="$(git rev-parse HEAD)"
./scripts/backup-now.sh || { echo "backup failed — aborting update"; exit 1; }
git pull --ff-only
new="$(git rev-parse HEAD)"
if [[ "$prev" == "$new" ]]; then
  echo "Already up to date ($(git rev-parse --short HEAD))."
  exit 0
fi
echo "Updating $(git rev-parse --short "$prev") → $(git rev-parse --short "$new")"
deploy
if wait_ready; then
  docker compose exec -T api jarvis doctor || true
  echo "OK. To undo: ./scripts/update.sh --rollback $prev"
else
  echo "The new version did not become ready — rolling the code back to $prev"
  docker compose logs --tail 50 api || true
  git checkout -q "$prev"
  deploy
  if wait_ready; then
    echo "Rolled back to $(git rev-parse --short "$prev"). Your branch is now detached; 'git checkout main' when a fix is out."
  else
    echo "Rollback did not start either (the database may already be migrated). Restore the backup: ./scripts/restore.sh latest"
    exit 1
  fi
fi
