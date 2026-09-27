"""Conversation → long-term memory pipeline (runs in the background after each turn).

    turn text ─► extract (fast model, JSON schema) ─► importance filter
             ─► neighbours lookup ─► reconcile (ADD / UPDATE / SUPERSEDE / SKIP) ─► store + embed

Only durable facts survive: preferences, biography, people, projects, commitments.
Small talk, one-off requests and anything the assistant merely said are dropped.
"""

from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any

from jarvis.core.logging import log
from jarvis.db.models import MEMORY_KINDS, Memory
from jarvis.llm.types import LLMError, LLMRequest

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.llm.router import ModelRouter
    from jarvis.memory.store import MemoryStore

EXTRACT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "memories": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "content": {"type": "string"},
                    "kind": {"type": "string", "enum": list(MEMORY_KINDS)},
                    "subject": {"type": "string"},
                    "importance": {"type": "number"},
                },
                "required": ["content", "kind", "subject", "importance"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["memories"],
    "additionalProperties": False,
}

RECONCILE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "action": {"type": "string", "enum": ["add", "update", "supersede", "skip"]},
                    "target_id": {"type": "string"},
                    "merged_content": {"type": "string"},
                },
                "required": ["index", "action", "target_id", "merged_content"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["decisions"],
    "additionalProperties": False,
}

EXTRACT_PROMPT = """You maintain the long-term memory of a personal assistant called JARVIS.
From the exchange below, extract facts worth remembering for months: the user's preferences,
biography, habits, goals, people in their life (relationship), projects, commitments and
important dates. Rules:
- Only facts stated or clearly confirmed by the USER. Ignore what the assistant proposed.
- Skip small talk, one-off requests ("remind me…", "search…") and anything already obvious.
- One fact per item, self-contained, third person, in the user's language
  (e.g. "Пользователь любит зелёный чай", "Анна — сестра пользователя, живёт в Берлине").
- kind: profile (who the user is / preferences), semantic (general facts), project, relationship,
  important (critical: allergies, IDs, deadlines), episodic (a notable event with its date).
- subject: the person/project/topic the fact is about ("user" for the user themselves).
- importance 0..1: 0.3 trivia, 0.6 useful, 0.9 critical.
Return an empty list when nothing qualifies — that is the common case."""

RECONCILE_PROMPT = """You de-duplicate a memory store. For each NEW fact decide against its EXISTING neighbours:
- skip: already known (same meaning)
- update: same topic, the new fact adds detail → merged_content = one combined fact, target_id = neighbour id
- supersede: the new fact contradicts/replaces a neighbour (changed preference, moved city) →
  target_id = neighbour id, merged_content = the new fact
- add: genuinely new
Use "" for target_id / merged_content when not applicable."""


def _parse_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"):]
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start : end + 1]) if start >= 0 else {}


