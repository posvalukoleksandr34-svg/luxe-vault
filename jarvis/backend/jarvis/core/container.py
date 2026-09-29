"""Service container — wires every subsystem once per process (API, worker, CLI, tests)."""

from __future__ import annotations

import base64
import mimetypes
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from jarvis.agent.identity import Identity, load_identity
from jarvis.agent.profiles import AgentProfile
from jarvis.core.events import EventBus, MemoryEventBus, RedisEventBus
from jarvis.core.logging import log
from jarvis.core.secrets import SecretStore
from jarvis.db.base import make_engine, make_sessionmaker
from jarvis.db.models import Integration, LLMCall, User
from jarvis.llm.router import CallRecord, ModelRouter, load_routes
from jarvis.llm.types import LLMProvider, RouteConfig
from jarvis.memory.embeddings import Embedder, build_embedder
from jarvis.memory.extraction import MemoryExtractor
from jarvis.memory.store import MemoryStore
from jarvis.permissions.policy import PolicyConfig, PolicyEngine
from jarvis.security.crypto import SecretBox, load_or_create_keys
from jarvis.security.ratelimit import RateLimiter
from jarvis.settings import Settings
from jarvis.skills.manager import SkillManager
from jarvis.tools.base import specs_in_module
from jarvis.tools.executor import ToolExecutor
from jarvis.tools.registry import ToolRegistry

SERVER_TOOL_DEFS = {
    "web_search": {"type": "web_search_20260209", "name": "web_search", "max_uses": 6},
    "web_fetch": {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 6},
}


