"""Settings, notifications, health, metrics, realtime WebSocket, voice socket and messenger webhooks."""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket
from fastapi.responses import PlainTextResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text, update

import jarvis
from jarvis.api.deps import Principal, current, get_app, ws_principal
from jarvis.api.routes.auth import user_payload
from jarvis.channels.whatsapp import verify_signature
from jarvis.core.audit import audit
from jarvis.core.container import AppContext
from jarvis.core.logging import log
from jarvis.core.secrets import KNOWN_SECRETS
from jarvis.core.timeparse import tz
from jarvis.core.version import schema_revision
from jarvis.db.base import utcnow
from jarvis.db.models import LLMCall, Notification, User
from jarvis.voice.service import VoiceError, VoiceProfile, VoiceProfilePatch
from jarvis.voice.session import VoiceSession

router = APIRouter(tags=["system"])
WORKER_KEY = "jarvis:workers:"


# ------------------------------------------------------------------------------------------ health


@router.get("/api/health")
async def health() -> dict:
    return {"ok": True, "version": jarvis.__version__}


@router.get("/api/ready")
async def ready(app: AppContext = Depends(get_app)) -> Response:
    checks: dict[str, bool] = {}
    try:
        async with app.sessionmaker() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = True
    except Exception:  # noqa: BLE001
        checks["database"] = False
    if app.redis is not None:
        try:
            checks["redis"] = bool(await app.redis.ping())
        except Exception:  # noqa: BLE001
            checks["redis"] = False
    ok = all(checks.values())
    return Response(json.dumps({"ok": ok, "checks": checks}), status_code=200 if ok else 503,
                    media_type="application/json")


@router.get("/metrics")
async def metrics(request: Request, app: AppContext = Depends(get_app)) -> Response:
    token = app.settings.metrics_token
    auth = request.headers.get("authorization", "")
    if not token or not hmac.compare_digest(auth, f"Bearer {token}"):
        raise HTTPException(401, "metrics token required")
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


async def _own_spend_today(app: AppContext, user_id) -> float:
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    async with app.sessionmaker() as session:
        return float((await session.execute(select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(
            LLMCall.user_id == user_id, LLMCall.created_at >= start))).scalar_one())


