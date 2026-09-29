"""Long-term memory store: CRUD, de-duplication and hybrid retrieval.

Retrieval fuses three ranked lists with Reciprocal Rank Fusion:
  1. semantic   — pgvector cosine distance on the active embedding model
  2. lexical    — Postgres full-text (Russian + English stemming), OR-query
  3. fuzzy      — pg_trgm word similarity (typos, inflections, names)
then re-weights by importance, pinning and recency. Only the top-k above a
relevance floor are returned — the model never sees the whole database.
"""

from __future__ import annotations

import math
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from jarvis.core.metrics import MEMORY_OPS
from jarvis.db.base import utcnow
from jarvis.db.models import MEMORY_KINDS, Memory, MemoryEmbedding
from jarvis.memory.embeddings import Embedder

_WORD = re.compile(r"[\w'-]{2,}", re.UNICODE)


@dataclass
class RecalledMemory:
    memory: Memory
    score: float
    signals: dict[str, float]

    def as_dict(self) -> dict[str, Any]:
        m = self.memory
        return {
            "id": str(m.id),
            "kind": m.kind,
            "content": m.content,
            "subject": m.subject,
            "importance": round(m.importance, 2),
            "pinned": m.pinned,
            "updated_at": m.updated_at.isoformat() if m.updated_at else None,
            "score": round(self.score, 4),
        }


def _vec_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{v:.6f}" for v in vec) + "]"


def _or_query(q: str) -> str | None:
    words = [w.replace("'", "") for w in _WORD.findall(q.lower())]
    words = [w for w in words if len(w) >= 3][:16]
    return " | ".join(words) if words else None


