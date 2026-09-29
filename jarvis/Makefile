# Convenience targets. Everything also works with plain `docker compose`.
SHELL := /bin/bash
TEST_DB ?= postgresql+asyncpg://jarvis:jarvis@localhost:55432/jarvis_test
TEST_REDIS ?= redis://localhost:56379/15

.PHONY: setup up down logs ps doctor backup restore update dev-backend dev-frontend test test-infra test-backend test-frontend lint

setup:            ## generate .env with secrets
	./scripts/setup.sh

up:               ## build and start everything
	@[ -f infrastructure/monitoring/metrics_token ] || touch infrastructure/monitoring/metrics_token
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=100 api worker

ps:
	docker compose ps

doctor:
	docker compose exec api jarvis doctor

backup:
	./scripts/backup-now.sh

restore:
	./scripts/restore.sh $(SNAPSHOT)

update:
	./scripts/update.sh

test-infra:       ## Postgres (pgvector) + Redis for integration tests
	docker run -d --rm --name jarvis-test-pg -e POSTGRES_USER=jarvis -e POSTGRES_PASSWORD=jarvis -e POSTGRES_DB=jarvis -p 55432:5432 pgvector/pgvector:pg16 || true
	docker run -d --rm --name jarvis-test-redis -p 56379:6379 redis:7-alpine || true

backend/.venv:
	cd backend && uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python -e ".[dev,local-embeddings]"

test-backend: backend/.venv
	JARVIS_TEST_DATABASE_URL=$(TEST_DB) JARVIS_TEST_REDIS_URL=$(TEST_REDIS) backend/.venv/bin/python -m pytest -q

test-frontend:
	cd frontend && npm ci && npx tsc -b && npx vitest run

test: test-backend test-frontend

dev-backend: backend/.venv   ## API + embedded worker on :8000 against the test infra
	./scripts/dev-backend.sh

dev-frontend:     ## Vite dev server on :5173 (proxies /api to :8000)
	cd frontend && npm install && npm run dev
