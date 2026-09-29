"""Skills, tools and the permission policy."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from jarvis.api.deps import Principal, current, get_app, require_owner
from jarvis.core.audit import audit
from jarvis.core.container import AppContext
from jarvis.db.models import PermissionRule
from jarvis.tools.base import Risk, Tier

router = APIRouter(prefix="/api", tags=["capabilities"])


@router.get("/skills")
async def skills(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    out = []
    for name, s in sorted(app.skills.skills.items()):
        m = s.manifest
        out.append({"name": name, "title": m.title or name, "description": m.description, "version": m.version,
                    "icon": m.icon, "enabled": app.skills.is_enabled(name), "triggers": m.triggers,
                    "tools": sorted({*m.tools, *(t.name for t in s.tools)}), "requires": m.requires,
                    "config": app.skills.config(name), "error": s.error, "path": s.path.name})
    return {"skills": out}


class SkillPatch(BaseModel):
    enabled: bool | None = None
    config: dict | None = None


@router.patch("/skills/{name}")
async def patch_skill(name: str, body: SkillPatch, p: Principal = Depends(require_owner), app: AppContext = Depends(get_app)) -> dict:
    if name not in app.skills.skills:
        raise HTTPException(404, "unknown skill")
    if body.enabled is not None:
        await app.skills.set_enabled(name, body.enabled)
    if body.config is not None:
        await app.skills.set_config(name, body.config)
    async with app.sessionmaker() as session:
        await audit(session, action="skill.updated", actor="user", user_id=p.user_id, target=name,
                    data=body.model_dump(exclude_none=True))
        await session.commit()
    return {"ok": True, "enabled": app.skills.is_enabled(name)}


@router.post("/skills/reload")
async def reload_skills(p: Principal = Depends(require_owner), app: AppContext = Depends(get_app)) -> dict:
    app.skills.discover()
    await app.skills.refresh_state()
    return {"skills": sorted(app.skills.skills)}


@router.get("/tools")
async def tools(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    availability = await app.availability(p.user_id)
    async with app.sessionmaker() as session:
        rules = await app.policy.user_rules(session, p.user_id, "web")
    out = []
    for spec in app.registry.all():
        decision = app.policy.decide(spec, rules=rules)
        missing = [r for r in spec.requires if not availability.get(r, False)]
        out.append({"name": spec.name, "description": spec.description, "risk": spec.risk.value,
                    "tier": decision.tier.value, "tier_reason": decision.reason, "source": spec.source,
                    "skill": spec.skill, "activity": spec.activity, "timeout_s": spec.timeout_s,
                    "retries": spec.retries, "idempotent": spec.idempotent, "requires": list(spec.requires),
                    "available": not missing and spec.name not in app.registry._disabled, "missing": missing,
                    "input_schema": spec.input_schema()})
    mcp_status = await app.secrets.get_setting("mcp_status", {})
    return {"tools": out, "availability": availability, "mcp": mcp_status,
            "server_tools": app.settings.search_provider == "anthropic" and app.settings.llm_provider == "anthropic"}


@router.get("/permissions")
async def permissions(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    cfg = app.policy.config
    async with app.sessionmaker() as session:
        rules = (await session.execute(select(PermissionRule).where(PermissionRule.user_id == p.user_id)
                                       .order_by(PermissionRule.target))).scalars()
        rules = [{"id": str(r.id), "target": r.target, "channel": r.channel, "tier": r.tier, "note": r.note,
                  "updated_at": r.updated_at.isoformat()} for r in rules]
    return {
        "tiers": [t.value for t in Tier], "risks": [r.value for r in Risk],
        "defaults": {k: v.value for k, v in cfg.defaults.items()},
        "tool_policy": {k: v.value for k, v in sorted(cfg.tools.items())},
        "forbidden": cfg.forbidden, "channels": {k: v.value for k, v in cfg.channels.items()},
        "taint": {"write": cfg.taint_write.value, "exempt": sorted(cfg.taint_exempt)},
        "elevation_minutes": cfg.elevation_minutes, "rules": rules,
    }


class RuleIn(BaseModel):
    target: str = Field(min_length=1, max_length=160, description="tool name, skill:<name> or risk:<level>")
    tier: Literal["autonomous", "confirm", "restricted", "forbidden"]
    channel: str = "*"
    note: str = ""


@router.put("/permissions/rules")
async def upsert_rule(body: RuleIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    spec = app.registry.get(body.target)
    if spec is not None and spec.risk == Risk.HIGH and body.tier == "autonomous":
        raise HTTPException(400, "high-risk tools cannot be made autonomous")
    if body.target == "risk:high" and body.tier == "autonomous":
        raise HTTPException(400, "high-risk tools cannot be made autonomous")
    if not p.elevated and body.tier in ("autonomous",) and spec is not None and spec.risk != Risk.READ:
        raise HTTPException(428, {"code": "elevation_required",
                                  "message": "re-authenticate to relax permissions on write/external tools"})
    async with app.sessionmaker() as session:
        row = (await session.execute(select(PermissionRule).where(
            PermissionRule.user_id == p.user_id, PermissionRule.target == body.target,
            PermissionRule.channel == body.channel))).scalar_one_or_none()
        if row is None:
            row = PermissionRule(user_id=p.user_id, target=body.target, channel=body.channel, tier=body.tier,
                                 note=body.note)
            session.add(row)
        else:
            row.tier, row.note = body.tier, body.note
        await audit(session, action="permission.rule_set", actor="user", user_id=p.user_id, target=body.target,
                    data={"tier": body.tier, "channel": body.channel})
        await session.commit()
        return {"id": str(row.id), "target": row.target, "tier": row.tier, "channel": row.channel}


@router.delete("/permissions/rules/{rule_id}")
async def delete_rule(rule_id: uuid.UUID, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        row = await session.get(PermissionRule, rule_id)
        if row is None or row.user_id != p.user_id:
            raise HTTPException(404, "not found")
        await session.delete(row)
        await audit(session, action="permission.rule_deleted", actor="user", user_id=p.user_id, target=row.target)
        await session.commit()
    return {"ok": True}
