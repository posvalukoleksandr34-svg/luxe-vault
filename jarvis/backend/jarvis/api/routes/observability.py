"""Logs, audit trail and dashboard statistics: what JARVIS did, with which tools, how long, how much."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import Integer, and_, case, cast, func, select

from jarvis.api.deps import Principal, current, get_app
from jarvis.core.audit import verify_chain
from jarvis.core.container import AppContext
from jarvis.db.models import AuditLog, LLMCall, Memory, Task, ToolCall

router = APIRouter(prefix="/api", tags=["observability"])


@router.get("/logs/audit")
async def audit_log(limit: int = 100, before_id: int | None = None, action: str | None = None,
                    p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        stmt = select(AuditLog).where(AuditLog.user_id == p.user_id)
        if before_id:
            stmt = stmt.where(AuditLog.id < before_id)
        if action:
            stmt = stmt.where(AuditLog.action.like(f"{action}%"))
        rows = (await session.execute(stmt.order_by(AuditLog.id.desc()).limit(min(limit, 500)))).scalars()
        return {"entries": [{"id": r.id, "ts": r.ts.isoformat(), "actor": r.actor, "action": r.action,
                             "target": r.target, "data": r.data, "hash": r.hash[:12]} for r in rows]}


@router.get("/logs/audit/verify")
async def audit_verify(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        ok, broken = await verify_chain(session)
    return {"ok": ok, "first_broken_id": broken}


@router.get("/logs/tools")
async def tool_log(limit: int = 100, tool: str | None = None, status: str | None = None,
                   p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        stmt = select(ToolCall, Task.title).join(Task, Task.id == ToolCall.task_id).where(Task.user_id == p.user_id)
        if tool:
            stmt = stmt.where(ToolCall.tool_name == tool)
        if status:
            stmt = stmt.where(ToolCall.status == status)
        rows = (await session.execute(stmt.order_by(ToolCall.created_at.desc()).limit(min(limit, 500)))).all()
        return {"calls": [{"id": str(c.id), "task_id": str(c.task_id), "task": title, "tool": c.tool_name,
                           "status": c.status, "risk": c.risk, "tier": c.tier, "duration_ms": c.duration_ms,
                           "attempts": c.attempts, "error": c.error, "input": c.input,
                           "at": c.created_at.isoformat()} for c, title in rows]}


@router.get("/logs/llm")
async def llm_log(limit: int = 100, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        rows = (await session.execute(select(LLMCall).where(LLMCall.user_id == p.user_id)
                                      .order_by(LLMCall.created_at.desc()).limit(min(limit, 500)))).scalars()
        return {"calls": [{"id": str(c.id), "task_id": str(c.task_id) if c.task_id else None, "route": c.route,
                           "provider": c.provider, "model": c.model, "input_tokens": c.input_tokens,
                           "output_tokens": c.output_tokens, "cache_read_tokens": c.cache_read_tokens,
                           "cache_write_tokens": c.cache_write_tokens, "cost_usd": c.cost_usd,
                           "latency_ms": c.latency_ms, "status": c.status, "stop_reason": c.stop_reason,
                           "error": c.error, "at": c.created_at.isoformat()} for c in rows]}


@router.get("/stats")
async def stats(days: int = 7, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=max(1, min(days, 90)))
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    async with app.sessionmaker() as session:
        llm = (await session.execute(select(
            func.count(), func.coalesce(func.sum(LLMCall.cost_usd), 0.0),
            func.coalesce(func.sum(LLMCall.input_tokens), 0), func.coalesce(func.sum(LLMCall.output_tokens), 0),
            func.coalesce(func.sum(LLMCall.cache_read_tokens), 0),
            func.percentile_cont(0.5).within_group(LLMCall.latency_ms),
            func.percentile_cont(0.95).within_group(LLMCall.latency_ms),
            func.coalesce(func.sum(cast(LLMCall.status == "error", Integer)), 0),
        ).where(LLMCall.user_id == p.user_id, LLMCall.created_at >= since))).one()
        cost_today = (await session.execute(select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(
            LLMCall.user_id == p.user_id, LLMCall.created_at >= today))).scalar_one()
        by_model = (await session.execute(select(LLMCall.model, func.count(), func.sum(LLMCall.cost_usd))
                                          .where(LLMCall.user_id == p.user_id, LLMCall.created_at >= since)
                                          .group_by(LLMCall.model))).all()
        daily = (await session.execute(select(
            func.date_trunc("day", LLMCall.created_at).label("d"), func.sum(LLMCall.cost_usd), func.count())
            .where(LLMCall.user_id == p.user_id, LLMCall.created_at >= since).group_by("d").order_by("d"))).all()
        tools = (await session.execute(select(
            ToolCall.tool_name, func.count(), func.sum(cast(ToolCall.status == "failed", Integer)),
            func.avg(ToolCall.duration_ms))
            .join(Task, Task.id == ToolCall.task_id)
            .where(Task.user_id == p.user_id, ToolCall.created_at >= since)
            .group_by(ToolCall.tool_name).order_by(func.count().desc()).limit(20))).all()
        tasks = (await session.execute(select(Task.status, func.count()).where(
            Task.user_id == p.user_id, Task.created_at >= since, Task.kind != "memory_extract")
            .group_by(Task.status))).all()
        active = (await session.execute(select(func.count()).where(
            Task.user_id == p.user_id, Task.status.in_(["queued", "running", "waiting_approval"]),
            Task.kind != "memory_extract"))).scalar_one()
        memories = (await session.execute(select(Memory.kind, func.count()).where(
            Memory.user_id == p.user_id, Memory.status == "active").group_by(Memory.kind))).all()
        cache_ratio = (await session.execute(select(
            func.coalesce(func.sum(LLMCall.cache_read_tokens), 0),
            func.coalesce(func.sum(LLMCall.input_tokens + LLMCall.cache_read_tokens + LLMCall.cache_write_tokens), 0))
            .where(and_(LLMCall.user_id == p.user_id, LLMCall.created_at >= since)))).one()
    calls = llm[0] or 0
    return {
        "period_days": days,
        "llm": {"calls": calls, "cost_usd": round(llm[1], 4), "cost_today_usd": round(cost_today, 4),
                "input_tokens": llm[2], "output_tokens": llm[3], "cache_read_tokens": llm[4],
                "latency_p50_ms": int(llm[5] or 0), "latency_p95_ms": int(llm[6] or 0),
                "error_rate": round((llm[7] or 0) / calls, 4) if calls else 0.0,
                "cache_hit_ratio": round(cache_ratio[0] / cache_ratio[1], 3) if cache_ratio[1] else 0.0,
                "daily_limit_usd": app.settings.daily_cost_limit_usd,
                "by_model": [{"model": m, "calls": c, "cost_usd": round(s or 0, 4)} for m, c, s in by_model],
                "daily": [{"day": d.date().isoformat(), "cost_usd": round(s or 0, 4), "calls": c} for d, s, c in daily]},
        "tools": [{"tool": t, "calls": c, "failures": int(f or 0), "avg_ms": int(a or 0),
                   "failure_rate": round((f or 0) / c, 3) if c else 0} for t, c, f, a in tools],
        "tasks": {s: c for s, c in tasks}, "active_tasks": active,
        "memories": {k: c for k, c in memories},
    }


_ = case  # keep import for SQL expressions in future panels
