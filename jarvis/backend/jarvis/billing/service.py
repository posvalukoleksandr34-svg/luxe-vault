"""Entitlements: which plan an account is on, what it may use, and how much it has used.

Everything is decided server-side from the database (subscriptions written by payment webhooks or the
owner) — the client never tells us its plan. Enforcement points call `check()` before doing work:
conversation turns (messages, burst rate, model budget), custom commands, automations, devices, the public
API. Feature groups (computer, spotify, google, …) are applied to tool availability, so an unentitled tool
is simply not offered to the model.

Global feature flags (owner-controlled kill switches) and maintenance mode live here too.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from jarvis.billing.plans import FEATURE_GROUPS, Catalog, Plan
from jarvis.db.models import Automation, CustomCommand, LLMCall, Subscription, UsageCounter, User
from jarvis.tools.base import ToolError

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

ENTITLED = ("active", "trialing", "past_due", "manual")  # past_due = grace period while the card is retried
CACHE_S = 30
# availability keys controlled by a feature group
GROUP_KEYS = {"computer": "computer", "spotify": "spotify", "google": "google", "browser": "browser",
              "sandbox": "sandbox"}
FLAGS = {  # owner kill switches (default on)
    "computer": "Управление компьютером (desktop-агент)",
    "spotify": "Spotify",
    "custom_commands": "Свои команды",
    "voice_premium": "Серверный голос (STT/TTS)",
    "public_api": "Публичный API v1",
    "signup": "Регистрация новых аккаунтов (если JARVIS_SIGNUP_MODE не closed)",
}
FEATURE_LABELS = {**FLAGS, "google": "Google (Gmail, Calendar, Drive)", "browser": "Серверный браузер",
                  "sandbox": "Песочница для кода", "automations": "Автоматизации", "api": "Личный API",
                  "public_api": "Публичный API v1"}
LABELS = {
    "messages_month": "сообщений в месяц", "messages_per_minute": "сообщений в минуту",
    "llm_usd_month": "бюджет модели в месяц", "custom_commands": "своих команд",
    "automations": "автоматизаций", "devices": "подключённых компьютеров",
}


class QuotaExceeded(ToolError):
    def __init__(self, metric: str, limit: float, plan: Plan, *, feature: bool = False):
        self.metric, self.limit, self.plan, self.feature = metric, limit, plan, feature
        if feature:
            msg = f"Функция «{FEATURE_LABELS.get(metric, metric)}» не входит в тариф {plan.title}."
        elif metric == "messages_per_minute":
            msg = "Слишком много сообщений подряд — подождите минуту."
        elif metric == "llm_usd_month":
            msg = f"Месячный бюджет модели по тарифу {plan.title} исчерпан (${limit:g})."
        else:
            msg = f"Достигнут лимит тарифа {plan.title}: {limit:g} {LABELS.get(metric, metric)}."
        super().__init__(msg)

    def payload(self) -> dict[str, Any]:
        return {"code": "feature_not_in_plan" if self.feature else "quota_exceeded", "metric": self.metric,
                "limit": self.limit, "plan": self.plan.id, "message": str(self)}


def period(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m")


def _month_start() -> datetime:
    return datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


class BillingService:
    def __init__(self, app: "AppContext", catalog: Catalog):
        self.app = app
        self.catalog = catalog
        self._plans: dict[uuid.UUID, tuple[float, Plan, dict[str, Any]]] = {}
        self._spend: dict[uuid.UUID, tuple[float, float]] = {}
        self._flags: tuple[float, dict[str, bool]] = (0.0, {})
        self._maint: tuple[float, dict[str, Any]] = (0.0, {})

    # ------------------------------------------------------------------ plan

    def invalidate(self, user_id: uuid.UUID | None = None) -> None:
        if user_id is None:
            self._plans.clear()
        else:
            self._plans.pop(user_id, None)
        self.app.invalidate_availability(user_id)

    async def subscription(self, user_id: uuid.UUID) -> dict[str, Any]:
        """Plan + subscription state for display (the plan object itself via `plan()`)."""
        await self.plan(user_id)
        return self._plans[user_id][2]

    async def plan(self, user_id: uuid.UUID) -> Plan:
        hit = self._plans.get(user_id)
        if hit and time.monotonic() - hit[0] < CACHE_S:
            return hit[1]
        async with self.app.sessionmaker() as session:
            user = await session.get(User, user_id)
            sub = (await session.execute(select(Subscription).where(Subscription.user_id == user_id))).scalar_one_or_none()
        info: dict[str, Any] = {"source": "default", "status": None, "provider": None, "current_period_end": None,
                                "cancel_at_period_end": False, "trial_ends_at": None}
        now = datetime.now(timezone.utc)
        if user is not None and user.is_owner:
            plan, info["source"] = self.catalog.get(self.catalog.owner_plan), "owner"
        elif sub is not None and sub.status in ENTITLED and sub.plan in self.catalog.plans and (
                sub.status != "trialing" or not sub.trial_ends_at or sub.trial_ends_at > now):
            plan = self.catalog.get(sub.plan)
            info.update(source="subscription", status=sub.status, provider=sub.provider,
                        current_period_end=sub.current_period_end.isoformat() if sub.current_period_end else None,
                        cancel_at_period_end=sub.cancel_at_period_end,
                        trial_ends_at=sub.trial_ends_at.isoformat() if sub.trial_ends_at else None)
        else:
            plan = self.catalog.get(self.catalog.default_plan)
            if sub is not None:
                info.update(status=sub.status, provider=sub.provider)
        self._plans[user_id] = (time.monotonic(), plan, info)
        return plan

    # ------------------------------------------------------------------ usage

    async def record(self, user_id: uuid.UUID, metric: str, amount: float = 1) -> None:
        async with self.app.sessionmaker() as session:
            stmt = insert(UsageCounter).values(user_id=user_id, period=period(), metric=metric, value=amount,
                                               updated_at=datetime.now(timezone.utc))
            stmt = stmt.on_conflict_do_update(constraint="uq_usage_user_period_metric",
                                              set_={"value": UsageCounter.value + amount,
                                                    "updated_at": datetime.now(timezone.utc)})
            await session.execute(stmt)
            await session.commit()

    async def event(self, user_id: uuid.UUID | None, name: str) -> None:
        """Privacy-friendly product analytics: a monthly counter per event name, never content."""
        if user_id is not None:
            try:
                await self.record(user_id, f"event.{name}")
            except Exception:  # noqa: BLE001 — analytics must never break the product
                pass

    async def spend_month(self, user_id: uuid.UUID) -> float:
        hit = self._spend.get(user_id)
        if hit and time.monotonic() - hit[0] < CACHE_S:
            return hit[1]
        async with self.app.sessionmaker() as session:
            total = (await session.execute(select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(
                LLMCall.user_id == user_id, LLMCall.created_at >= _month_start()))).scalar_one()
        self._spend[user_id] = (time.monotonic(), float(total))
        return float(total)

    async def current(self, user_id: uuid.UUID, metric: str) -> float:
        if metric == "llm_usd_month":
            return await self.spend_month(user_id)
        if metric == "devices":
            return len(await self.app.devices.devices(user_id)) if self.app.devices else 0
        async with self.app.sessionmaker() as session:
            if metric == "custom_commands":
                return (await session.execute(select(func.count()).select_from(CustomCommand).where(
                    CustomCommand.user_id == user_id))).scalar_one()
            if metric == "automations":
                return (await session.execute(select(func.count()).select_from(Automation).where(
                    Automation.user_id == user_id, Automation.enabled.is_(True)))).scalar_one()
            name = "messages" if metric == "messages_month" else metric
            return (await session.execute(select(UsageCounter.value).where(
                UsageCounter.user_id == user_id, UsageCounter.period == period(),
                UsageCounter.metric == name))).scalar_one_or_none() or 0

    async def usage(self, user_id: uuid.UUID) -> dict[str, Any]:
        plan = await self.plan(user_id)
        out = {}
        for metric in ("messages_month", "llm_usd_month", "custom_commands", "automations", "devices"):
            out[metric] = {"used": round(await self.current(user_id, metric), 4), "limit": plan.limit(metric)}
        return {"period": period(), "metrics": out}

    # ------------------------------------------------------------------ enforcement

    async def check(self, user_id: uuid.UUID, metric: str, *, adding: float = 1) -> None:
        plan = await self.plan(user_id)
        limit = plan.limit(metric)
        if limit is None:
            return
        if metric == "messages_per_minute":
            if not await self.app.ratelimiter.hit(f"quota:msg:{user_id}", limit=int(limit), window_s=60):
                raise QuotaExceeded(metric, limit, plan)
            return
        used = await self.current(user_id, metric)
        over = (used + adding > limit + 1e-9) if adding else (used >= limit)  # adding=0: "budget already spent?"
        if over:
            raise QuotaExceeded(metric, limit, plan)

    async def require(self, user_id: uuid.UUID, feature: str) -> None:
        plan = await self.plan(user_id)
        if not plan.has(feature) or not await self.flag(feature):
            raise QuotaExceeded(feature, 0, plan, feature=True)

    async def allowed(self, user_id: uuid.UUID, feature: str) -> bool:
        return (await self.plan(user_id)).has(feature) and await self.flag(feature)

    async def before_turn(self, user_id: uuid.UUID) -> None:
        """Gate for anything that starts assistant work on the user's behalf."""
        await self.check(user_id, "messages_per_minute")
        await self.check(user_id, "messages_month")
        await self.check(user_id, "llm_usd_month", adding=0)

    async def mask(self, user_id: uuid.UUID, avail: dict[str, bool]) -> dict[str, bool]:
        """Remove capabilities the plan or a kill switch does not allow."""
        plan = await self.plan(user_id)
        flags = await self.flags()
        out = dict(avail)
        for group, key in GROUP_KEYS.items():
            if plan.has(group) and flags.get(group, True):
                continue
            for k in list(out):
                if k == key or k.startswith(key + "."):
                    out[k] = False
        return out

    # ------------------------------------------------------------------ flags & maintenance

    async def flags(self) -> dict[str, bool]:
        at, cached = self._flags
        if time.monotonic() - at < 10:
            return cached
        stored = await self.app.secrets.get_setting("feature_flags", {}) or {}
        flags = {name: bool(stored.get(name, True)) for name in FLAGS}
        self._flags = (time.monotonic(), flags)
        return flags

    async def flag(self, name: str) -> bool:
        return (await self.flags()).get(name, True)

    async def set_flags(self, values: dict[str, bool]) -> dict[str, bool]:
        stored = await self.app.secrets.get_setting("feature_flags", {}) or {}
        stored.update({k: bool(v) for k, v in values.items() if k in FLAGS})
        await self.app.secrets.set_setting("feature_flags", stored)
        self._flags = (0.0, {})
        self.invalidate()
        return await self.flags()

    async def maintenance(self) -> dict[str, Any]:
        at, cached = self._maint
        if time.monotonic() - at < 5:
            return cached
        value = await self.app.secrets.get_setting("maintenance", {}) or {}
        m = {"enabled": bool(value.get("enabled")), "message": value.get("message") or ""}
        self._maint = (time.monotonic(), m)
        return m

    async def set_maintenance(self, enabled: bool, message: str) -> dict[str, Any]:
        await self.app.secrets.set_setting("maintenance", {"enabled": enabled, "message": message})
        self._maint = (0.0, {})
        return await self.maintenance()

    @staticmethod
    def feature_groups() -> tuple[str, ...]:
        return FEATURE_GROUPS