@dataclass
class AppContext:
    settings: Settings
    engine: AsyncEngine
    sessionmaker: async_sessionmaker[AsyncSession]
    redis: Redis | None
    bus: EventBus
    box: SecretBox
    secrets: SecretStore
    ratelimiter: RateLimiter
    registry: ToolRegistry
    executor: ToolExecutor
    identity: Identity
    embedder: Embedder
    memory: MemoryStore
    router: ModelRouter = None  # type: ignore[assignment]
    policy: PolicyEngine = None  # type: ignore[assignment]
    skills: SkillManager = None  # type: ignore[assignment]
    worker_id: str = field(default_factory=lambda: f"w-{uuid.uuid4().hex[:8]}")
    _availability: dict[uuid.UUID, tuple[float, dict[str, bool]]] = field(default_factory=dict)
    _spend: tuple[float, float] = (0.0, -1.0)
    _owners: set[uuid.UUID] = field(default_factory=set)

    # late-bound services (set in build_app)
    tasks: Any = None
    approvals: Any = None
    runtime: Any = None
    extractor: Any = None
    conversations: Any = None
    channels: Any = None
    pairing: Any = None
    voice: Any = None
    google: Any = None
    spotify: Any = None
    automations: Any = None
    browser: Any = None
    sandbox: Any = None
    files: Any = None
    mcp: Any = None
    devices: Any = None
    billing: Any = None
    commands: Any = None

    # ------------------------------------------------------------------ availability

    async def availability(self, user_id: uuid.UUID) -> dict[str, bool]:
        hit = self._availability.get(user_id)
        if hit and time.monotonic() - hit[0] < 60:
            return await self._with_devices(user_id, hit[1])
        async with self.sessionmaker() as session:
            providers = set((await session.execute(select(Integration.provider).where(
                Integration.user_id == user_id, Integration.status == "connected"))).scalars())
        s = self.settings
        search_key = (s.search_provider == "tavily" and await self.secrets.get("tavily_api_key")) or \
                     (s.search_provider == "brave" and await self.secrets.get("brave_api_key"))
        avail = {
            "google": "google" in providers,
            "spotify": "spotify" in providers,
            "browser": bool(self.browser and self.browser.available),
            "sandbox": bool(self.sandbox and self.sandbox.available),
            # Anthropic-hosted search only exists when Claude is the brain.
            "search": bool(search_key) or (s.search_provider == "anthropic" and s.llm_provider == "anthropic"),
            "fetch": True,
        }
        self._availability[user_id] = (time.monotonic(), avail)
        return await self._with_devices(user_id, avail)

    async def _with_devices(self, user_id: uuid.UUID, avail: dict[str, bool]) -> dict[str, bool]:
        """Device presence changes by the second (agent connects/disconnects): never cached."""
        avail = dict(avail)
        online = await self.devices.devices(user_id) if self.devices is not None else []
        avail["computer"] = bool(online)
        for cap in ("apps", "media", "volume", "browser", "input", "clipboard", "windows", "screen", "shell"):
            avail[f"computer.{cap}"] = any(cap in d.capabilities for d in online)
        # plan features and owner kill switches: an unentitled tool is simply not offered
        return await self.billing.mask(user_id, avail) if self.billing is not None else avail

    @property
    def brain_key_name(self) -> str:
        """The secret the configured brain needs: anthropic_api_key or openai_api_key."""
        return "openai_api_key" if self.settings.llm_provider == "openai" else "anthropic_api_key"

    def invalidate_availability(self, user_id: uuid.UUID | None = None) -> None:
        if user_id is None:
            self._availability.clear()
        else:
            self._availability.pop(user_id, None)

    def server_tools(self, route: RouteConfig, profile: AgentProfile) -> list[dict[str, Any]]:
        """Provider-hosted tools (Anthropic web search/fetch) for this route and profile."""
        if self.settings.search_provider != "anthropic" or route.provider != "anthropic" or not route.server_tools:
            return []
        names = sorted(SERVER_TOOL_DEFS)
        if profile.tools is not None:
            names = [n for n in names if n in profile.tools]
        return [SERVER_TOOL_DEFS[n] for n in names]

    # ------------------------------------------------------------------ attachments

    async def user_files(self, user_id: uuid.UUID):
        """The file workspace of this account (owner: the root; everyone else: their own tenant folder)."""
        if user_id not in self._owners:
            async with self.sessionmaker() as session:
                if (await session.execute(select(User.is_owner).where(User.id == user_id))).scalar_one_or_none():
                    self._owners.add(user_id)
        return self.files if user_id in self._owners else self.files.for_tenant(user_id)

    async def attachment_block(self, att: dict[str, Any], user_id: uuid.UUID) -> dict[str, Any] | None:
        if self.files is None or not att.get("path"):
            return None
        try:
            p = (await self.user_files(user_id)).path(att["path"])
            data = p.read_bytes()
        except Exception:  # noqa: BLE001
            return None
        mime = att.get("mime") or mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if mime.startswith("image/") and mime in ("image/png", "image/jpeg", "image/gif", "image/webp") \
                and len(data) < 5 * 1024 * 1024:
            return {"type": "image", "source": {"type": "base64", "media_type": mime,
                                                "data": base64.standard_b64encode(data).decode()}}
        if mime == "application/pdf" and len(data) < 30 * 1024 * 1024:
            return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                                   "data": base64.standard_b64encode(data).decode()},
                    "title": att.get("name") or p.name}
        try:
            from jarvis.integrations.files import extract_text

            text = extract_text(p.name, data)[:40000]
        except Exception:  # noqa: BLE001
            return {"type": "text", "text": f"[attached file {att.get('name') or p.name} ({mime}) — saved at "
                                            f"{att['path']}; content not previewable]"}
        return {"type": "text", "text": f"<attachment name=\"{att.get('name') or p.name}\" path=\"{att['path']}\">\n"
                                        f"{text}\n</attachment>"}

    # ------------------------------------------------------------------ metering

    async def record_llm_call(self, rec: CallRecord) -> None:
        async with self.sessionmaker() as session:
            u = rec.usage
            session.add(LLMCall(
                task_id=rec.task_id, user_id=rec.user_id, route=rec.route, provider=rec.provider, model=rec.model,
                input_tokens=getattr(u, "input_tokens", 0), output_tokens=getattr(u, "output_tokens", 0),
                cache_read_tokens=getattr(u, "cache_read_tokens", 0),
                cache_write_tokens=getattr(u, "cache_write_tokens", 0), cost_usd=rec.cost_usd,
                latency_ms=rec.latency_ms, stop_reason=rec.stop_reason, status=rec.status, error=rec.error,
                request_id=rec.request_id))
            await session.commit()
        self._spend = (self._spend[0] + rec.cost_usd, self._spend[1])

    async def spend_today(self) -> float:
        cached, at = self._spend
        if time.monotonic() - at < 30:
            return cached
        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        async with self.sessionmaker() as session:
            total = (await session.execute(select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0))
                                           .where(LLMCall.created_at >= start))).scalar_one()
        self._spend = (float(total), time.monotonic())
        return float(total)

    async def close(self) -> None:
        if self.mcp is not None:
            await self.mcp.stop()
        if self.browser is not None:
            try:
                await self.browser.close()
            except Exception:  # noqa: BLE001
                pass
        await self.bus.close()
        if self.redis is not None:
            await self.redis.aclose()
        await self.engine.dispose()


def _builtin_tools() -> list:
    from jarvis.tools.builtin import automation, commands, core, voice

    return [*specs_in_module(core), *specs_in_module(automation), *specs_in_module(commands),
            *specs_in_module(voice)]


