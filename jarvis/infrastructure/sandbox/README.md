# Sandbox

Built from `backend/` as context, but only `jarvis/sandbox_server.py` (a single-file FastAPI app with no
JARVIS imports) is copied in — the sandbox contains no JARVIS code, secrets or database drivers.

Isolation (docker-compose.yml): non-root user, read-only root filesystem, `cap_drop: ALL`,
`no-new-privileges`, PID/memory/CPU limits, and only the internal `sandbox_net` network — no internet
and no route to Postgres/Redis. To allow internet access (pip install, git clone), make `sandbox_net`
non-internal — a deliberate trade-off, off by default.
