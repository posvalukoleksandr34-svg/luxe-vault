from __future__ import annotations

import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from jarvis.agent.harness import serialize_message
from jarvis.api.deps import Principal, current, get_app, require_scope
from jarvis.core.container import AppContext
from jarvis.db.models import Conversation, Message

router = APIRouter(prefix="/api", tags=["chat"])


def conv_payload(c: Conversation, count: int | None = None) -> dict:
    return {"id": str(c.id), "title": c.title or "Без названия", "is_primary": c.is_primary, "archived": c.archived,
            "created_at": c.created_at.isoformat(), "updated_at": c.updated_at.isoformat(),
            **({"messages": count} if count is not None else {})}


@router.get("/conversations")
async def list_conversations(archived: bool = False, p: Principal = Depends(current),
                             app: AppContext = Depends(get_app)) -> dict:
    await app.conversations.primary(p.user_id)
    async with app.sessionmaker() as session:
        counts = select(Message.conversation_id, func.count().label("n")).group_by(Message.conversation_id).subquery()
        rows = (await session.execute(
            select(Conversation, func.coalesce(counts.c.n, 0))
            .outerjoin(counts, counts.c.conversation_id == Conversation.id)
            .where(Conversation.user_id == p.user_id, Conversation.archived.is_(archived))
            .order_by(Conversation.is_primary.desc(), Conversation.updated_at.desc()).limit(200))).all()
    return {"conversations": [conv_payload(c, n) for c, n in rows]}


class NewConversation(BaseModel):
    title: str = ""


@router.post("/conversations")
async def create_conversation(body: NewConversation, p: Principal = Depends(current),
                              app: AppContext = Depends(get_app)) -> dict:
    conv = await app.conversations.create(p.user_id, body.title or "New chat")
    return conv_payload(conv, 0)


class PatchConversation(BaseModel):
    title: str | None = None
    archived: bool | None = None


@router.patch("/conversations/{cid}")
async def patch_conversation(cid: uuid.UUID, body: PatchConversation, p: Principal = Depends(current),
                             app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        conv = await session.get(Conversation, cid)
        if conv is None or conv.user_id != p.user_id:
            raise HTTPException(404, "not found")
        if body.title is not None:
            conv.title = body.title[:300]
        if body.archived is not None and not conv.is_primary:
            conv.archived = body.archived
        await session.commit()
        return conv_payload(conv)


@router.delete("/conversations/{cid}")
async def delete_conversation(cid: uuid.UUID, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        conv = await session.get(Conversation, cid)
        if conv is None or conv.user_id != p.user_id:
            raise HTTPException(404, "not found")
        if conv.is_primary:
            raise HTTPException(400, "the primary conversation cannot be deleted")
        await session.delete(conv)
        await session.commit()
    return {"ok": True}


@router.get("/conversations/{cid}/messages")
async def messages(cid: uuid.UUID, before: datetime | None = None, limit: int = 50, p: Principal = Depends(current),
                   app: AppContext = Depends(get_app)) -> dict:
    conv = await app.conversations.get(p.user_id, cid)
    if conv is None:
        raise HTTPException(404, "not found")
    async with app.sessionmaker() as session:
        stmt = select(Message).where(Message.conversation_id == cid)
        if before is not None:
            stmt = stmt.where(Message.created_at < before)
        rows = list((await session.execute(stmt.order_by(Message.created_at.desc()).limit(min(limit, 200)))).scalars())
    rows.reverse()
    running = await app.conversations.running_turns(cid)
    return {"conversation": conv_payload(conv), "messages": [serialize_message(m) for m in rows],
            "running": [{"task_id": str(t.id), "status": t.status} for t in running]}


class ChatIn(BaseModel):
    text: str = Field(default="", max_length=50_000)
    conversation_id: uuid.UUID | None = None
    attachments: list[dict] = Field(default_factory=list)
    channel: str = "web"


@router.post("/chat")
async def chat(body: ChatIn, p: Principal = Depends(require_scope("chat")), app: AppContext = Depends(get_app)) -> dict:
    if not body.text.strip() and not body.attachments:
        raise HTTPException(400, "empty message")
    files = await app.user_files(p.user_id)
    for att in body.attachments:
        files.path(str(att.get("path", "")))  # confinement check (the caller's own workspace only)
    channel = body.channel if body.channel in ("web", "voice") else "web"
    try:
        msg, task = await app.conversations.submit(user_id=p.user_id, text=body.text, channel=channel,
                                                   conversation_id=body.conversation_id, attachments=body.attachments)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"message": serialize_message(msg), "task_id": str(task.id) if task else None,
            "conversation_id": str(msg.conversation_id)}


_SAFE = re.compile(r"[^\w.\-]+", re.UNICODE)


@router.post("/uploads")
async def upload(file: UploadFile = File(...), p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    data = await file.read(25 * 1024 * 1024 + 1)
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "file too large (25 MB max)")
    name = _SAFE.sub("_", file.filename or "upload.bin")[:120]
    rel = f"uploads/{datetime.now().strftime('%Y%m%d')}/{uuid.uuid4().hex[:8]}_{name}"
    info = (await app.user_files(p.user_id)).write_bytes(rel, data)
    return {"path": info["path"], "name": file.filename, "mime": file.content_type, "size": info["size"]}
