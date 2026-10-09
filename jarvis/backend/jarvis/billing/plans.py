"""Plan catalogue loaded from config/plans.yaml (see the comments in that file)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

FEATURE_GROUPS = ("computer", "spotify", "google", "browser", "sandbox", "voice_premium", "custom_commands",
                  "automations", "api")
LIMITS = ("messages_month", "messages_per_minute", "llm_usd_month", "custom_commands", "automations", "devices")


@dataclass
class Plan:
    id: str
    title: str
    description: str = ""
    price_month: float = 0
    currency: str = "USD"
    limits: dict[str, float] = field(default_factory=dict)
    features: list[str] = field(default_factory=list)
    hidden: bool = False
    stripe_price_env: str | None = None

    def has(self, feature: str) -> bool:
        return "*" in self.features or feature in self.features

    def limit(self, metric: str) -> float | None:
        v = self.limits.get(metric)
        return None if v is None else float(v)

    @property
    def stripe_price(self) -> str | None:
        return os.environ.get(self.stripe_price_env) if self.stripe_price_env else None

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "title": self.title, "description": self.description, "price_month": self.price_month,
                "currency": self.currency, "limits": self.limits,
                "features": list(FEATURE_GROUPS) if "*" in self.features else self.features,
                "purchasable": bool(self.stripe_price)}


@dataclass
class Catalog:
    plans: dict[str, Plan]
    default_plan: str = "free"
    owner_plan: str = "owner"
    trial_days: int = 0
    trial_plan: str | None = None

    @classmethod
    def load(cls, path: Path) -> "Catalog":
        if not path.exists():  # no file: a personal install without limits
            owner = Plan(id="owner", title="Owner", features=["*"], hidden=True)
            return cls(plans={"owner": owner}, default_plan="owner", owner_plan="owner")
        raw = yaml.safe_load(path.read_text()) or {}
        plans = {}
        for pid, p in (raw.get("plans") or {}).items():
            unknown = set(p.get("limits") or {}) - set(LIMITS)
            if unknown:
                raise ValueError(f"plans.yaml: plan {pid}: unknown limits {sorted(unknown)}")
            plans[pid] = Plan(id=pid, title=p.get("title", pid), description=p.get("description", ""),
                              price_month=p.get("price_month", 0), currency=p.get("currency", "USD"),
                              limits=p.get("limits") or {}, features=list(p.get("features") or []),
                              hidden=bool(p.get("hidden")), stripe_price_env=p.get("stripe_price_env"))
        cat = cls(plans=plans, default_plan=raw.get("default_plan", "free"), owner_plan=raw.get("owner_plan", "owner"),
                  trial_days=int(raw.get("trial_days") or 0), trial_plan=raw.get("trial_plan"))
        for name in (cat.default_plan, cat.owner_plan, *( [cat.trial_plan] if cat.trial_days else [])):
            if name not in plans:
                raise ValueError(f"plans.yaml: plan '{name}' is referenced but not defined")
        return cat

    def get(self, plan_id: str | None) -> Plan:
        return self.plans.get(plan_id or "") or self.plans[self.default_plan]

    def by_stripe_price(self, price_id: str | None) -> Plan | None:
        return next((p for p in self.plans.values() if price_id and p.stripe_price == price_id), None)
