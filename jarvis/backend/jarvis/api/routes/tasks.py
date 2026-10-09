from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from jarvis.api.deps import Principal, current, get_app
from jarvis.core.container import AppContext
from jarvis.db.models import Approval, LLMCall, Task, TaskEvent, ToolCall
from jarvis.permissions.approvals import ApprovalError, ApprovalService

router = APIRouter(prefix="/api", tags=["tasks"])


def task_payload(t: Task) -> dict:
    return {
        "id": str(t.id), "kind": t.kind, "status": t.status, "title": t.title, "channel": t.channel,
        "conversation_id": str(t.conversation_id) if t.conversation_id else None,
        "parent_id": str(t.parent_id) if t.parent_id else None, "error": t.error,
        "attempts": t.attempts, "cost_usd": round(t.cost_usd, 5), "input_tokens": t.input_tokens,
        "output_tokens": t.output_tokens, "created_at": t.created_at.isoformat(),
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "finished_at": t.finished_at.isoformat() if t.finished_at else None,
        "result": (t.result or {}).get("text", "")[:4000] if t.result else None,
        "step": (t.state or {}).get("step"),
    }


@router.get("/tasks")
async def list_tasks(status: str | None = None, kind: str | None = None, limit: int = 100,
                     p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        stmt = select(Task).where(Task.user_id == p.user_id)
        if status:
            stmt = stmt.where(Task.status.in_(status.split(",")))
        if kind:
            stmt = stmt.where(Task.kind.in_(kind.split(",")))
        rows = (await session.execute(stmt.order_by(Task.created_at.desc()).limit(min(limit, 500)))).scalars()
        return {"tasks": [task_payload(t) for t in rows]}


@router.get("/tasks/{task_id}")
async def get_task(task_id: uuid.UUID, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        t = await session.get(Task, task_id)
        if t is None or t.user_id != p.user_id:
            raise HTTPException(404, "not found")
        events = (await session.execute(select(TaskEvent).where(TaskEvent.task_id == task_id)
                                        .order_by(TaskEvent.id).limit(500))).scalars()
        calls = (await session.execute(select(ToolCall).where(ToolCall.task_id == task_id)
                                       .order_by(ToolCall.created_at))).scalars()
        llm = (await session.execute(select(LLMCall).where(LLMCall.task_id == task_id)
                                     .order_by(LLMCall.created_at))).scalars()
        approvals = (await session.execute(select(Approval).where(Approval.task_id == task_id))).scalars()
        children = (await session.execute(select(Task).where(Task.parent_id == task_id))).scalars()
        return {
            "task": task_payload(t),
            "input": {k: v for k, v in (t.input or {}).items() if k in ("text", "prompt", "agent", "kind")},
            "events": [{"type": e.type, "data": e.data, "at": e.created_at.isoformat()} for e in events],
            "tool_calls": [{"id": str(c.id), "tool": c.tool_name, "status": c.status, "risk": c.risk, "tier": c.tier,
                            "input": c.input, "output": (c.output or {}).get("content", "")[:3000] if c.output else None,
                            "error": c.error, "duration_ms": c.duration_ms, "attempts": c.attempts,
                            "at": c.created_at.isoformat()} for c in calls],
            "llm_calls": [{"route": c.route, "model": c.model, "input_tokens": c.input_tokens,
                           "output_tokens": c.output_tokens, "cache_read_tokens": c.cache_read_tokens,
                           "cost_usd": c.cost_usd, "latency_ms": c.latency_ms, "status": c.status,
                           "stop_reason": c.stop_reason, "error": c.error, "at": c.created_at.isoformat()} for c in llm],
            "approvals": [ApprovalService.serialize(a) for a in approvals],
            "children": [task_payload(c) for c in children],
        }


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: uuid.UUID, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    return {"cancelled": await app.tasks.cancel(task_id, user_id=p.user_id)}


@router.post("/tasks/{task_id}/retry")
async def retry_task(task_id: uuid.UUID, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        t = await session.get(Task, task_id)
        if t is None or t.user_id != p.user_id:
            raise HTTPException(404, "not found")
        if t.status not in ("failed", "cancelled"):
            raise HTTPException(400, "only failed or cancelled tasks can be retried")
        t.status, t.error, t.cancel_requested, t.attempts, t.finished_at = "queued", None, False, 0, None
        await session.commit()
    await app.tasks.wake()
    return {"ok": True}


class NewTask(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    instructions: str = Field(min_length=1, max_length=20000)
    conversation_id: uuid.UUID | None = None


@router.post("/tasks")
async def create_task(body: NewTask, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    conv = body.conversation_id or (await app.conversations.primary(p.user_id)).id
    t = await app.tasks.create(user_id=p.user_id, kind="background", title=body.title, conversation_id=conv,
                               channel="web", priority=150, input={"prompt": body.instructions, "agent": "jarvis"})
    return task_payload(t)


@router.get("/approvals")
async def approvals(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    return {"approvals": [ApprovalService.serialize(a) for a in await app.approvals.pending(p.user_id)]}


class Decision(BaseModel):
    approve: bool
    always: bool = False
    reason: str | None = Field(None, max_length=1000)


@router.post("/approvals/{approval_id}")
async def decide(approval_id: uuid.UUID, body: Decision, p: Principal = Depends(current),
                 app: AppContext = Depends(get_app)) -> dict:
    try:
        a = await app.approvals.decide(approval_id, user_id=p.user_id, approve=body.approve, via="web",
                                       elevated=p.elevated, always=body.always, reason=body.reason)
    except ApprovalError as exc:
        status = {"not_found": 404, "elevation_required": 428, "wrong_channel": 403}.get(exc.code, 409)
        raise HTTPException(status, {"code": exc.code, "message": str(exc)}) from exc
    return ApprovalService.serialize(a)
