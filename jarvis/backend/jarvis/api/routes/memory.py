from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from jarvis.api.deps import Principal, current, get_app
from jarvis.core.audit import audit
from jarvis.core.container import AppContext
from jarvis.db.models import Memory

router = APIRouter(prefix="/api/memory", tags=["memory"])
Kind = Literal["profile", "semantic", "episodic", "project", "relationship", "important"]


def mem_payload(m: Memory) -> dict:
    return {"id": str(m.id), "kind": m.kind, "content": m.content, "subject": m.subject, "tags": m.tags,
            "importance": round(m.importance, 2), "confidence": round(m.confidence, 2), "pinned": m.pinned,
            "source": m.source, "access_count": m.access_count,
            "last_accessed_at": m.last_accessed_at.isoformat() if m.last_accessed_at else None,
            "created_at": m.created_at.isoformat(), "updated_at": m.updated_at.isoformat()}


@router.get("")
async def list_memories(kind: str | None = None, q: str | None = None, pinned: bool | None = None, limit: int = 50,
                        offset: int = 0, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    rows, total = await app.memory.list(p.user_id, kind=kind, query=q, pinned=pinned, limit=min(limit, 200),
                                        offset=offset)
    return {"memories": [mem_payload(m) for m in rows], "total": total}


@router.get("/search")
async def search(q: str, limit: int = 10, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    found = await app.memory.search(p.user_id, q, limit=min(limit, 30), touch=False)
    return {"results": [{**mem_payload(r.memory), "score": round(r.score, 4), "signals": r.signals} for r in found]}


class MemoryIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    kind: Kind = "semantic"
    subject: str | None = None
    importance: float = Field(0.6, ge=0, le=1)
    pinned: bool = False
    tags: list[str] = Field(default_factory=list)


@router.post("")
async def create_memory(body: MemoryIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    mem, created = await app.memory.add(p.user_id, body.content, kind=body.kind, subject=body.subject,
                                        importance=body.importance, pinned=body.pinned, source="user", tags=body.tags,
                                        confidence=1.0)
    async with app.sessionmaker() as session:
        await audit(session, action="memory.created", actor="user", user_id=p.user_id, target=str(mem.id))
        await session.commit()
    return {"memory": mem_payload(mem), "created": created}


class MemoryPatch(BaseModel):
    content: str | None = Field(None, max_length=4000)
    kind: Kind | None = None
    subject: str | None = None
    importance: float | None = Field(None, ge=0, le=1)
    pinned: bool | None = None
    tags: list[str] | None = None


@router.patch("/{memory_id}")
async def patch_memory(memory_id: uuid.UUID, body: MemoryPatch, p: Principal = Depends(current),
                       app: AppContext = Depends(get_app)) -> dict:
    mem = await app.memory.update(p.user_id, memory_id, **body.model_dump(exclude_none=True), confidence=1.0)
    if mem is None:
        raise HTTPException(404, "not found")
    async with app.sessionmaker() as session:
        await audit(session, action="memory.edited", actor="user", user_id=p.user_id, target=str(memory_id),
                    data=body.model_dump(exclude_none=True))
        await session.commit()
    return {"memory": mem_payload(mem)}


@router.delete("/{memory_id}")
async def delete_memory(memory_id: uuid.UUID, hard: bool = False, p: Principal = Depends(current),
                        app: AppContext = Depends(get_app)) -> dict:
    if not await app.memory.delete(p.user_id, memory_id, hard=hard):
        raise HTTPException(404, "not found")
    async with app.sessionmaker() as session:
        await audit(session, action="memory.deleted", actor="user", user_id=p.user_id, target=str(memory_id),
                    data={"hard": hard})
        await session.commit()
    return {"ok": True}


@router.get("/export")
async def export(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    rows, _ = await app.memory.list(p.user_id, limit=100_000)
    return {"version": 1, "memories": [mem_payload(m) for m in rows]}


class ImportIn(BaseModel):
    memories: list[MemoryIn]


@router.post("/import")
async def import_memories(body: ImportIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    created = 0
    for m in body.memories[:5000]:
        _, c = await app.memory.add(p.user_id, m.content, kind=m.kind, subject=m.subject, importance=m.importance,
                                    pinned=m.pinned, source="user", tags=m.tags)
        created += int(c)
    return {"imported": created, "total": len(body.memories)}
