#!/usr/bin/env bash
# Local development: API + embedded worker on :8000 with auto-reload, against `make test-infra`
# (Postgres on :55432, Redis on :56379). The frontend dev server (`make dev-frontend`) proxies /api here.
set -euo pipefail
cd "$(dirname "$0")/../backend"
export JARVIS_ENV=development JARVIS_EMBEDDED_WORKER=true JARVIS_LOG_JSON=false
export JARVIS_DATABASE_URL=${JARVIS_DATABASE_URL:-postgresql+asyncpg://jarvis:jarvis@localhost:55432/jarvis}
export JARVIS_REDIS_URL=${JARVIS_REDIS_URL:-redis://localhost:56379/0}
export JARVIS_DATA_DIR=../.devdata JARVIS_CONFIG_DIR=../config JARVIS_SKILLS_DIR=../skills
export JARVIS_PUBLIC_URL=${JARVIS_PUBLIC_URL:-http://localhost:5173}
.venv/bin/jarvis migrate
exec .venv/bin/uvicorn jarvis.api.app:create_app --factory --reload --port 8000
