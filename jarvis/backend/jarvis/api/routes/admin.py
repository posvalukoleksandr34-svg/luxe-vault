"""Owner console: accounts, plans, usage, feature flags, maintenance mode, support inbox, system health."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update

from jarvis.api.deps import Principal, get_app, require_owner
from jarvis.api.routes.auth import EMAIL, create_user
from jarvis.billing.service import FLAGS, period
from jarvis.core.audit import audit
from jarvis.core.container import AppContext
from jarvis.core.version import version_info
from jarvis.db.base import utcnow
from jarvis.db.models import AuthSession, LLMCall, Subscription, SupportReport, Task, UsageCounter, User

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/overview")
async def overview(p: Principal = Depends(require_owner), app: AppContext = Depends(get_app)) -> dict:
    month = period()
    async with app.sessionmaker() as session:
        users = (await session.execute(select(func.count()).select_from(User))).scalar_one()
        active = (await session.execute(select(func.count(func.distinct(UsageCounter.user_id))).where(
            UsageCounter.period == month, UsageCounter.metric == "messages"))).scalar_one()
        by_plan = dict((await session.execute(select(Subscription.plan, func.count()).where(
            Subscription.status.in_(["active", "trialing", "past_due", "manual"])).group_by(Subscription.plan))).all())
        events = dict((await session.execute(select(UsageCounter.metric, func.sum(UsageCounter.value)).where(
            UsageCounter.period == month).group_by(UsageCounter.metric))).all())
        spend = (await session.execute(select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(
            func.to_char(LLMCall.created_at, "YYYY-MM") == month))).scalar_one()
        errors = (await session.execute(select(func.count()).select_from(Task).where(
            Task.status == "failed", func.to_char(Task.created_at, "YYYY-MM") == month))).scalar_one()
        open_reports = (await session.execute(select(func.count()).select_from(SupportReport).where(
            SupportReport.status == "open"))).scalar_one()
    return {"version": await version_info(app), "users": users, "active_this_month": active,
            "subscriptions": by_plan, "usage_this_month": events, "llm_spend_month_usd": round(float(spend), 4),
            "failed_tasks_month": errors, "open_support_reports": open_reports,
            "signup_mode": app.settings.signup_mode, "maintenance": await app.billing.maintenance(),
            "flags": await app.billing.flags(), "flag_labels": FLAGS,
            "plans": {k: v.public() | {"hidden": v.hidden} for k, v in app.billing.catalog.plans.items()}}


@router.get("/users")
async def users(q: str | None = None, limit: int = 100, p: Principal = Depends(require_owner),
                app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        stmt = select(User).order_by(User.created_at.desc()).limit(min(limit, 500))
        if q:
            stmt = stmt.where(User.email.ilike(f"%{q}%"))
        rows = (await session.execute(stmt)).scalars().all()
        subs = {s.user_id: s for s in (await session.execute(select(Subscription).where(
            Subscription.user_id.in_([u.id for u in rows])))).scalars()}
    out = []
    for u in rows:
        plan = await app.billing.plan(u.id)
        sub = subs.get(u.id)
        usage = await app.billing.usage(u.id)
        out.append({"id": str(u.id), "email": u.email, "name": u.display_name, "is_owner": u.is_owner,
                    "created_at": u.created_at.isoformat(), "email_verified": bool(u.email_verified_at),
                    "disabled": u.disabled_at is not None, "plan": plan.id,
                    "subscription": {"plan": sub.plan, "status": sub.status, "provider": sub.provider} if sub else None,
                    "usage": {k: v["used"] for k, v in usage["metrics"].items()}})
    return {"users": out}


class NewUser(BaseModel):
    email: str = Field(pattern=EMAIL, max_length=320)
    password: str = Field(min_length=10, max_length=200)
    name: str = Field("", max_length=200)
    plan: str | None = None


@router.post("/users")
async def create(body: NewUser, p: Principal = Depends(require_owner), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        if (await session.execute(select(User.id).where(User.email == body.email.lower()))).scalar_one_or_none():
            raise HTTPException(409, "e-mail already registered")
    user = await create_user(app, email=body.email, password=body.password, name=body.name or body.email.split("@")[0],
                             timezone=p.user.timezone, owner=False, verified=True)
    if body.plan:
        await _set_plan(app, p, user.id, body.plan)
    return {"id": str(user.id)}


class UserPatch(BaseModel):
    plan: str | None = None  # manual plan ("" = back to default / paid subscription)
    disabled: bool | None = None
    email_verified: bool | None = None


async def _set_plan(app: AppContext, p: Principal, user_id: uuid.UUID, plan: str) -> None:
    if plan and plan not in app.billing.catalog.plans:
        raise HTTPException(400, "unknown plan")
    async with app.sessionmaker() as session:
        sub = (await session.execute(select(Subscription).where(Subscription.user_id == user_id))).scalar_one_or_none()
        if sub is not None and sub.provider == "stripe" and sub.status in ("active", "trialing", "past_due"):
            raise HTTPException(409, "this account has a paid Stripe subscription — change it in Stripe")
        if not plan:
            if sub is not None:
                await session.delete(sub)
        elif sub is None:
            session.add(Subscription(user_id=user_id, plan=plan, status="manual", provider="manual"))
        else:
            sub.plan, sub.status, sub.provider = plan, "manual", "manual"
        await audit(session, action="admin.plan_set", actor="user", user_id=p.user_id, target=str(user_id),
                    data={"plan": plan or None})
        await session.commit()
    app.billing.invalidate(user_id)


@router.patch("/users/{user_id}")
async def patch_user(user_id: uuid.UUID, body: UserPatch, p: Principal = Depends(require_owner),
                     app: AppContext = Depends(get_app)) -> dict:
    if user_id == p.user_id and body.disabled:
        raise HTTPException(400, "you cannot disable your own account")
    async with app.sessionmaker() as session:
        user = await session.get(User, user_id)
        if user is None:
            raise HTTPException(404, "not found")
        if user.is_owner and body.plan is not None:
            raise HTTPException(400, "the owner always has the owner plan")
        if body.disabled is not None:
            user.disabled_at = utcnow() if body.disabled else None
            if body.disabled:  # sign out everywhere now
                await session.execute(update(AuthSession).where(AuthSession.user_id == user_id,
                                                                AuthSession.revoked_at.is_(None)).values(revoked_at=utcnow()))
        if body.email_verified is not None:
            user.email_verified_at = utcnow() if body.email_verified else None
        await audit(session, action="admin.user_updated", actor="user", user_id=p.user_id, target=str(user_id),
                    data=body.model_dump(exclude_none=True))
        await session.commit()
    if body.plan is not None:
        await _set_plan(app, p, user_id, body.plan)
    app.billing.invalidate(user_id)
    return {"ok": True}


class FlagsIn(BaseModel):
    flags: dict[str, bool]


@router.put("/flags")
async def set_flags(body: FlagsIn, p: Principal = Depends(require_owner), app: AppContext = Depends(get_app)) -> dict:
    flags = await app.billing.set_flags(body.flags)
    async with app.sessionmaker() as session:
        await audit(session, action="admin.flags_set", actor="user", user_id=p.user_id, data=body.flags)
        await session.commit()
    return {"flags": flags}


class MaintenanceIn(BaseModel):
    enabled: bool
    message: str = Field("", max_length=500)


@router.put("/maintenance")
async def set_maintenance(body: MaintenanceIn, p: Principal = Depends(require_owner),
                          app: AppContext = Depends(get_app)) -> dict:
    m = await app.billing.set_maintenance(body.enabled, body.message)
    async with app.sessionmaker() as session:
        await audit(session, action="admin.maintenance", actor="user", user_id=p.user_id, data=m)
        await session.commit()
    return m


@router.get("/support")
async def support_inbox(status: Literal["open", "resolved", "all"] = "open", p: Principal = Depends(require_owner),
                        app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        stmt = select(SupportReport, User.email).outerjoin(User, User.id == SupportReport.user_id)\
            .order_by(SupportReport.created_at.desc()).limit(200)
        if status != "all":
            stmt = stmt.where(SupportReport.status == status)
        rows = (await session.execute(stmt)).all()
    return {"reports": [{"id": str(r.id), "kind": r.kind, "message": r.message, "context": r.context,
                         "status": r.status, "email": email, "created_at": r.created_at.isoformat()}
                        for r, email in rows]}


class ReportPatch(BaseModel):
    status: Literal["open", "resolved"]


@router.patch("/support/{report_id}")
async def patch_report(report_id: uuid.UUID, body: ReportPatch, p: Principal = Depends(require_owner),
                       app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        row = await session.get(SupportReport, report_id)
        if row is None:
            raise HTTPException(404, "not found")
        row.status = body.status
        await session.commit()
    return {"ok": True}
