"""Agent runtime — turns a language model into an agent.

    request ─► context ─► model ─┬─► text ─────────────────────────────► final answer
                                 └─► tool calls ─► policy ─┬─ autonomous ─► execute ─┐
                                                           ├─ confirm/restricted ─► approval ─► pause
                                                           └─ forbidden ─► refusal result ─┐
                                   ◄──────────── tool results (one message) ◄──────────────┘

Production properties:
- **Durable**: state (messages, step, trace, pending approvals) is checkpointed after every
  model call and every tool batch. A crashed or restarted worker resumes from the checkpoint.
- **Idempotent tools**: each call is keyed by the model's tool_use_id; completed calls are
  never re-executed on resume.
- **Human-in-the-loop**: confirm/restricted calls park the task in `waiting_approval`; the
  decision (from any channel) re-queues it and execution continues where it stopped.
- **Bounded**: max steps per task, tool timeouts/retries, daily cost budget, cancellation
  checked between steps and enforced mid-stream by the worker.
- **Observable**: status events (never chain-of-thought), audit log, per-call cost/latency.
- **Append-only transcript** within a turn: model output is replayed byte-for-byte
  (thinking/server-tool blocks included), as the API requires for tool loops.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from jarvis.agent.context import ContextAssembler
from jarvis.agent.profiles import AgentProfile, get_profile
from jarvis.core.audit import audit
from jarvis.core.logging import log
from jarvis.db.base import utcnow
from jarvis.db.models import Approval, Conversation, Message, Task, ToolCall, User
from jarvis.llm.types import LLMError, LLMRequest
from jarvis.tools.base import Tier, ToolContext, ToolSpec

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

STATE_VERSION = 1
_TAINT_SERVER_BLOCKS = {"web_search_tool_result", "web_fetch_tool_result"}


@dataclass
class RunOutcome:
    status: str  # done | waiting_approval | cancelled
    text: str = ""
    message_id: str | None = None


class AgentRuntime:
    def __init__(self, app: "AppContext"):
        self.app = app
        self.context = ContextAssembler(app)

    # ======================================================================== entry points

    async def run_task(self, task: Task) -> RunOutcome:
        """Run (or resume) a queued agent task: agent_turn, background, automation prompt."""
        async with self.app.sessionmaker() as session:
            user = await session.get(User, task.user_id)
            conversation = await session.get(Conversation, task.conversation_id) if task.conversation_id else None
        if user is None:
            raise LLMError("task owner no longer exists")
        # Skill on/off and settings are changed through the API process; a separate worker picks them up here.
        await self.app.skills.refresh_state()
        profile = get_profile(task.input.get("agent"))
        state = dict(task.state or {})
        if state.get("v") != STATE_VERSION:
            state = await self._init_state(task, user, conversation, profile)
            await self.app.tasks.checkpoint(task.id, state)
        return await self._loop(task, user, conversation, profile, state)

    async def run_subagent(self, parent: ToolContext, agent: str, instructions: str) -> dict[str, Any]:
        """Run a specialist inline for a parent tool call and return its final answer."""
        profile = get_profile(agent)
        if not profile.subagent:
            raise ValueError(f"unknown sub-agent {agent!r}")
        if parent.depth >= 2:
            raise ValueError("sub-agent nesting limit reached")
        async with self.app.sessionmaker() as session:
            user = await session.get(User, parent.user_id)
            child = Task(
                user_id=parent.user_id, conversation_id=parent.conversation_id, parent_id=parent.task_id,
                kind="subagent", status="running", title=f"{profile.title}: {instructions[:120]}",
                channel=parent.channel, input={"agent": agent, "prompt": instructions}, state={},
                started_at=utcnow(), attempts=1,
            )
            session.add(child)
            await session.commit()
        await self.app.tasks.event(child, "task.updated", {"status": "running", "kind": "subagent",
                                                           "title": child.title}, persist=False)
        state = await self._init_state(child, user, None, profile)
        try:
            outcome = await self._loop(child, user, None, profile, state, depth=parent.depth + 1)
        except Exception as exc:
            await self.app.tasks.fail(child.id, f"{type(exc).__name__}: {exc}")
            raise
        await self.app.tasks.complete(child.id, {"text": outcome.text})
        return {"agent": agent, "task_id": str(child.id), "report": outcome.text}

    # ======================================================================== state

    async def _init_state(self, task: Task, user: User, conversation: Conversation | None,
                          profile: AgentProfile) -> dict[str, Any]:
        inp = task.input or {}
        text = inp.get("text") or inp.get("prompt") or ""
        interactive = task.kind == "agent_turn"
        route = inp.get("route") or ("voice" if task.channel == "voice" else
                                     "deep" if task.kind == "background" else profile.route)
        turn = await self.context.build(
            profile=profile, user=user, conversation=conversation, user_content=text,
            channel=task.channel if interactive else ("automation" if task.kind == "automation_run" else task.channel),
            attachments=inp.get("attachments"), exclude_message_id=_uuid(inp.get("message_id")),
            include_history=interactive, task=task,
        )
        return {
            "v": STATE_VERSION, "profile": profile.name, "route": route, "system": turn.system,
            "messages": turn.messages, "step": 0, "tainted": False, "texts": [], "trace": [],
            "pending": None, "recalled": turn.recalled_ids, "skills": turn.skill_hints,
        }

    # ======================================================================== the loop

    async def _loop(self, task: Task, user: User, conversation: Conversation | None, profile: AgentProfile,
                    state: dict[str, Any], *, depth: int = 0) -> RunOutcome:
        interactive = not profile.subagent
        max_steps = min(profile.max_steps, self.app.settings.max_agent_steps) if interactive else profile.max_steps
        rules = await self._rules(user.id, task.channel)
        availability = await self.app.availability(user.id)
        route = self.app.router.route(state["route"])
        server_tools = self.app.server_tools(route, profile)
        hidden = {t["name"] for t in server_tools}  # provider-hosted variants replace client tools
        specs = self._tool_specs(profile, availability, rules, bool(state.get("tainted")), hidden)
        spec_by_name = {s.name: s for s in specs}
        model_tools = self.app.registry.model_tools(specs) + server_tools

        try:
            while True:
                if await self.app.tasks.is_cancelled(task.id):
                    return await self._finish_cancelled(task, conversation, state)

                if state.get("pending"):
                    resumed = await self._resume_pending(task, user, state, spec_by_name, depth)
                    if not resumed:
                        return await self._pause(task, state)
                    await self.app.tasks.checkpoint(task.id, state)
                    continue

                if state["step"] >= max_steps:
                    state["texts"].append(
                        "Я остановился: достигнут лимит шагов для одной задачи. Скажи «продолжай», если нужно "
                        "довести дело до конца.")
                    break

                await self._status(task, "thinking", "Думаю…" if state["step"] == 0 else "Анализирую результаты…")
                try:
                    resp = await self.app.router.generate(
                        state["route"],
                        LLMRequest(system=state["system"], messages=state["messages"], tools=model_tools),
                        on_text=self._text_streamer(task) if interactive else None,
                        task_id=task.id, user_id=user.id,
                    )
                except LLMError as exc:
                    if exc.retryable:
                        raise  # the worker retries the task with backoff, resuming from the checkpoint
                    state["texts"].append(f"⚠️ Не могу обратиться к модели: {exc}")
                    state["error"] = str(exc)
                    break
                await self.app.tasks.add_usage(task.id, cost=resp.cost_usd, input_tokens=resp.usage.input_tokens,
                                               output_tokens=resp.usage.output_tokens)
                state["messages"].append({"role": "assistant", "content": resp.content})
                state["step"] += 1
                text = resp.text.strip()
                if text:
                    state["texts"].append(text)
                if any(b.get("type") in _TAINT_SERVER_BLOCKS for b in resp.content):
                    state["tainted"] = True
                for b in resp.content:
                    if b.get("type") == "server_tool_use":
                        state["trace"].append({"id": None, "name": b.get("name"), "server": True,
                                               "input": b.get("input"), "ok": True})
                await self.app.tasks.checkpoint(task.id, state)

                if resp.stop_reason == "refusal":
                    cat = (resp.stop_details or {}).get("category")
                    state["texts"].append("Я не могу выполнить этот запрос." + (f" (категория: {cat})" if cat else ""))
                    break
                if resp.stop_reason == "pause_turn":
                    continue
                tool_uses = resp.tool_uses
                if not tool_uses:
                    break
                if resp.stop_reason == "max_tokens":
                    state["messages"].append({"role": "user", "content": [
                        {"type": "tool_result", "tool_use_id": tu["id"], "is_error": True,
                         "content": "Tool input was truncated (output limit). Retry with a smaller input."}
                        for tu in tool_uses]})
                    continue

                results = await self._run_tools(task, user, state, tool_uses, spec_by_name, depth)
                if state.get("pending"):
                    return await self._pause(task, state)
                state["messages"].append({"role": "user", "content": results})
                if state.get("tainted_now"):
                    state.pop("tainted_now")
                    specs = self._tool_specs(profile, availability, rules, True, hidden)
                    spec_by_name = {s.name: s for s in specs}
                await self.app.tasks.checkpoint(task.id, state)
        except asyncio.CancelledError:
            if await self.app.tasks.is_cancelled(task.id):
                await self._finish_cancelled(task, conversation, state)
            raise

        return await self._finish(task, user, conversation, state, interactive=interactive)

    # ======================================================================== tools

    def _tool_specs(self, profile: AgentProfile, availability: dict[str, bool], rules: dict[str, Tier],
                    tainted: bool, hidden: set[str]) -> list[ToolSpec]:
        def ok(spec: ToolSpec) -> bool:
            if any(not availability.get(req, False) for req in spec.requires):
                return False
            if spec.name in hidden:
                return False
            decision = self.app.policy.decide(spec, rules=rules, tainted=tainted)
            if decision.tier == Tier.FORBIDDEN:
                return False
            return True

        specs = self.app.registry.available(is_available=ok, only=set(profile.tools) if profile.tools else None)
        if profile.subagent:
            specs = [s for s in specs if s.name not in ("agent_delegate", "task_spawn_background")]
        return specs

    async def _rules(self, user_id: uuid.UUID, channel: str) -> dict[str, Tier]:
        async with self.app.sessionmaker() as session:
            return await self.app.policy.user_rules(session, user_id, channel)

    def _tool_context(self, task: Task, user: User, tool_use_id: str, depth: int) -> ToolContext:
        async def emit(type_: str, data: dict[str, Any]) -> None:
            await self.app.tasks.event(task, type_, {**data, "tool_use_id": tool_use_id}, persist=False)

        return ToolContext(app=self.app, user_id=user.id, task_id=task.id, conversation_id=task.conversation_id,
                           channel=task.channel, timezone=user.timezone, trace_id=task.trace_id, depth=depth,
                           tool_use_id=tool_use_id, emit=emit)

    async def _run_tools(self, task: Task, user: User, state: dict[str, Any], tool_uses: list[dict[str, Any]],
                         spec_by_name: dict[str, ToolSpec], depth: int) -> list[dict[str, Any]]:
        rules = await self._rules(user.id, task.channel)
        results: dict[str, dict[str, Any]] = {}
        runnable: list[tuple[dict, ToolSpec]] = []
        pending: list[str] = []
        profile = get_profile(state.get("profile"))

        for tu in tool_uses:
            spec = spec_by_name.get(tu["name"]) or self.app.registry.get(tu["name"])
            if spec is None:
                results[tu["id"]] = _result(tu["id"], f"Error: unknown tool {tu['name']!r}", error=True)
                continue
            prior = await self._prior_call(tu["id"])
            if prior is not None and prior.status in ("succeeded", "failed", "denied"):
                results[tu["id"]] = _result(tu["id"], (prior.output or {}).get("content", ""),
                                            error=prior.status != "succeeded")
                continue
            decision = self.app.policy.decide(spec, rules=rules, tainted=bool(state.get("tainted")))
            if decision.tier == Tier.FORBIDDEN:
                await self._record_call(task, tu, spec, decision.tier, "denied", "Forbidden by policy.")
                results[tu["id"]] = _result(tu["id"], "Error: this action is forbidden by the user's policy.",
                                            error=True)
            elif decision.tier == Tier.AUTONOMOUS:
                runnable.append((tu, spec))
            elif profile.subagent:
                results[tu["id"]] = _result(
                    tu["id"], "This action requires the user's approval, which sub-agents cannot request. "
                              "Describe what should be done in your final report instead.", error=True)
            else:
                await self._record_call(task, tu, spec, decision.tier, "awaiting_approval", None)
                approval = await self.app.approvals.request(task, tool_use_id=tu["id"], spec=spec,
                                                            args=tu.get("input") or {}, decision=decision)
                pending.append(tu["id"])
                await self._status(task, "waiting_approval", f"Жду подтверждения: {approval.summary}")
                await self.app.channels.deliver_approval(task, approval)

        # parallel-safe tools run concurrently, the rest in order
        parallel = [(tu, s) for tu, s in runnable if s.parallel_safe]
        serial = [(tu, s) for tu, s in runnable if not s.parallel_safe]
        if parallel:
            outs = await asyncio.gather(*(self._execute(task, user, tu, s, state, depth) for tu, s in parallel))
            for (tu, _), res in zip(parallel, outs):
                results[tu["id"]] = res
        for tu, s in serial:
            results[tu["id"]] = await self._execute(task, user, tu, s, state, depth)

        if pending:
            state["pending"] = {"tool_uses": tool_uses, "results": results}
            return []
        return [results[tu["id"]] for tu in tool_uses]

    async def _resume_pending(self, task: Task, user: User, state: dict[str, Any],
                              spec_by_name: dict[str, ToolSpec], depth: int) -> bool:
        pending = state["pending"]
        results: dict[str, dict[str, Any]] = pending["results"]
        async with self.app.sessionmaker() as session:
            approvals = {a.tool_use_id: a for a in (await session.execute(
                select(Approval).where(Approval.task_id == task.id))).scalars()}
        for tu in pending["tool_uses"]:
            if tu["id"] in results:
                continue
            approval = approvals.get(tu["id"])
            spec = spec_by_name.get(tu["name"]) or self.app.registry.get(tu["name"])
            if approval is None or spec is None:
                results[tu["id"]] = _result(tu["id"], "Error: approval record missing; action not executed.", error=True)
                continue
            if approval.status == "pending":
                if approval.expires_at < utcnow():
                    approval.status = "expired"
                else:
                    return False
            if approval.status == "approved":
                results[tu["id"]] = await self._execute(task, user, tu, spec, state, depth)
            else:
                verdict = {"denied": "The user declined this action.",
                           "expired": "The approval request expired without an answer; the action was not executed."}
                msg = verdict.get(approval.status, "The action was not approved.")
                if approval.reason:
                    msg += f" User's note: {approval.reason}"
                await self._update_call(tu["id"], "denied", {"content": msg}, None)
                results[tu["id"]] = _result(tu["id"], msg, error=False)
                await self.app.tasks.event(task, "tool.finished", {"tool": tu["name"], "ok": False,
                                                                   "status": approval.status, "tool_use_id": tu["id"]})
        state["messages"].append({"role": "user", "content": [results[tu["id"]] for tu in pending["tool_uses"]]})
        state["pending"] = None
        return True

    async def _execute(self, task: Task, user: User, tu: dict[str, Any], spec: ToolSpec, state: dict[str, Any],
                       depth: int) -> dict[str, Any]:
        args = tu.get("input") or {}
        await self._record_call(task, tu, spec, None, "running", None)
        await self.app.tasks.event(task, "tool.started", {
            "tool": spec.name, "activity": spec.activity or spec.name, "tool_use_id": tu["id"],
            "summary": spec.describe(args)[:300]})
        await self._status(task, "tool", spec.activity or f"Выполняю {spec.name}")
        ctx = self._tool_context(task, user, tu["id"], depth)
        outcome = await self.app.executor.execute(spec, args, ctx)
        status = "succeeded" if outcome.ok else "failed"
        await self._update_call(tu["id"], status, {"content": outcome.content, "data": outcome.data}, outcome.error,
                                duration_ms=outcome.duration_ms, attempts=outcome.attempts)
        await self.app.tasks.event(task, "tool.finished", {
            "tool": spec.name, "ok": outcome.ok, "duration_ms": outcome.duration_ms, "tool_use_id": tu["id"],
            "error": outcome.error})
        if spec.untrusted_output and outcome.ok:
            state["tainted"] = True
            state["tainted_now"] = True
        state["trace"].append({"id": tu["id"], "name": spec.name, "input": args, "ok": outcome.ok,
                               "result": outcome.content[:600]})
        if spec.risk.value != "read":
            async with self.app.sessionmaker() as session:
                await audit(session, action="tool.executed", actor="agent", user_id=user.id, target=spec.name,
                            data={"ok": outcome.ok, "risk": spec.risk.value, "task_id": str(task.id),
                                  "args": args, "error": outcome.error}, trace_id=task.trace_id)
                await session.commit()
        return _result(tu["id"], outcome.content, error=not outcome.ok, images=outcome.images)

    async def _prior_call(self, tool_use_id: str) -> ToolCall | None:
        async with self.app.sessionmaker() as session:
            return (await session.execute(select(ToolCall).where(ToolCall.tool_use_id == tool_use_id))).scalar_one_or_none()

    async def _record_call(self, task: Task, tu: dict[str, Any], spec: ToolSpec, tier: Tier | None, status: str,
                           error: str | None) -> None:
        async with self.app.sessionmaker() as session:
            row = (await session.execute(select(ToolCall).where(ToolCall.tool_use_id == tu["id"]))).scalar_one_or_none()
            if row is None:
                row = ToolCall(task_id=task.id, tool_use_id=tu["id"], tool_name=spec.name, input=tu.get("input") or {},
                               risk=spec.risk.value, tier=(tier or Tier.AUTONOMOUS).value)
                session.add(row)
            row.status = status
            if tier is not None:
                row.tier = tier.value
            if error:
                row.error = error
                row.output = {"content": error}
            await session.commit()

    async def _update_call(self, tool_use_id: str, status: str, output: dict[str, Any] | None, error: str | None,
                           **fields: Any) -> None:
        async with self.app.sessionmaker() as session:
            row = (await session.execute(select(ToolCall).where(ToolCall.tool_use_id == tool_use_id))).scalar_one_or_none()
            if row is None:
                return
            row.status = status
            row.output = output
            row.error = error
            row.finished_at = utcnow()
            for k, v in fields.items():
                setattr(row, k, v)
            await session.commit()

    # ======================================================================== events & finishing

    def _text_streamer(self, task: Task):
        async def on_text(delta: str) -> None:
            await self.app.tasks.event(task, "message.delta", {"text": delta}, persist=False)

        return on_text

    async def _status(self, task: Task, state: str, label: str) -> None:
        await self.app.tasks.event(task, "agent.status", {"state": state, "label": label}, persist=False)

    async def _pause(self, task: Task, state: dict[str, Any]) -> RunOutcome:
        await self.app.tasks.pause_for_approval(task.id, state)
        return RunOutcome(status="waiting_approval")

    async def _finish_cancelled(self, task: Task, conversation: Conversation | None, state: dict[str, Any]) -> RunOutcome:
        text = "\n\n".join(state.get("texts") or [])
        note = (text + "\n\n" if text else "") + "⏹ Остановлено по запросу."
        if conversation is not None and task.kind == "agent_turn":
            await self._save_message(task, conversation, note, state, meta={"cancelled": True})
        await self._status(task, "cancelled", "Остановлено")
        return RunOutcome(status="cancelled", text=note)

    async def _finish(self, task: Task, user: User, conversation: Conversation | None, state: dict[str, Any], *,
                      interactive: bool) -> RunOutcome:
        text = "\n\n".join(t for t in state.get("texts") or [] if t).strip() or "Готово."
        message_id = None
        if conversation is not None and task.kind in ("agent_turn", "background", "automation_run"):
            msg = await self._save_message(task, conversation, text, state)
            message_id = str(msg.id)
            if interactive:
                await self.app.channels.deliver_reply(task, msg)
            if task.kind == "agent_turn":
                await self.app.tasks.create(
                    user_id=user.id, kind="memory_extract", title="Memory extraction", channel=task.channel,
                    conversation_id=conversation.id, priority=200, max_attempts=2,
                    input={"user_text": (task.input or {}).get("text", ""), "assistant_text": text,
                           "source_ref": str(task.id)},
                )
        await self._status(task, "done", "Готово")
        return RunOutcome(status="done", text=text, message_id=message_id)

    async def _save_message(self, task: Task, conversation: Conversation, text: str, state: dict[str, Any],
                            meta: dict[str, Any] | None = None) -> Message:
        trace = [t for t in state.get("trace") or [] if t.get("id")]
        async with self.app.sessionmaker() as session:
            msg = Message(conversation_id=conversation.id, role="assistant", content=text, tool_trace=trace,
                          channel=task.channel, task_id=task.id,
                          meta={"kind": task.kind, "route": state.get("route"), **(meta or {})})
            session.add(msg)
            conv = await session.get(Conversation, conversation.id)
            if conv is not None:
                conv.updated_at = utcnow()
            await session.commit()
        await self.app.tasks.event(task, "message.completed", {"message": serialize_message(msg)}, persist=False)
        return msg


def _result(tool_use_id: str, content: str, *, error: bool,
            images: list[dict[str, str]] | None = None) -> dict[str, Any]:
    body: Any = content or "(no output)"
    if images:  # e.g. a screenshot: text + image blocks so the model can see the screen
        body = [{"type": "text", "text": body}] + [
            {"type": "image", "source": {"type": "base64", "media_type": im["media_type"], "data": im["data"]}}
            for im in images]
    block: dict[str, Any] = {"type": "tool_result", "tool_use_id": tool_use_id, "content": body}
    if error:
        block["is_error"] = True
    return block


def _uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


def serialize_message(m: Message) -> dict[str, Any]:
    return {
        "id": str(m.id), "conversation_id": str(m.conversation_id), "role": m.role, "content": m.content,
        "channel": m.channel, "task_id": str(m.task_id) if m.task_id else None,
        "tool_trace": [{"name": t.get("name"), "ok": t.get("ok", True)} for t in (m.tool_trace or [])],
        "attachments": m.attachments or [], "meta": m.meta or {},
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


log = log.bind(component="harness")
