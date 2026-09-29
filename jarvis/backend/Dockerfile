# syntax=docker/dockerfile:1.7
# One image, three roles: `api` (FastAPI), `worker` (tasks + scheduler), `jarvis` CLI.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app/backend

FROM base AS deps
COPY pyproject.toml ./
# install dependencies first (layer cache), then the package itself
RUN python - <<'PY' > /tmp/reqs.txt
import tomllib
p = tomllib.load(open("pyproject.toml", "rb"))["project"]
deps = p["dependencies"] + p["optional-dependencies"]["local-embeddings"] + p["optional-dependencies"]["browser"]
print("\n".join(deps))
PY
# Optional build secret `ca`: extra CA bundle for builds behind a TLS-intercepting proxy.
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export PIP_CERT=/run/secrets/ca; fi; \
    pip install -r /tmp/reqs.txt "setuptools>=75"

FROM deps AS runtime
COPY . .
# editable: the CLI finds alembic.ini/migrations next to the code
RUN pip install --no-deps --no-build-isolation -e . \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin jarvis \
    && mkdir -p /data /app/config /app/skills && chown -R jarvis:jarvis /data
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
USER jarvis
ENV JARVIS_DATA_DIR=/data JARVIS_CONFIG_DIR=/app/config JARVIS_SKILLS_DIR=/app/skills HF_HOME=/data/models
EXPOSE 8000
# PID 1 signal handling / zombie reaping comes from `init: true` in docker-compose.yml.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["api"]
