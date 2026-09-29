"""FastAPI application: REST + WebSocket + webhooks.

    uvicorn jarvis.api.app:create_app --factory --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import func, select

import jarvis
from jarvis.api.routes import (auth, automations, capabilities, chat, commands, devices, integrations, memory,
                               observability, system, tasks)
from jarvis.core.container import AppContext, build_app
from jarvis.core.logging import configure_logging, log
from jarvis.core.metrics import HTTP_LATENCY, HTTP_REQUESTS
from jarvis.db.models import User
from jarvis.settings import Settings, get_settings

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(self)",
}


async def bootstrap(app: AppContext) -> None:
    """First-boot owner: from env (headless installs) or a one-time setup code printed to the log."""
    s = app.settings
    async with app.sessionmaker() as session:
        users = (await session.execute(select(func.count()).select_from(User))).scalar_one()
    if users == 0 and s.owner_email and s.owner_password:
        await auth.create_user(app, email=s.owner_email, password=s.owner_password, name=s.owner_name,
                               timezone=s.timezone, owner=True)
        log.info("bootstrap.owner_created", email=s.owner_email)
        return
    code = await auth.ensure_setup_code(app)
    if code:
        banner = f"JARVIS SETUP CODE: {code}  — open {s.public_url} and create the owner account"
        print("=" * len(banner), banner, "=" * len(banner), sep="\n", flush=True)


def create_app(settings: Settings | None = None, *, context: AppContext | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(fapp: FastAPI):
        configure_logging(settings.log_level, settings.log_json)
        ctx = context or await build_app(settings)
        fapp.state.jarvis = ctx
        await bootstrap(ctx)
        stop = asyncio.Event()
        background: list[asyncio.Task] = []
        if settings.embedded_worker:
            from jarvis.tasks.worker import Worker

            background.append(asyncio.create_task(Worker(ctx, concurrency=settings.worker_concurrency).run(stop)))
        if settings.telegram_mode == "webhook" and settings.telegram_webhook_secret:
            with contextlib.suppress(Exception):
                if await ctx.channels.adapters["telegram"].available():
                    await ctx.channels.adapters["telegram"].set_webhook()
        log.info("api.started", version=jarvis.__version__, env=settings.env, public_url=settings.public_url)
        try:
            yield
        finally:
            stop.set()
            for t in background:
                with contextlib.suppress(BaseException):
                    await asyncio.wait_for(t, timeout=10)
            if context is None:
                await ctx.close()

    fapp = FastAPI(title="JARVIS", version=jarvis.__version__, lifespan=lifespan,
                   docs_url="/api/docs" if settings.env != "production" else None, redoc_url=None,
                   openapi_url="/api/openapi.json" if settings.env != "production" else None)

    @fapp.middleware("http")
    async def observe(request: Request, call_next):
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:  # noqa: BLE001
            log.exception("http.unhandled", path=request.url.path)
            response = JSONResponse({"detail": "internal error"}, status_code=500)
        route = request.scope.get("route")
        path = getattr(route, "path", "unmatched")
        HTTP_REQUESTS.labels(request.method, path, str(response.status_code)).inc()
        HTTP_LATENCY.labels(path).observe(time.perf_counter() - started)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    for r in (auth, chat, tasks, memory, capabilities, integrations, automations, observability, system, devices,
              commands):
        fapp.include_router(r.router)

    # Optional: serve a built frontend directly (single-container dev). In production Caddy serves it.
    static = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    if static.exists():
        @fapp.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            target = (static / path).resolve()
            if path and target.is_file() and static in target.parents:
                return FileResponse(target)
            return FileResponse(static / "index.html")

    return fapp
