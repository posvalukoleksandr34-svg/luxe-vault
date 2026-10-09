"""Unauthenticated product endpoints (remote config, plans, version) and the versioned public API v1.

API v1 is a stable subset for scripts and integrations: personal API tokens (Settings → Devices → "Script /
API", scope `chat`) and the `api` plan feature. The full OpenAPI schema of every endpoint is served at
/api/openapi.json outside production; /api/v1/openapi.json lists only the stable v1 surface.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from jarvis.api.deps import Principal, current, get_app, require_scope
from jarvis.core.container import AppContext
from jarvis.core.version import version_info
from jarvis.db.models import SupportReport, Task

router = APIRouter(tags=["public"])
v1 = APIRouter(prefix="/api/v1", tags=["api v1"])


@router.get("/api/version")
async def version(app: AppContext = Depends(get_app)) -> dict:
    return await version_info(app)


@router.get("/api/public/config")
async def public_config(app: AppContext = Depends(get_app)) -> dict:
    """What the login / pricing / legal pages need before sign-in. Never secrets."""
    s = app.settings
    return {"product_name": s.product_name, "signup_mode": s.signup_mode if await app.billing.flag("signup") else "closed",
            "support_email": s.support_email, "legal_entity": s.legal_entity, "public_url": s.public_url,
            "maintenance": await app.billing.maintenance(), "version": await version_info(app),
            "plans": [p.public() for p in app.billing.catalog.plans.values() if not p.hidden]}


class SupportIn(BaseModel):
    kind: Literal["bug", "feedback", "support"] = "support"
    message: str = Field(min_length=3, max_length=5000)
    page: str | None = Field(None, max_length=300)


@router.post("/api/support")
async def support(body: SupportIn, request: Request, p: Principal = Depends(current),
                  app: AppContext = Depends(get_app)) -> dict:
    if not await app.ratelimiter.hit(f"support:{p.user_id}", limit=10, window_s=3600):
        raise HTTPException(429, "too many reports, try later")
    context = {"page": body.page, "version": (await version_info(app))["app"],
               "user_agent": (request.headers.get("user-agent") or "")[:200]}
    async with app.sessionmaker() as session:
        row = SupportReport(user_id=p.user_id, kind=body.kind, message=body.message, context=context)
        session.add(row)
        await session.commit()
    await app.billing.event(p.user_id, f"support_{body.kind}")
    return {"id": str(row.id)}


# ------------------------------------------------------------------------------------------ API v1

async def api_principal(p: Principal = Depends(require_scope("chat")), app: AppContext = Depends(get_app)) -> Principal:
    if not await app.billing.flag("public_api"):
        raise HTTPException(503, "the public API is switched off on this server")
    await app.billing.require(p.user_id, "api")
    return p


class V1Message(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    conversation_id: uuid.UUID | None = None


@v1.post("/messages", summary="Send a message to the assistant; poll the task for the answer")
async def v1_message(body: V1Message, p: Principal = Depends(api_principal), app: AppContext = Depends(get_app)) -> dict:
    try:
        msg, task = await app.conversations.submit(user_id=p.user_id, text=body.text, channel="web",
                                                   conversation_id=body.conversation_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"message_id": str(msg.id), "conversation_id": str(msg.conversation_id),
            "task_id": str(task.id) if task else None}


@v1.get("/tasks/{task_id}", summary="Status and result of a task")
async def v1_task(task_id: uuid.UUID, p: Principal = Depends(api_principal), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        t = await session.get(Task, task_id)
    if t is None or t.user_id != p.user_id:
        raise HTTPException(404, "not found")
    return {"id": str(t.id), "status": t.status, "kind": t.kind, "title": t.title,
            "result": t.result, "error": t.error,
            "created_at": t.created_at.isoformat(), "finished_at": t.finished_at.isoformat() if t.finished_at else None}


@v1.get("/usage", summary="Plan, limits and usage of the calling account")
async def v1_usage(p: Principal = Depends(api_principal), app: AppContext = Depends(get_app)) -> dict:
    return {"plan": (await app.billing.plan(p.user_id)).id, **(await app.billing.usage(p.user_id))}


@v1.get("/openapi.json", include_in_schema=False)
async def v1_openapi(request: Request) -> dict:
    schema = request.app.openapi()
    return {**schema, "info": {"title": "JARVIS public API", "version": "1.0.0",
                               "description": "Bearer token with scope `chat` (Settings → Devices → Script / API)."},
            "paths": {k: v for k, v in schema["paths"].items() if k.startswith("/api/v1/")}}


router.include_router(v1)
