"""Custom commands (macros) + the catalog the command builder uses."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException

from jarvis.api.deps import Principal, current, get_app
from jarvis.commands.service import NOT_STEPPABLE, CommandError, CommandIn, serialize
from jarvis.core.container import AppContext
from jarvis.tools.base import Tier

router = APIRouter(prefix="/api/commands", tags=["commands"])


@router.get("")
async def list_commands(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    return {"commands": [serialize(c) for c in await app.commands.list(p.user_id)]}


@router.get("/catalog")
async def catalog(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    """Tools a command step may use, with their input schema and current approval tier."""
    availability = await app.availability(p.user_id)
    async with app.sessionmaker() as session:
        rules = await app.policy.user_rules(session, p.user_id, "web")
    out = []
    for spec in app.registry.all():
        if spec.name.startswith(NOT_STEPPABLE) or spec.name in app.registry._disabled:
            continue
        tier = app.policy.decide(spec, rules=rules).tier
        if tier in (Tier.FORBIDDEN, Tier.RESTRICTED):
            continue
        missing = [r for r in spec.requires if not availability.get(r)]
        out.append({"name": spec.name, "description": spec.description, "activity": spec.activity,
                    "skill": spec.skill, "tier": tier.value, "available": not missing, "missing": missing,
                    "input_schema": spec.input_schema()})
    return {"tools": sorted(out, key=lambda t: (t["skill"] or "", t["name"])),
            "conditions": ["always", "device_online", "device_offline", "weekday", "weekend", "morning",
                           "afternoon", "evening"]}


async def _save(body: CommandIn, p: Principal, app: AppContext, command_id: uuid.UUID | None = None) -> dict:
    try:
        row, warnings = await app.commands.save(p.user_id, body, elevated=p.elevated, command_id=command_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except CommandError as exc:
        if "re-authentication" in str(exc):
            raise HTTPException(428, {"code": "elevation_required", "message": str(exc)}) from exc
        raise HTTPException(400, str(exc)) from exc
    return {"command": serialize(row), "warnings": warnings}


@router.post("")
async def create_command(body: CommandIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    return await _save(body, p, app)


@router.put("/{command_id}")
async def update_command(command_id: uuid.UUID, body: CommandIn, p: Principal = Depends(current),
                         app: AppContext = Depends(get_app)) -> dict:
    return await _save(body, p, app, command_id)


@router.post("/validate")
async def validate_command(body: CommandIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    try:
        return {"ok": True, "warnings": await app.commands.validate(p.user_id, body, elevated=p.elevated)}
    except CommandError as exc:
        return {"ok": False, "error": str(exc)}


@router.delete("/{command_id}")
async def delete_command(command_id: uuid.UUID, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    if not await app.commands.delete(p.user_id, command_id):
        raise HTTPException(404, "command not found")
    return {"ok": True}


@router.post("/{command_id}/run")
async def run_command(command_id: uuid.UUID, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    cmd = await app.commands.get(p.user_id, command_id)
    if cmd is None:
        raise HTTPException(404, "command not found")
    conv = await app.conversations.primary(p.user_id)
    task = await app.commands.start(p.user_id, cmd, channel="web", conversation_id=conv.id)
    return {"task_id": str(task.id)}
