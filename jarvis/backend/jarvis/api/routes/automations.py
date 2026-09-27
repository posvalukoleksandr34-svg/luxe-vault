from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from jarvis.api.deps import Principal, current, get_app
from jarvis.core.container import AppContext
from jarvis.core.timeparse import parse_local
from jarvis.db.base import utcnow
from jarvis.db.models import Automation
from jarvis.integrations.calendar import get_calendar
from jarvis.tasks.scheduler import compute_next, serialize_automation
from jarvis.tools.base import ToolError

router = APIRouter(prefix="/api", tags=["automations"])


@router.get("/automations")
async def list_automations(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    items = await app.automations.list(p.user_id, include_disabled=True)
    return {"automations": [serialize_automation(a) for a in items]}


class AutomationIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    kind: Literal["reminder", "agent"]
    message: str | None = None
    prompt: str | None = None
    cron: str | None = None
    run_at: str | None = None
    interval_minutes: int | None = Field(None, ge=5)
    channels: list[str] = Field(default_factory=list)


@router.post("/automations")
async def create_automation(body: AutomationIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    try:
        kw: dict = {}
        if body.cron:
            kw = {"schedule_type": "cron", "cron": body.cron}
        elif body.run_at:
            kw = {"schedule_type": "once", "run_at": parse_local(body.run_at, p.user.timezone)}
        elif body.interval_minutes:
            kw = {"schedule_type": "interval", "interval_seconds": body.interval_minutes * 60}
        else:
            raise HTTPException(400, "give cron, run_at or interval_minutes")
        payload = {"message": body.message or body.name} if body.kind == "reminder" else {"prompt": body.prompt or ""}
        a = await app.automations.create(user_id=p.user_id, name=body.name, kind=body.kind,
                                         timezone_name=p.user.timezone, payload=payload, channels=body.channels,
                                         created_by="user", **kw)
    except ToolError as exc:
        raise HTTPException(400, str(exc)) from exc
    return serialize_automation(a)


class AutomationPatch(BaseModel):
    enabled: bool | None = None
    name: str | None = None
    cron: str | None = None


@router.patch("/automations/{aid}")
async def patch_automation(aid: uuid.UUID, body: AutomationPatch, p: Principal = Depends(current),
                           app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        a = await session.get(Automation, aid)
        if a is None or a.user_id != p.user_id:
            raise HTTPException(404, "not found")
        if body.name is not None:
            a.name = body.name
        if body.cron is not None and a.schedule_type == "cron":
            a.cron = body.cron
        if body.enabled is not None:
            a.enabled = body.enabled
        try:
            if a.enabled:
                a.next_run_at = compute_next(a)
        except ToolError as exc:
            raise HTTPException(400, str(exc)) from exc
        await session.commit()
        return serialize_automation(a)


@router.delete("/automations/{aid}")
async def delete_automation(aid: uuid.UUID, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        a = await session.get(Automation, aid)
        if a is None or a.user_id != p.user_id:
            raise HTTPException(404, "not found")
        await session.delete(a)
        await session.commit()
    return {"ok": True}


@router.post("/automations/{aid}/run")
async def run_now(aid: uuid.UUID, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        a = await session.get(Automation, aid)
        if a is None or a.user_id != p.user_id:
            raise HTTPException(404, "not found")
        a.next_run_at = utcnow()
        a.enabled = True
        if a.schedule_type == "once":
            a.run_count = 0
            a.run_at = utcnow()
        await session.commit()
    fired = await app.automations.tick()
    return {"fired": fired}


@router.get("/calendar")
async def calendar(days: int = 7, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    cal = await get_calendar(app, p.user_id, p.user.timezone)
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        events = await cal.list(start, start + timedelta(days=max(1, min(days, 31))))
    except ToolError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"source": cal.name, "events": [e.as_dict(p.user.timezone) for e in events]}


@router.get("/drafts")
async def drafts(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    from jarvis.db.models import EmailDraft

    async with app.sessionmaker() as session:
        rows = (await session.execute(select(EmailDraft).where(EmailDraft.user_id == p.user_id)
                                      .order_by(EmailDraft.created_at.desc()).limit(50))).scalars()
        return {"drafts": [{"id": str(d.id), "to": d.to, "cc": d.cc, "subject": d.subject, "body": d.body,
                            "status": d.status, "provider": d.provider, "created_at": d.created_at.isoformat()}
                           for d in rows]}