@router.get("/api/system/status")
async def system_status(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    workers = []
    if app.redis is not None:
        async for key in app.redis.scan_iter(f"{WORKER_KEY}*"):
            raw = await app.redis.get(key)
            if raw:
                workers.append(json.loads(raw))
    brain = await app.secrets.get(app.brain_key_name)
    main = app.router.route("main")
    return {
        "version": jarvis.__version__, "env": app.settings.env,
        "brain": {"configured": bool(brain) or app.settings.fake_llm, "demo_mode": app.settings.fake_llm,
                  "provider": app.settings.llm_provider, "key_name": app.brain_key_name,
                  "main_model": main.model, "routes": {n: {"provider": r.provider, "model": r.model, "effort": r.effort}
                                                       for n, r in app.router.routes.items()}},
        "workers": workers if p.user.is_owner else [], "embedded_worker": app.settings.embedded_worker,
        "queue_depth": await app.tasks.queue_depth(),
        "embeddings": {"model": app.embedder.model, "enabled": app.embedder.enabled},
        "skills": len(app.skills.enabled()), "tools": len(app.registry.all()),
        # instance-wide spend is the owner's business; other accounts see their own
        "spend_today_usd": round(await app.spend_today() if p.user.is_owner else await _own_spend_today(app, p.user_id), 4),
        "daily_limit_usd": app.settings.daily_cost_limit_usd if p.user.is_owner else None,
        "public_url": app.settings.public_url, "schema": await schema_revision(app),
    }


# ------------------------------------------------------------------------------------------ settings


@router.get("/api/settings")
async def get_settings_(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    return {"user": user_payload(p.user), "secrets": await app.secrets.status(),
            "providers": {"stt": app.settings.stt_provider, "tts": app.settings.tts_provider,
                          "search": app.settings.search_provider, "embeddings": app.settings.embedding_provider},
            "identity": {"assistant_name": app.identity.assistant_name}}


class ProfilePatch(BaseModel):
    display_name: str | None = Field(None, max_length=200)
    timezone: str | None = None
    locale: str | None = Field(None, max_length=16)
    notify_channels: list[Literal["web", "telegram", "whatsapp"]] | None = None
    voice: dict | None = None


@router.patch("/api/settings/profile")
async def patch_profile(body: ProfilePatch, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    if body.timezone:
        if tz(body.timezone).key != body.timezone:
            raise HTTPException(400, "unknown timezone")
    async with app.sessionmaker() as session:
        user = await session.get(User, p.user_id)
        if body.display_name:
            user.display_name = body.display_name
        if body.timezone:
            user.timezone = body.timezone
        if body.locale:
            user.locale = body.locale
        settings = dict(user.settings or {})
        if body.notify_channels is not None:
            settings["notify_channels"] = body.notify_channels
        if body.voice is not None:
            settings["voice"] = body.voice
        user.settings = settings
        await session.commit()
        return {"user": user_payload(user)}


class SecretIn(BaseModel):
    value: str | None = Field(None, max_length=4000)


@router.put("/api/settings/secrets/{key}")
async def put_secret(key: str, body: SecretIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    if key not in KNOWN_SECRETS:
        raise HTTPException(404, "unknown secret")
    if not p.user.is_owner:
        raise HTTPException(403, "owner only")
    if not p.elevated:
        raise HTTPException(428, {"code": "elevation_required", "message": "re-authenticate to change API keys"})
    await app.secrets.set(key, body.value)
    app.invalidate_availability()
    async with app.sessionmaker() as session:
        await audit(session, action="secret.updated", actor="user", user_id=p.user_id, target=key,
                    data={"cleared": not body.value})
        await session.commit()
    return {"ok": True, "configured": bool(body.value)}


# ------------------------------------------------------------------------------------------ notifications


@router.get("/api/notifications")
async def notifications(unread: bool = False, limit: int = 50, p: Principal = Depends(current),
                        app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        stmt = select(Notification).where(Notification.user_id == p.user_id)
        if unread:
            stmt = stmt.where(Notification.read_at.is_(None))
        rows = (await session.execute(stmt.order_by(Notification.created_at.desc()).limit(min(limit, 200)))).scalars()
        return {"notifications": [{"id": str(n.id), "title": n.title, "body": n.body, "level": n.level,
                                   "source": n.source, "ref": n.ref, "delivered": n.delivered,
                                   "read": n.read_at is not None, "created_at": n.created_at.isoformat()} for n in rows]}


class ReadIn(BaseModel):
    ids: list[uuid.UUID] | None = None


@router.post("/api/notifications/read")
async def mark_read(body: ReadIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        stmt = update(Notification).where(Notification.user_id == p.user_id, Notification.read_at.is_(None))
        if body.ids:
            stmt = stmt.where(Notification.id.in_(body.ids))
        await session.execute(stmt.values(read_at=utcnow()))
        await session.commit()
    return {"ok": True}


# ------------------------------------------------------------------------------------------ realtime


@router.websocket("/api/ws")
async def events_socket(ws: WebSocket) -> None:
    app: AppContext = ws.app.state.jarvis
    principal = await ws_principal(ws, app)
    if principal is None:
        await ws.close(code=4401)
        return
    await ws.accept()

    async def pump() -> None:
        async for event in app.bus.subscribe(principal.user_id):
            await ws.send_text(json.dumps(event, ensure_ascii=False))

    pumper = asyncio.create_task(pump())
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if msg.get("text") == "ping":
                await ws.send_text(json.dumps({"type": "pong", "ts": time.time()}))
    except Exception:  # noqa: BLE001
        pass
    finally:
        pumper.cancel()
        with contextlib.suppress(Exception):
            await pumper


@router.get("/api/voice/config")
async def voice_config(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    return {"stt": await app.voice.stt_provider(p.user_id), "tts": await app.voice.tts_provider(p.user_id),
            "profile": (await app.voice.profile(p.user_id)).model_dump(),
            "providers": await app.voice.available_providers(),
            "vad": {"positive_threshold": 0.6, "negative_threshold": 0.4, "min_speech_ms": 250,
                    "redemption_ms": 600}}


@router.put("/api/voice/profile")
async def voice_profile_save(body: VoiceProfilePatch, p: Principal = Depends(current),
                             app: AppContext = Depends(get_app)) -> dict:
    profile = await app.voice.save_profile(p.user_id, body)
    return {"profile": profile.model_dump(), "tts": await app.voice.tts_provider(p.user_id),
            "stt": await app.voice.stt_provider(p.user_id)}


@router.get("/api/voice/voices")
async def voice_list(provider: str, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    try:
        return {"provider": provider, "voices": await app.voice.list_voices(provider)}
    except VoiceError as exc:
        raise HTTPException(400, str(exc)) from exc


class PreviewIn(VoiceProfilePatch):
    text: str = Field("Добрый вечер. Я JARVIS — чем могу помочь?", max_length=300)


@router.post("/api/voice/preview")
async def voice_preview(body: PreviewIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)):
    """Speak a sample with the given (unsaved) settings. Browser voices are previewed client-side."""
    if not await app.ratelimiter.hit(f"voice-preview:{p.user_id}", limit=20, window_s=600):
        raise HTTPException(429, "too many previews, wait a few minutes")
    current_profile = (await app.voice.profile(p.user_id)).model_dump()
    profile = VoiceProfile.model_validate({**current_profile, **body.model_dump(exclude_unset=True, exclude={"text"})})
    if await app.voice._provider_for(profile) == "browser":
        raise HTTPException(400, "this voice is played by the browser")
    chunks = [c async for c in app.voice.synthesize(body.text, profile)]
    return Response(content=b"".join(chunks), media_type="audio/mpeg")


@router.websocket("/api/ws/voice")
async def voice_socket(ws: WebSocket) -> None:
    app: AppContext = ws.app.state.jarvis
    principal = await ws_principal(ws, app)
    if principal is None or not principal.has_scope("voice"):
        await ws.close(code=4401)
        return
    await ws.accept()
    await VoiceSession(app, ws, principal.user_id).run()


# ------------------------------------------------------------------------------------------ webhooks


@router.post("/api/webhooks/telegram")
async def telegram_webhook(request: Request, app: AppContext = Depends(get_app)) -> dict:
    secret = app.settings.telegram_webhook_secret
    got = request.headers.get("x-telegram-bot-api-secret-token", "")
    if not secret or not hmac.compare_digest(got, secret):
        raise HTTPException(401, "bad secret")
    update_ = await request.json()
    # ack fast; process in the background so Telegram does not retry
    asyncio.create_task(_safe(app.channels.adapters["telegram"].handle_update(update_)))
    return {"ok": True}


@router.get("/api/webhooks/whatsapp")
async def whatsapp_verify(app: AppContext = Depends(get_app), mode: str = Query("", alias="hub.mode"),
                          token: str = Query("", alias="hub.verify_token"),
                          challenge: str = Query("", alias="hub.challenge")) -> PlainTextResponse:
    expected = app.settings.whatsapp_verify_token
    if mode == "subscribe" and expected and hmac.compare_digest(token, expected):
        return PlainTextResponse(challenge)
    raise HTTPException(403, "verification failed")


@router.post("/api/webhooks/whatsapp")
async def whatsapp_webhook(request: Request, app: AppContext = Depends(get_app)) -> dict:
    body = await request.body()
    secret = await app.secrets.get("whatsapp_app_secret")
    if not secret or not verify_signature(secret, body, request.headers.get("x-hub-signature-256")):
        raise HTTPException(401, "bad signature")
    asyncio.create_task(_safe(app.channels.adapters["whatsapp"].handle_payload(json.loads(body))))
    return {"ok": True}


async def _safe(coro) -> None:
    try:
        await coro
    except Exception:  # noqa: BLE001
        log.exception("webhook.processing_failed")
