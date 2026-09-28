"""Model router: named routes → (provider, model, parameters).

    main    — the orchestrator (chat, planning, tool use)             claude-opus-5, adaptive thinking
    deep    — long background tasks / reports                          claude-opus-5, higher effort
    voice   — spoken conversation, latency first                       claude-opus-5, low effort
    worker  — sub-agents doing reading-heavy work                      claude-sonnet-5
    fast    — memory extraction, titles, reconciliation, classifiers   claude-haiku-4-5
    local   — optional private model on an OpenAI-compatible server    (Ollama / vLLM)

With JARVIS_LLM_PROVIDER=openai the same route names are served by OpenAI GPT models instead
(OPENAI_ROUTES, overridable in config/models.yaml -> openai_routes); Anthropic is not called at all.

Every call is metered (tokens, cost, latency) and checked against the daily budget.
A route may name a `fallback_route` used when its provider is down or unconfigured.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Any

import yaml

from jarvis.core.logging import log
from jarvis.core.metrics import LLM_COST, LLM_LATENCY, LLM_REQUESTS, LLM_TOKENS
from jarvis.llm.pricing import DEFAULT_PRICING, cost_usd
from jarvis.llm.types import LLMError, LLMNotConfigured, LLMProvider, LLMRequest, LLMResponse, RouteConfig, TextCallback

DEFAULT_ROUTES: dict[str, dict[str, Any]] = {
    "main": {"provider": "anthropic", "model": "claude-opus-5", "effort": "medium", "max_tokens": 32000,
             "fallbacks": "default", "fallback_route": "local"},
    "deep": {"provider": "anthropic", "model": "claude-opus-5", "effort": "high", "max_tokens": 64000,
             "fallbacks": "default"},
    "voice": {"provider": "anthropic", "model": "claude-opus-5", "effort": "low", "max_tokens": 8000,
              "fallbacks": "default"},
    "worker": {"provider": "anthropic", "model": "claude-sonnet-5", "effort": "medium", "max_tokens": 32000},
    "fast": {"provider": "anthropic", "model": "claude-haiku-4-5", "thinking": "none", "max_tokens": 4096,
             "eager_tool_streaming": False, "server_tools": False},
    "local": {"provider": "openai_compat", "model": "qwen3:14b", "thinking": "none", "max_tokens": 8000,
              "server_tools": False},
}

# The same roles on OpenAI. GPT-5.6 Terra is the balanced tier; Luna the fast, cheap one.
# `effort` becomes OpenAI's reasoning_effort (none | low | medium | high | xhigh | max).
_OPENAI = {"provider": "openai", "thinking": "none", "server_tools": False, "eager_tool_streaming": False}
OPENAI_ROUTES: dict[str, dict[str, Any]] = {
    "main": {**_OPENAI, "model": "gpt-5.6-terra", "effort": "medium", "max_tokens": 32000, "fallback_route": "local"},
    "deep": {**_OPENAI, "model": "gpt-5.6-terra", "effort": "high", "max_tokens": 64000},
    "voice": {**_OPENAI, "model": "gpt-5.6-terra", "effort": "low", "max_tokens": 8000},
    "worker": {**_OPENAI, "model": "gpt-5.6-luna", "effort": "medium", "max_tokens": 32000},
    "fast": {**_OPENAI, "model": "gpt-5.6-luna", "effort": "low", "max_tokens": 4096},
    "local": DEFAULT_ROUTES["local"],
}


@dataclass
class CallRecord:
    route: str
    provider: str
    model: str
    usage: Any
    cost_usd: float
    latency_ms: int
    stop_reason: str | None
    status: str
    error: str | None
    request_id: str | None
    task_id: uuid.UUID | None
    user_id: uuid.UUID | None


Recorder = Callable[[CallRecord], Awaitable[None]]
SpendLookup = Callable[[], Awaitable[float]]


def load_routes(path: Path | None, provider: str = "anthropic",
                ) -> tuple[dict[str, RouteConfig], dict[str, dict[str, float]], dict[str, str]]:
    raw: dict[str, Any] = {}
    if path and path.exists():
        raw = yaml.safe_load(path.read_text()) or {}
    if provider == "openai":
        routes_raw = {**OPENAI_ROUTES, **(raw.get("openai_routes") or {})}
    else:
        routes_raw = {**DEFAULT_ROUTES, **(raw.get("routes") or {})}
    allowed = {f.name for f in fields(RouteConfig)}
    routes: dict[str, RouteConfig] = {}
    fallbacks: dict[str, str] = {}
    for name, cfg in routes_raw.items():
        cfg = dict(cfg)
        if cfg.get("fallback_route"):
            fallbacks[name] = cfg.pop("fallback_route")
        routes[name] = RouteConfig(name=name, **{k: v for k, v in cfg.items() if k in allowed and k != "name"})
    pricing = {**DEFAULT_PRICING, **(raw.get("pricing") or {})}
    return routes, pricing, fallbacks


class BudgetExceeded(LLMError):
    pass


class ModelRouter:
    def __init__(
        self,
        routes: dict[str, RouteConfig],
        providers: dict[str, LLMProvider],
        *,
        pricing: dict[str, dict[str, float]] | None = None,
        fallbacks: dict[str, str] | None = None,
        recorder: Recorder | None = None,
        spend_today: SpendLookup | None = None,
        daily_limit_usd: float | None = None,
    ):
        self.routes = routes
        self.providers = providers
        self.pricing = pricing or DEFAULT_PRICING
        self.fallbacks = fallbacks or {}
        self.recorder = recorder
        self.spend_today = spend_today
        self.daily_limit = daily_limit_usd

    def route(self, name: str) -> RouteConfig:
        if name not in self.routes:
            raise LLMError(f"unknown model route: {name}")
        return self.routes[name]

    def provider_for(self, route: RouteConfig) -> LLMProvider:
        prov = self.providers.get(route.provider)
        if prov is None:
            raise LLMNotConfigured(f"provider {route.provider!r} is not available")
        return prov

    async def _check_budget(self, route: RouteConfig) -> None:
        if not self.daily_limit or self.spend_today is None:
            return
        if route.model not in self.pricing:  # local / free models are never blocked
            return
        spent = await self.spend_today()
        if spent >= self.daily_limit:
            raise BudgetExceeded(
                f"daily LLM budget of ${self.daily_limit:.2f} reached (spent ${spent:.2f}); "
                "raise JARVIS_DAILY_COST_LIMIT_USD or wait until tomorrow"
            )

    async def generate(
        self,
        route_name: str,
        req: LLMRequest,
        *,
        on_text: TextCallback | None = None,
        task_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
        _tried: tuple[str, ...] = (),
    ) -> LLMResponse:
        route = self.route(route_name)
        started = time.monotonic()
        try:
            await self._check_budget(route)
            provider = self.provider_for(route)
            resp = await provider.generate(route, req, on_text=on_text)
        except LLMError as exc:
            latency = int((time.monotonic() - started) * 1000)
            LLM_REQUESTS.labels(route_name, route.model, "error").inc()
            await self._record(route, None, latency, None, "error", str(exc), None, task_id, user_id)
            fb = self.fallbacks.get(route_name)
            can_fallback = (exc.retryable or isinstance(exc, LLMNotConfigured)) and not isinstance(exc, BudgetExceeded)
            if fb and fb not in _tried and can_fallback and self._route_usable(fb):
                log.warning("llm.fallback", route=route_name, to=fb, error=str(exc))
                return await self.generate(fb, req, on_text=on_text, task_id=task_id, user_id=user_id,
                                           _tried=(*_tried, route_name))
            raise
        latency = int((time.monotonic() - started) * 1000)
        cost = cost_usd(resp.model or route.model, resp.usage, self.pricing)
        LLM_REQUESTS.labels(route_name, route.model, "ok").inc()
        LLM_LATENCY.labels(route_name).observe(latency / 1000)
        LLM_TOKENS.labels(route.model, "input").inc(resp.usage.input_tokens)
        LLM_TOKENS.labels(route.model, "output").inc(resp.usage.output_tokens)
        LLM_TOKENS.labels(route.model, "cache_read").inc(resp.usage.cache_read_tokens)
        LLM_COST.labels(route.model).inc(cost)
        await self._record(route, resp, latency, cost, "ok", None, resp.request_id, task_id, user_id)
        resp.cost_usd = cost
        return resp

    def _route_usable(self, name: str) -> bool:
        r = self.routes.get(name)
        if r is None:
            return False
        prov = self.providers.get(r.provider)
        return prov is not None and getattr(prov, "base_url", "x") != ""

    async def _record(self, route: RouteConfig, resp: LLMResponse | None, latency: int, cost: float | None,
                      status: str, error: str | None, request_id: str | None, task_id, user_id) -> None:
        if self.recorder is None:
            return
        try:
            await self.recorder(
                CallRecord(
                    route=route.name, provider=route.provider, model=(resp.model if resp else route.model),
                    usage=resp.usage if resp else None, cost_usd=cost or 0.0, latency_ms=latency,
                    stop_reason=resp.stop_reason if resp else None, status=status, error=error,
                    request_id=request_id, task_id=task_id, user_id=user_id,
                )
            )
        except Exception:  # noqa: BLE001 - metering must never break a conversation
            log.exception("llm.record_failed")