class MemoryStore:
    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession], embedder: Embedder, *,
                 dup_threshold: float = 0.92, min_similarity: float = 0.35):
        self.sessionmaker = sessionmaker
        self.embedder = embedder
        self.dup_threshold = dup_threshold
        self.min_similarity = min_similarity

    # ---------------------------------------------------------------- write path

    async def _embed_one(self, content: str, kind: str = "document") -> list[float] | None:
        if not self.embedder.enabled:
            return None
        try:
            vecs = await self.embedder.embed([content], kind=kind)
        except Exception:  # noqa: BLE001 - embeddings are an optimisation; FTS still works
            MEMORY_OPS.labels("embed_error").inc()
            return None
        return vecs[0] if vecs else None

    async def find_similar(self, session: AsyncSession, user_id: uuid.UUID, content: str, *,
                           vec: list[float] | None, limit: int = 3) -> list[tuple[Memory, float]]:
        if vec is not None:
            rows = (
                await session.execute(
                    text(
                        """
                        SELECT m.id, 1 - (e.embedding <=> CAST(:q AS vector)) AS sim
                        FROM memory_embeddings e JOIN memories m ON m.id = e.memory_id
                        WHERE m.user_id = :uid AND m.status = 'active' AND e.model = :model
                        ORDER BY e.embedding <=> CAST(:q AS vector) LIMIT :n
                        """
                    ),
                    {"q": _vec_literal(vec), "uid": user_id, "model": self.embedder.model, "n": limit},
                )
            ).all()
        else:
            rows = (
                await session.execute(
                    text(
                        """
                        SELECT id, similarity(content, :c) AS sim FROM memories
                        WHERE user_id = :uid AND status = 'active' AND similarity(content, :c) > 0.3
                        ORDER BY sim DESC LIMIT :n
                        """
                    ),
                    {"c": content, "uid": user_id, "n": limit},
                )
            ).all()
        if not rows:
            return []
        mems = {m.id: m for m in (await session.execute(select(Memory).where(Memory.id.in_([r[0] for r in rows])))).scalars()}
        return [(mems[r[0]], float(r[1])) for r in rows if r[0] in mems]

    async def add(
        self,
        user_id: uuid.UUID,
        content: str,
        *,
        kind: str = "semantic",
        subject: str | None = None,
        importance: float = 0.5,
        confidence: float = 0.9,
        pinned: bool = False,
        source: str = "explicit",
        source_ref: str | None = None,
        tags: list[str] | None = None,
        dedupe: bool = True,
        session: AsyncSession | None = None,
    ) -> tuple[Memory, bool]:
        """Store a memory. Returns (memory, created). Near-duplicates reinforce the existing row."""
        if kind not in MEMORY_KINDS:
            kind = "semantic"
        content = content.strip()
        if not content:
            raise ValueError("empty memory")
        own = session is None
        session = session or self.sessionmaker()
        try:
            vec = await self._embed_one(content)
            if dedupe:
                similar = await self.find_similar(session, user_id, content, vec=vec, limit=1)
                threshold = self.dup_threshold if vec is not None else 0.85
                if similar and similar[0][1] >= threshold:
                    existing = similar[0][0]
                    existing.importance = max(existing.importance, importance)
                    existing.confidence = min(1.0, max(existing.confidence, confidence) + 0.05)
                    existing.pinned = existing.pinned or pinned
                    existing.updated_at = utcnow()
                    await session.flush()
                    if own:
                        await session.commit()
                    MEMORY_OPS.labels("reinforce").inc()
                    return existing, False
            mem = Memory(
                user_id=user_id, kind=kind, content=content, subject=subject, importance=importance,
                confidence=confidence, pinned=pinned, source=source, source_ref=source_ref, tags=tags or [],
            )
            session.add(mem)
            await session.flush()
            if vec is not None:
                session.add(MemoryEmbedding(memory_id=mem.id, model=self.embedder.model, embedding=vec))
            if own:
                await session.commit()
            MEMORY_OPS.labels("add").inc()
            return mem, True
        finally:
            if own:
                await session.close()

    async def update(self, user_id: uuid.UUID, memory_id: uuid.UUID, **fields: Any) -> Memory | None:
        async with self.sessionmaker() as session:
            mem = await session.get(Memory, memory_id)
            if mem is None or mem.user_id != user_id or mem.status == "deleted":
                return None
            allowed = {"content", "kind", "subject", "importance", "pinned", "tags", "confidence"}
            for k, v in fields.items():
                if k in allowed and v is not None:
                    setattr(mem, k, v)
            mem.updated_at = utcnow()
            if "content" in fields and fields["content"]:
                vec = await self._embed_one(mem.content)
                await session.execute(
                    text("DELETE FROM memory_embeddings WHERE memory_id = :id"), {"id": mem.id}
                )
                if vec is not None:
                    session.add(MemoryEmbedding(memory_id=mem.id, model=self.embedder.model, embedding=vec))
            await session.commit()
            MEMORY_OPS.labels("update").inc()
            return mem

    async def supersede(self, session: AsyncSession, old: Memory, new: Memory) -> None:
        old.status = "superseded"
        old.superseded_by = new.id
        await session.flush()

    async def delete(self, user_id: uuid.UUID, memory_id: uuid.UUID, *, hard: bool = False) -> bool:
        async with self.sessionmaker() as session:
            mem = await session.get(Memory, memory_id)
            if mem is None or mem.user_id != user_id:
                return False
            if hard:
                await session.delete(mem)
            else:
                mem.status = "deleted"
                mem.updated_at = utcnow()
                await session.execute(text("DELETE FROM memory_embeddings WHERE memory_id = :id"), {"id": mem.id})
            await session.commit()
            MEMORY_OPS.labels("delete").inc()
            return True

    # ---------------------------------------------------------------- read path

    async def list(self, user_id: uuid.UUID, *, kind: str | None = None, query: str | None = None,
                   pinned: bool | None = None, limit: int = 50, offset: int = 0) -> tuple[list[Memory], int]:
        async with self.sessionmaker() as session:
            stmt = select(Memory).where(Memory.user_id == user_id, Memory.status == "active")
            if kind:
                stmt = stmt.where(Memory.kind == kind)
            if pinned is not None:
                stmt = stmt.where(Memory.pinned == pinned)
            if query:
                like = f"%{query}%"
                stmt = stmt.where(or_(Memory.content.ilike(like), Memory.subject.ilike(like)))
            total = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
            rows = (
                await session.execute(
                    stmt.order_by(Memory.pinned.desc(), Memory.updated_at.desc()).limit(limit).offset(offset)
                )
            ).scalars().all()
            return list(rows), int(total)

    async def core_profile(self, user_id: uuid.UUID, *, limit: int = 20) -> list[Memory]:
        """Pinned + profile + important facts — small, stable, always in context."""
        async with self.sessionmaker() as session:
            rows = (
                await session.execute(
                    select(Memory)
                    .where(
                        Memory.user_id == user_id,
                        Memory.status == "active",
                        or_(Memory.pinned.is_(True), Memory.kind.in_(["profile", "important"])),
                    )
                    .order_by(Memory.pinned.desc(), Memory.importance.desc(), Memory.created_at.asc())
                    .limit(limit)
                )
            ).scalars().all()
            return list(rows)

    async def search(self, user_id: uuid.UUID, query: str, *, limit: int = 8, kinds: list[str] | None = None,
                     exclude: set[uuid.UUID] | None = None, touch: bool = True) -> list[RecalledMemory]:
        query = query.strip()
        if not query:
            return []
        exclude = exclude or set()
        k = 60.0
        ranked: dict[uuid.UUID, dict[str, float]] = {}

        def add(list_name: str, ids_scores: list[tuple[uuid.UUID, float]]) -> None:
            for rank, (mid, score) in enumerate(ids_scores):
                slot = ranked.setdefault(mid, {})
                slot[list_name] = score
                slot["rrf"] = slot.get("rrf", 0.0) + 1.0 / (k + rank + 1)

        kind_clause = "AND m.kind = ANY(:kinds)" if kinds else ""
        params_base: dict[str, Any] = {"uid": user_id, "n": 30}
        if kinds:
            params_base["kinds"] = kinds

        async with self.sessionmaker() as session:
            vec = await self._embed_one(query, kind="query")
            if vec is not None:
                rows = (
                    await session.execute(
                        text(
                            f"""
                            SELECT m.id, 1 - (e.embedding <=> CAST(:q AS vector)) AS sim
                            FROM memory_embeddings e JOIN memories m ON m.id = e.memory_id
                            WHERE m.user_id = :uid AND m.status = 'active' AND e.model = :model {kind_clause}
                            ORDER BY e.embedding <=> CAST(:q AS vector) LIMIT :n
                            """
                        ),
                        {**params_base, "q": _vec_literal(vec), "model": self.embedder.model},
                    )
                ).all()
                add("semantic", [(r[0], float(r[1])) for r in rows if float(r[1]) >= self.min_similarity])

            tsq = _or_query(query)
            if tsq:
                rows = (
                    await session.execute(
                        text(
                            f"""
                            SELECT m.id, ts_rank(m.tsv, query.q) AS rank
                            FROM memories m,
                                 (SELECT to_tsquery('russian', :tsq) || to_tsquery('english', :tsq) AS q) AS query
                            WHERE m.user_id = :uid AND m.status = 'active' AND m.tsv @@ query.q {kind_clause}
                            ORDER BY rank DESC LIMIT :n
                            """
                        ),
                        {**params_base, "tsq": tsq},
                    )
                ).all()
                add("lexical", [(r[0], float(r[1])) for r in rows])

            rows = (
                await session.execute(
                    text(
                        f"""
                        SELECT m.id, word_similarity(:q, m.content) AS ws FROM memories m
                        WHERE m.user_id = :uid AND m.status = 'active' {kind_clause}
                          AND word_similarity(:q, m.content) > 0.35
                        ORDER BY ws DESC LIMIT :n
                        """
                    ),
                    {**params_base, "q": query},
                )
            ).all()
            add("fuzzy", [(r[0], float(r[1])) for r in rows])

            ids = [mid for mid in ranked if mid not in exclude]
            if not ids:
                return []
            mems = {m.id: m for m in (await session.execute(select(Memory).where(Memory.id.in_(ids)))).scalars()}
            now = datetime.now(timezone.utc)
            results: list[RecalledMemory] = []
            for mid in ids:
                mem = mems.get(mid)
                if mem is None:
                    continue
                sig = ranked[mid]
                age_days = max(0.0, (now - (mem.updated_at or mem.created_at)).total_seconds() / 86400)
                half_life = 60.0 if mem.kind == "episodic" else 365.0
                recency = 0.6 + 0.4 * math.exp(-age_days / half_life)
                score = sig["rrf"] * (0.6 + mem.importance) * recency * (1.25 if mem.pinned else 1.0)
                results.append(RecalledMemory(mem, score, sig))
            results.sort(key=lambda r: r.score, reverse=True)
            results = results[:limit]
            if touch and results:
                await session.execute(
                    update(Memory)
                    .where(Memory.id.in_([r.memory.id for r in results]))
                    .values(access_count=Memory.access_count + 1, last_accessed_at=utcnow())
                )
                await session.commit()
            MEMORY_OPS.labels("search").inc()
            return results

    async def reembed_all(self, batch: int = 64) -> int:
        """Index every active memory missing a vector for the current embedding model."""
        if not self.embedder.enabled:
            return 0
        done = 0
        async with self.sessionmaker() as session:
            while True:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT m.id, m.content FROM memories m
                            WHERE m.status = 'active' AND NOT EXISTS (
                              SELECT 1 FROM memory_embeddings e WHERE e.memory_id = m.id AND e.model = :model)
                            LIMIT :n
                            """
                        ),
                        {"model": self.embedder.model, "n": batch},
                    )
                ).all()
                if not rows:
                    break
                vecs = await self.embedder.embed([r[1] for r in rows])
                for (mid, _), vec in zip(rows, vecs or []):
                    session.add(MemoryEmbedding(memory_id=mid, model=self.embedder.model, embedding=vec))
                await session.commit()
                done += len(rows)
        return done

    async def expire_old(self) -> int:
        async with self.sessionmaker() as session:
            res = await session.execute(
                update(Memory)
                .where(Memory.expires_at.is_not(None), Memory.expires_at < utcnow(), Memory.status == "active")
                .values(status="deleted")
            )
            await session.commit()
            return res.rowcount or 0


def format_memories(items: list[Memory] | list[RecalledMemory], *, max_chars: int = 4000) -> str:
    lines: list[str] = []
    used = 0
    for item in items:
        m = item.memory if isinstance(item, RecalledMemory) else item
        subj = f" [{m.subject}]" if m.subject else ""
        date = (m.updated_at or m.created_at).date().isoformat() if (m.updated_at or m.created_at) else ""
        line = f"- ({m.kind}{subj}, {date}, id={str(m.id)[:8]}) {m.content}"
        if used + len(line) > max_chars:
            break
        lines.append(line)
        used += len(line)
    return "\n".join(lines)


def since(days: int) -> datetime:
    return utcnow() - timedelta(days=days)
