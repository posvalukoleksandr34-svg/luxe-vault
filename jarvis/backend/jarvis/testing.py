"""Shared pytest fixtures for core and skill tests.

Integration tests use a real PostgreSQL (with pgvector) and Redis:
    JARVIS_TEST_DATABASE_URL=postgresql+asyncpg://jarvis:jarvis@localhost:55432/jarvis_test
    JARVIS_TEST_REDIS_URL=redis://localhost:56379/15
`make test-infra` starts both in Docker. Without them, integration tests are skipped.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet

from jarvis.core.events import MemoryEventBus
from jarvis.llm.fake import DemoBrain
from jarvis.llm.types import LLMProvider, LLMRequest, LLMResponse, RouteConfig, TextCallback
from jarvis.memory.embeddings import HashEmbedder
from jarvis.settings import Settings
from jarvis.tools.base import ToolContext

ROOT = Path(__file__).resolve().parents[2]  # the jarvis/ project root
DB_URL = os.environ.get("JARVIS_TEST_DATABASE_URL", "postgresql+asyncpg://jarvis:jarvis@localhost:55432/jarvis_test")
REDIS_URL = os.environ.get("JARVIS_TEST_REDIS_URL", "redis://localhost:56379/15")


class SwitchableProvider(LLMProvider):
    """Delegates to `impl` (DemoBrain by default); tests swap in a ScriptedProvider."""

    name = "switchable"

    def __init__(self) -> None:
        self.impl: LLMProvider = DemoBrain()
        self.requests: list[tuple[str, LLMRequest]] = []

    async def generate(self, route: RouteConfig, req: LLMRequest, *, on_text: TextCallback | None = None) -> LLMResponse:
        self.requests.append((route.name, req))
        from jarvis.llm.fake import ScriptedProvider

        if req.output_schema is not None and isinstance(self.impl, ScriptedProvider) and not callable(self.impl.script):
            # background memory extraction should not consume a test's scripted turns
            return await DemoBrain().generate(route, req, on_text=on_text)
        return await self.impl.generate(route, req, on_text=on_text)


def _db_available() -> bool:
    import asyncpg

    async def probe() -> bool:
        try:
            base = DB_URL.replace("+asyncpg", "").rsplit("/", 1)[0] + "/postgres"
            conn = await asyncpg.connect(base, timeout=3)
            dbname = DB_URL.rsplit("/", 1)[1]
            exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", dbname)
            if not exists:
                await conn.execute(f'CREATE DATABASE "{dbname}"')
            await conn.close()
            return True
        except Exception:  # noqa: BLE001
            return False

    return asyncio.run(probe())


_DB_OK: bool | None = None


def db_ok() -> bool:
    global _DB_OK
    if _DB_OK is None:
        _DB_OK = _db_available()
    return _DB_OK


def pytest_collection_modifyitems(config, items):  # noqa: ANN001 - pytest hook
    if db_ok():
        return
    skip = pytest.mark.skip(reason="integration: PostgreSQL/Redis not available (run `make test-infra`)")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def test_settings(tmp_path_factory) -> Settings:
    data = tmp_path_factory.mktemp("jarvis-data")
    return Settings(
        env="test", database_url=DB_URL, redis_url=REDIS_URL, data_dir=data, config_dir=ROOT / "config",
        skills_dir=ROOT / "skills", embedding_provider="hash", master_keys=Fernet.generate_key().decode(),
        public_url="http://testserver", log_json=False, daily_cost_limit_usd=100.0,
    )


@pytest.fixture(scope="session")
def migrated(test_settings: Settings) -> bool:
    if not db_ok():
        pytest.skip("PostgreSQL not available")
    env = {**os.environ, "JARVIS_DATABASE_URL": test_settings.database_url}
    backend = ROOT / "backend"
    drop = ("import asyncio, asyncpg\n"
            "async def m():\n"
            f"    c = await asyncpg.connect({test_settings.database_url.replace('+asyncpg', '')!r})\n"
            "    await c.execute('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;')\n"
            "    await c.close()\n"
            "asyncio.run(m())\n")
    subprocess.run([sys.executable, "-c", drop], check=True, env=env)
    subprocess.run([sys.executable, "-m", "alembic", "-c", str(backend / "alembic.ini"), "upgrade", "head"],
                   check=True, env=env, cwd=backend, capture_output=True)
    return True


@pytest.fixture(scope="session")
def provider() -> SwitchableProvider:
    return SwitchableProvider()


@pytest_asyncio.fixture(scope="session")
async def app(test_settings: Settings, migrated: bool, provider: SwitchableProvider):
    from jarvis.core.container import build_app

    ctx = await build_app(test_settings, providers={"anthropic": provider, "openai_compat": provider},
                          embedder=HashEmbedder(), bus=MemoryEventBus())
    try:
        await ctx.redis.flushdb()
    except Exception:  # noqa: BLE001
        ctx.redis = None
        ctx.tasks.redis = None
        ctx.ratelimiter.redis = None
    yield ctx
    await ctx.close()


@pytest.fixture(autouse=True)
def reset_provider(provider: SwitchableProvider):  # public name: conftests star-import fixtures
    provider.impl = DemoBrain()
    provider.requests.clear()
    yield


@pytest_asyncio.fixture(autouse=True)
async def isolate_task_queue(request):
    """Leftover queued tasks from one test must not be executed by the next one."""
    yield
    if "app" not in request.fixturenames:
        return
    app = request.getfixturevalue("app")
    from sqlalchemy import update

    from jarvis.db.models import Task

    async with app.sessionmaker() as session:
        await session.execute(update(Task).where(Task.status.in_(["queued", "running", "waiting_approval"]))
                              .values(status="cancelled"))
        await session.commit()


@pytest_asyncio.fixture
async def user(app):
    from jarvis.api.routes.auth import create_user

    return await create_user(app, email=f"u{uuid.uuid4().hex[:10]}@test.local", password="correct horse battery",
                             name="Тестер", timezone="Europe/Berlin", owner=True)


@pytest.fixture
def tool_ctx(app):
    def make(u, **kw: Any) -> ToolContext:
        return ToolContext(app=app, user_id=u.id, timezone=u.timezone, **kw)

    return make


async def run_tasks(app, *, max_rounds: int = 50) -> int:
    """Execute queued tasks inline until the queue is empty (deterministic, no background loop)."""
    from jarvis.tasks.worker import Worker

    worker = Worker(app, concurrency=1)
    done = 0
    for _ in range(max_rounds):
        claimed = await app.tasks.claim(app.worker_id, limit=1)
        if not claimed:
            break
        await worker._execute(claimed[0])
        done += 1
    return done


@pytest_asyncio.fixture
async def api(app):
    import httpx

    from jarvis.api.app import create_app

    fapp = create_app(app.settings, context=app)
    fapp.state.jarvis = app
    transport = httpx.ASGITransport(app=fapp)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver",
                                 headers={"X-Jarvis-Request": "1"}) as client:
        yield client


@pytest_asyncio.fixture
async def authed(api, user, app):
    if app.redis is not None:  # many logins from one test "IP" would trip the brute-force limiter
        keys = [k async for k in app.redis.scan_iter("jarvis:rl:*")]
        if keys:
            await app.redis.delete(*keys)
    r = await api.post("/api/auth/login", json={"email": user.email, "password": "correct horse battery"})
    assert r.status_code == 200, r.text
    return api
