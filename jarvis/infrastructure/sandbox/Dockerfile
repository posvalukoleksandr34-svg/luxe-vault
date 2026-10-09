# Build context: ./backend (only the single-file server is copied).
# Isolated code runner for the coding agent. No JARVIS code or data inside; no internet
# (compose attaches it only to an internal network); non-root; read-only root filesystem.
FROM python:3.12-slim
# Command-line tools available to the coding agent (override with --build-arg APT_PACKAGES=... or "").
ARG APT_PACKAGES="git curl jq sqlite3"
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export PIP_CERT=/run/secrets/ca; fi; \
    if [ -n "$APT_PACKAGES" ]; then apt-get update && apt-get install -y --no-install-recommends $APT_PACKAGES \
      && rm -rf /var/lib/apt/lists/*; fi \
    && pip install --no-cache-dir fastapi "uvicorn[standard]" pydantic \
       numpy pandas matplotlib openpyxl python-docx pypdf requests beautifulsoup4 \
    && useradd --uid 20001 --create-home --shell /bin/bash runner \
    && mkdir -p /workspace && chown runner:runner /workspace
COPY jarvis/sandbox_server.py /opt/sandbox/sandbox_server.py
WORKDIR /workspace
USER runner
ENV MPLCONFIGDIR=/tmp SANDBOX_WORKSPACE=/workspace PYTHONPATH=/opt/sandbox
EXPOSE 8090
CMD ["uvicorn", "sandbox_server:app", "--host", "0.0.0.0", "--port", "8090", "--app-dir", "/opt/sandbox"]