class MemoryExtractor:
    def __init__(self, router: "ModelRouter", store: "MemoryStore", *, min_importance: float = 0.35):
        self.router = router
        self.store = store
        self.min_importance = min_importance

    async def extract(self, user_text: str, assistant_text: str, *, user_id: uuid.UUID,
                      task_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
        exchange = f"USER: {user_text.strip()}\n\nASSISTANT: {assistant_text.strip()[:3000]}"
        try:
            resp = await self.router.generate(
                "fast",
                LLMRequest(
                    system=[{"type": "text", "text": EXTRACT_PROMPT}],
                    messages=[{"role": "user", "content": exchange}],
                    max_tokens=2000,
                    output_schema=EXTRACT_SCHEMA,
                ),
                task_id=task_id,
                user_id=user_id,
            )
            items = _parse_json(resp.text).get("memories", [])
        except (LLMError, ValueError) as exc:
            log.warning("memory.extract_failed", error=str(exc))
            return []
        out = []
        for it in items:
            try:
                imp = float(it.get("importance", 0.5))
            except (TypeError, ValueError):
                imp = 0.5
            if imp < self.min_importance or not str(it.get("content", "")).strip():
                continue
            out.append({
                "content": str(it["content"]).strip(),
                "kind": it.get("kind") if it.get("kind") in MEMORY_KINDS else "semantic",
                "subject": (it.get("subject") or None),
                "importance": max(0.0, min(1.0, imp)),
            })
        return out

    async def process_turn(self, user_text: str, assistant_text: str, *, user_id: uuid.UUID,
                           source_ref: str | None = None, task_id: uuid.UUID | None = None) -> list[Memory]:
        candidates = await self.extract(user_text, assistant_text, user_id=user_id, task_id=task_id)
        if not candidates:
            return []
        stored: list[Memory] = []
        async with self.store.sessionmaker() as session:
            neighbours: list[list[tuple[Memory, float]]] = []
            for c in candidates:
                vec = await self.store._embed_one(c["content"])
                neighbours.append(await self.store.find_similar(session, user_id, c["content"], vec=vec, limit=3))
            decisions = await self._reconcile(candidates, neighbours, user_id=user_id, task_id=task_id)
            by_id = {str(m.id): m for group in neighbours for m, _ in group}
            for i, c in enumerate(candidates):
                d = decisions.get(i, {"action": "add"})
                action = d.get("action", "add")
                target = by_id.get(d.get("target_id") or "")
                if action == "skip":
                    continue
                if action == "update" and target is not None:
                    updated = await self.store.update(
                        user_id, target.id, content=d.get("merged_content") or target.content,
                        importance=max(target.importance, c["importance"]),
                    )
                    if updated is not None:
                        stored.append(updated)
                    continue
                content = (d.get("merged_content") or c["content"]) if action == "supersede" else c["content"]
                mem, _ = await self.store.add(
                    user_id, content,
                    kind=c["kind"], subject=c["subject"], importance=c["importance"], confidence=0.75,
                    source="extracted", source_ref=source_ref, session=session,
                    dedupe=action != "supersede",
                )
                if action == "supersede" and target is not None:
                    await self.store.supersede(session, target, mem)
                await session.commit()
                stored.append(mem)
        log.info("memory.extracted", count=len(stored), user_id=str(user_id))
        return stored

    async def _reconcile(self, candidates: list[dict], neighbours: list[list[tuple[Memory, float]]], *,
                         user_id: uuid.UUID, task_id: uuid.UUID | None) -> dict[int, dict[str, Any]]:
        # Fast path: no neighbours at all → everything is new; very close neighbour → duplicate.
        decisions: dict[int, dict[str, Any]] = {}
        needs_llm = []
        for i, group in enumerate(neighbours):
            if not group or group[0][1] < 0.55:
                decisions[i] = {"action": "add"}
            elif group[0][1] >= 0.95:
                decisions[i] = {"action": "skip"}
            else:
                needs_llm.append(i)
        if not needs_llm:
            return decisions
        lines = []
        for i in needs_llm:
            lines.append(f"NEW[{i}]: {candidates[i]['content']}")
            for m, sim in neighbours[i]:
                lines.append(f"   EXISTING id={m.id} (similarity {sim:.2f}): {m.content}")
        try:
            resp = await self.router.generate(
                "fast",
                LLMRequest(
                    system=[{"type": "text", "text": RECONCILE_PROMPT}],
                    messages=[{"role": "user", "content": "\n".join(lines)}],
                    max_tokens=1500,
                    output_schema=RECONCILE_SCHEMA,
                ),
                task_id=task_id,
                user_id=user_id,
            )
            for d in _parse_json(resp.text).get("decisions", []):
                if isinstance(d.get("index"), int) and d["index"] in needs_llm:
                    decisions[d["index"]] = d
        except (LLMError, ValueError) as exc:
            log.warning("memory.reconcile_failed", error=str(exc))
        for i in needs_llm:
            decisions.setdefault(i, {"action": "add"})
        return decisions