async def build_app(
    settings: Settings,
    *,
    providers: dict[str, LLMProvider] | None = None,
    embedder: Embedder | None = None,
    use_redis: bool = True,
    bus: EventBus | None = None,
) -> AppContext:
    from jarvis.agent.harness import AgentRuntime
    from jarvis.channels.hub import ChannelHub
    from jarvis.channels.pairing import PairingService
    from jarvis.channels.telegram import TelegramAdapter
    from jarvis.channels.whatsapp import WhatsAppAdapter
    from jarvis.core.conversations import ConversationService
    from jarvis.billing.plans import Catalog
    from jarvis.billing.service import BillingService
    from jarvis.commands.service import CommandService
    from jarvis.devices.hub import DeviceHub
    from jarvis.integrations.browser import BrowserPool
    from jarvis.integrations.files import FileStore
    from jarvis.integrations.google.client import GoogleAuth
    from jarvis.integrations.sandbox import SandboxClient
    from jarvis.integrations.spotify import SpotifyAuth
    from jarvis.llm.anthropic_provider import AnthropicProvider
    from jarvis.llm.fake import DemoBrain
    from jarvis.llm.openai_compat import OpenAICompatProvider
    from jarvis.permissions.approvals import ApprovalService
    from jarvis.tasks.engine import TaskService
    from jarvis.tasks.scheduler import AutomationService
    from jarvis.tools.mcp import McpManager
    from jarvis.voice.service import VoiceService

    engine = make_engine(settings.database_url)
    sessionmaker = make_sessionmaker(engine)
    redis = Redis.from_url(settings.redis_url) if use_redis else None
    bus = bus or (RedisEventBus(redis) if redis is not None else MemoryEventBus())
    box = SecretBox(load_or_create_keys(settings.master_keys, settings.secrets_dir))
    secrets = SecretStore(settings, sessionmaker, box)
    registry = ToolRegistry()
    registry.register_many(_builtin_tools())
    ratelimiter = RateLimiter(redis)
    embedder = embedder or build_embedder(settings.embedding_provider, model=settings.embedding_model,
                                          data_dir=settings.data_dir, voyage_key=settings.voyage_api_key,
                                          openai_key=settings.openai_api_key)
    app = AppContext(
        settings=settings, engine=engine, sessionmaker=sessionmaker, redis=redis, bus=bus, box=box,
        secrets=secrets, ratelimiter=ratelimiter, registry=registry, executor=ToolExecutor(ratelimiter),
        identity=load_identity(settings.config_dir), embedder=embedder, memory=MemoryStore(sessionmaker, embedder),
    )

    # skills (before policy: skills may suggest permission defaults)
    app.skills = SkillManager(settings.skills_dir, registry, sessionmaker)
    app.skills.discover()
    cfg = PolicyConfig.load(settings.config_dir / "permissions.yaml")
    cfg.tools = {**app.skills.permission_defaults(), **cfg.tools}
    app.policy = PolicyEngine(cfg)

    # brain
    routes, pricing, fallbacks = load_routes(settings.config_dir / "models.yaml", settings.llm_provider)
    if providers is None:
        providers = {
            "anthropic": AnthropicProvider(lambda: secrets.get("anthropic_api_key")),
            "openai": OpenAICompatProvider(settings.openai_base_url, lambda: secrets.get("openai_api_key"),
                                           label="OpenAI", require_key=True, openai_params=True),
            "openai_compat": OpenAICompatProvider(settings.local_llm_base_url, settings.local_llm_api_key),
        }
        if settings.fake_llm:
            demo = DemoBrain()
            providers = {"anthropic": demo, "openai": demo, "openai_compat": demo, "demo": demo}
    app.router = ModelRouter(routes, providers, pricing=pricing, fallbacks=fallbacks, recorder=app.record_llm_call,
                             spend_today=app.spend_today, daily_limit_usd=settings.daily_cost_limit_usd)

    app.tasks = TaskService(sessionmaker, bus, redis)
    app.approvals = ApprovalService(sessionmaker, app.tasks, bus, app.policy, ttl_hours=settings.approval_ttl_hours)
    app.extractor = MemoryExtractor(app.router, app.memory)
    app.runtime = AgentRuntime(app)
    app.conversations = ConversationService(app)
    app.channels = ChannelHub(app)
    app.channels.register(TelegramAdapter(app))
    app.channels.register(WhatsAppAdapter(app))
    app.pairing = PairingService(app)
    app.voice = VoiceService(app)
    app.google = GoogleAuth(app)
    app.spotify = SpotifyAuth(app)
    app.automations = AutomationService(app)
    app.browser = BrowserPool(settings.browser_ws_endpoint)
    app.sandbox = SandboxClient(settings.sandbox_url, settings.sandbox_token)
    app.files = FileStore(settings.files_dir)
    app.mcp = McpManager(app)
    app.devices = DeviceHub(redis)
    app.billing = BillingService(app, Catalog.load(settings.config_dir / "plans.yaml"))
    app.commands = CommandService(app)
    try:
        await app.skills.refresh_state()
    except Exception as exc:  # noqa: BLE001 - DB may not be migrated yet (CLI `migrate` path)
        log.warning("skills.state_unavailable", error=str(exc))
    return app
