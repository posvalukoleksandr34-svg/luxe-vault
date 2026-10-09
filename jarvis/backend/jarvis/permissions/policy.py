"""Human-in-the-loop policy.

    risk (declared by the tool)  ──►  tier (decided by policy)
    read / write / external / high    autonomous / confirm / restricted / forbidden

Resolution order (first match wins, then escalations apply):
  1. forbidden globs from config                       → forbidden, no override possible
  2. user rules from the UI (tool, then skill:<name>, then risk:<level>)
  3. per-tool entries in config/permissions.yaml
  4. risk defaults in config/permissions.yaml
Escalations (can only make things stricter):
  - untrusted content in the task context (web page, e-mail body…) → write tools need confirmation
  - high-risk tools are never below restricted unless the config explicitly lowers them
"""

from __future__ import annotations

import fnmatch
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from jarvis.db.models import PermissionRule
from jarvis.tools.base import Risk, Tier, ToolSpec

DEFAULT_POLICY: dict[str, Any] = {
    "defaults": {"read": "autonomous", "write": "autonomous", "external": "confirm", "high": "restricted"},
    "tools": {},
    "forbidden": [],
    "channels": {"web": "restricted", "telegram": "confirm", "whatsapp": "confirm", "voice": "confirm"},
    "taint": {"write": "confirm", "exempt": []},
    "elevation_minutes": 10,
    "allow_always": True,
}


@dataclass
class Decision:
    tier: Tier
    reason: str
    escalated: bool = False


@dataclass
class PolicyConfig:
    defaults: dict[str, Tier]
    tools: dict[str, Tier]
    forbidden: list[str]
    channels: dict[str, Tier]
    taint_write: Tier
    taint_exempt: set[str] = field(default_factory=set)
    elevation_minutes: int = 10
    allow_always: bool = True

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "PolicyConfig":
        merged = {**DEFAULT_POLICY, **(raw or {})}
        taint = {**DEFAULT_POLICY["taint"], **(merged.get("taint") or {})}
        return cls(
            defaults={k: Tier(v) for k, v in {**DEFAULT_POLICY["defaults"], **merged["defaults"]}.items()},
            tools={k: Tier(v) for k, v in (merged.get("tools") or {}).items()},
            forbidden=list(merged.get("forbidden") or []),
            channels={k: Tier(v) for k, v in {**DEFAULT_POLICY["channels"], **(merged.get("channels") or {})}.items()},
            taint_write=Tier(taint["write"]),
            taint_exempt=set(taint.get("exempt") or []),
            elevation_minutes=int(merged.get("elevation_minutes", 10)),
            allow_always=bool(merged.get("allow_always", True)),
        )

    @classmethod
    def load(cls, path: Path) -> "PolicyConfig":
        if path.exists():
            return cls.from_dict(yaml.safe_load(path.read_text()) or {})
        return cls.from_dict({})


class PolicyEngine:
    def __init__(self, config: PolicyConfig):
        self.config = config

    def is_forbidden(self, tool_name: str) -> bool:
        return any(fnmatch.fnmatchcase(tool_name, pat) for pat in self.config.forbidden)

    async def user_rules(self, session: AsyncSession, user_id: uuid.UUID, channel: str) -> dict[str, Tier]:
        rows = (
            await session.execute(
                select(PermissionRule).where(
                    PermissionRule.user_id == user_id, PermissionRule.channel.in_(["*", channel])
                )
            )
        ).scalars()
        rules: dict[str, Tier] = {}
        # channel-specific rules override wildcard ones
        for r in sorted(rows, key=lambda r: r.channel != "*"):
            rules[r.target] = Tier(r.tier)
        return rules

    def decide(self, spec: ToolSpec, *, rules: dict[str, Tier] | None = None, tainted: bool = False) -> Decision:
        name = spec.name
        if self.is_forbidden(name):
            return Decision(Tier.FORBIDDEN, "forbidden by policy")
        rules = rules or {}
        tier: Tier | None = None
        reason = ""
        for key, why in ((name, "user rule"), (f"skill:{spec.skill}", "user skill rule"),
                         (f"risk:{spec.risk.value}", "user risk rule")):
            if key in rules:
                tier, reason = rules[key], why
                break
        if tier is None and name in self.config.tools:
            tier, reason = self.config.tools[name], "tool policy"
        if tier is None:
            tier, reason = self.config.defaults[spec.risk.value], f"default for {spec.risk.value} risk"

        escalated = False
        if tainted and name not in self.config.taint_exempt:
            floor = Tier.AUTONOMOUS
            if spec.risk == Risk.WRITE:
                floor = self.config.taint_write
            elif spec.risk in (Risk.EXTERNAL, Risk.HIGH):
                floor = Tier.CONFIRM if spec.risk == Risk.EXTERNAL else Tier.RESTRICTED
            if floor.rank > tier.rank:
                tier, reason, escalated = floor, "escalated: untrusted content in context", True
        return Decision(tier, reason, escalated)

    def channel_can_approve(self, channel: str, tier: Tier) -> bool:
        ceiling = self.config.channels.get(channel, Tier.CONFIRM)
        return tier.rank <= ceiling.rank
