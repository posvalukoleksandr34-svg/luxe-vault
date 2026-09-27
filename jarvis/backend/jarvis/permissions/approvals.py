"""Approval workflow: "Я готов выполнить действие. Подтвердить?"

The harness persists a pending approval and parks the task in
`waiting_approval`. The decision can arrive from any channel allowed for the
tier (web, Telegram/WhatsApp buttons, voice "да"). RESTRICTED actions need a
web session that re-authenticated recently (password or TOTP). When every
approval of a task is decided, the task is re-queued and resumes exactly where
it stopped — also after a restart.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from jarvis.core.audit import audit
from jarvis.core.events import EventBus, make_event
from jarvis.core.metrics import APPROVALS
from jarvis.db.base import utcnow
from jarvis.db.models import Approval, PermissionRule, Task
from jarvis.permissions.policy import Decision, PolicyEngine
from jarvis.tasks.engine import TaskService
from jarvis.tools.base import Risk, Tier, ToolSpec


class ApprovalError(Exception):
    def __init__(self, message: str, code: str = "invalid"):
        super().__init__(message)
        self.code = code


class ApprovalService:
    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession], tasks: TaskService, bus: EventBus,
                 policy: PolicyEngine, *, ttl_hours: int = 24):
        self.sessionmaker = sessionmaker
        self.tasks = tasks
        self.bus = bus
        self.policy = policy
        self.ttl = timedelta(hours=ttl_hours)

    async def request(self, task: Task, *, tool_use_id: str, spec: ToolSpec, args: dict[str, Any],
                      decision: Decision) -> Approval:
        async with self.sessionmaker() as session:
            existing = (await session.execute(
                select(Approval).where(Approval.tool_use_id == tool_use_id)
            )).scalar_one_or_none()
            if existing is not None:
                return existing
            approval = Approval(
                user_id=task.user_id, task_id=task.id, tool_use_id=tool_use_id, tool_name=spec.name,
                arguments=args, summary=spec.describe(args), risk=spec.risk.value, tier=decision.tier.value,
                channel=task.channel, expires_at=utcnow() + self.ttl,
            )
            session.add(approval)
            await audit(session, action="approval.requested", actor="agent", user_id=task.user_id,
                        target=spec.name, data={"approval_id": str(approval.id), "tier": decision.tier.value,
                                                "reason": decision.reason}, trace_id=task.trace_id)
            await session.commit()
        await self.bus.publish(task.user_id, make_event(
            "approval.requested", task_id=str(task.id),
            conversation_id=str(task.conversation_id) if task.conversation_id else None,
            data=self.serialize(approval)))
        return approval

    @staticmethod
    def serialize(a: Approval) -> dict[str, Any]:
        return {
            "id": str(a.id), "task_id": str(a.task_id), "tool": a.tool_name, "summary": a.summary,
            "arguments": a.arguments, "risk": a.risk, "tier": a.tier, "status": a.status,
            "channel": a.channel, "expires_at": a.expires_at.isoformat(),
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "decided_via": a.decided_via,
        }

    async def decide(self, approval_id: uuid.UUID, *, user_id: uuid.UUID, approve: bool, via: str,
                     elevated: bool = False, always: bool = False, reason: str | None = None) -> Approval:
        async with self.sessionmaker() as session:
            approval = await session.get(Approval, approval_id, with_for_update=True)
            if approval is None or approval.user_id != user_id:
                raise ApprovalError("approval not found", "not_found")
            if approval.status != "pending":
                raise ApprovalError(f"approval already {approval.status}", "already_decided")
            if approval.expires_at < utcnow():
                approval.status = "expired"
                await session.commit()
                raise ApprovalError("approval expired", "expired")
            tier = Tier(approval.tier)
            if approve and not self.policy.channel_can_approve(via, tier):
                raise ApprovalError(
                    f"{tier.value} actions cannot be approved via {via}; open the JARVIS web app", "wrong_channel")
            if approve and tier == Tier.RESTRICTED and not elevated:
                raise ApprovalError("re-enter your password or TOTP code to approve a restricted action",
                                    "elevation_required")
            approval.status = "approved" if approve else "denied"
            approval.decided_via = via
            approval.decided_at = utcnow()
            approval.reason = reason
            if (approve and always and tier == Tier.CONFIRM and self.policy.config.allow_always
                    and approval.risk != Risk.HIGH.value):
                exists = (await session.execute(select(PermissionRule).where(
                    PermissionRule.user_id == user_id, PermissionRule.target == approval.tool_name,
                    PermissionRule.channel == "*"))).scalar_one_or_none()
                if exists is None:
                    session.add(PermissionRule(user_id=user_id, target=approval.tool_name, channel="*",
                                               tier=Tier.AUTONOMOUS.value, note="approved with 'always allow'"))
                else:
                    exists.tier = Tier.AUTONOMOUS.value
            await audit(session, action=f"approval.{approval.status}", actor=f"user:{via}", user_id=user_id,
                        target=approval.tool_name, data={"approval_id": str(approval.id), "always": always})
            await session.commit()
            remaining = (await session.execute(
                select(func.count()).select_from(Approval).where(
                    Approval.task_id == approval.task_id, Approval.status == "pending")
            )).scalar_one()
        APPROVALS.labels(approval.tier, approval.status).inc()
        await self.bus.publish(user_id, make_event("approval.resolved", task_id=str(approval.task_id),
                                                   data=self.serialize(approval)))
        if remaining == 0:
            await self.tasks.resume(approval.task_id)
        return approval

    async def pending(self, user_id: uuid.UUID) -> list[Approval]:
        async with self.sessionmaker() as session:
            rows = (await session.execute(
                select(Approval).where(Approval.user_id == user_id, Approval.status == "pending",
                                       Approval.expires_at > utcnow()).order_by(Approval.created_at)
            )).scalars()
            return list(rows)

    async def for_task(self, task_id: uuid.UUID) -> list[Approval]:
        async with self.sessionmaker() as session:
            return list((await session.execute(
                select(Approval).where(Approval.task_id == task_id).order_by(Approval.created_at)
            )).scalars())

    async def expire_stale(self) -> int:
        async with self.sessionmaker() as session:
            rows = list((await session.execute(
                select(Approval).where(Approval.status == "pending", Approval.expires_at < utcnow())
            )).scalars())
            if not rows:
                return 0
            await session.execute(update(Approval).where(Approval.id.in_([r.id for r in rows])).values(status="expired"))
            await session.commit()
        for task_id in {r.task_id for r in rows}:
            await self.tasks.resume(task_id)  # the harness reports the expiry to the model as a denial
        return len(rows)
