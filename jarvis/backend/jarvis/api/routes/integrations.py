from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from jarvis.api.deps import Principal, current, get_app, resolve_token
from jarvis.channels.hub import link_payload
from jarvis.core.audit import audit
from jarvis.core.container import AppContext
from jarvis.db.models import ChannelLink, Integration
from jarvis.tools.base import ToolError

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


@router.get("")
async def overview(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        integrations = {i.provider: i for i in (await session.execute(
            select(Integration).where(Integration.user_id == p.user_id))).scalars()}
    links = await app.channels.links(p.user_id)
    g = integrations.get("google")
    secrets = await app.secrets.status()
    return {
        "google": {"configured": await app.google.configured(), "connected": bool(g and g.status == "connected"),
                   "status": g.status if g else "disconnected", "account": g.account if g else None,
                   "scopes": g.scopes if g else [], "redirect_uri": app.google.redirect_uri},
        "telegram": {"configured": secrets["telegram_bot_token"]["configured"], "mode": app.settings.telegram_mode,
                     "links": [link_payload(link) for link in links if link.channel == "telegram"]},
        "whatsapp": {"configured": await app.channels.adapters["whatsapp"].available(),
                     "webhook_url": f"{app.settings.public_url}/api/webhooks/whatsapp",
                     "links": [link_payload(link) for link in links if link.channel == "whatsapp"]},
        "voice": {"stt": await app.voice.stt_provider(), "tts": await app.voice.tts_provider()},
        "browser": {"available": app.browser.available},
        "sandbox": {"available": app.sandbox.available},
        "search": {"provider": app.settings.search_provider},
        "mcp": await app.secrets.get_setting("mcp_status", {}),
        "not_implemented": ["microsoft (Outlook/OneDrive)", "dropbox", "desktop OS control agent"],
    }


@router.get("/google/connect")
async def google_connect(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    try:
        return {"url": await app.google.authorization_url(p.user_id)}
    except ToolError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/google/callback")
async def google_callback(request: Request, code: str | None = None, state: str | None = None,
                          error: str | None = None, app: AppContext = Depends(get_app)):
    # The browser returns here via a top-level redirect; the session cookie (SameSite=Lax) is present.
    from jarvis.api.deps import COOKIE

    principal = await resolve_token(app, request.cookies.get(COOKIE))
    if error or not code or not state or principal is None:
        return RedirectResponse(f"{app.settings.public_url}/integrations?google=error")
    try:
        integration = await app.google.handle_callback(code, state)
    except ToolError:
        return RedirectResponse(f"{app.settings.public_url}/integrations?google=error")
    if integration.user_id != principal.user_id:
        return RedirectResponse(f"{app.settings.public_url}/integrations?google=error")
    return RedirectResponse(f"{app.settings.public_url}/integrations?google=connected")


@router.delete("/google")
async def google_disconnect(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    await app.google.disconnect(p.user_id)
    return {"ok": True}


@router.post("/{channel}/pair")
async def pair(channel: Literal["telegram", "whatsapp"], p: Principal = Depends(current),
               app: AppContext = Depends(get_app)) -> dict:
    code = await app.pairing.create_code(p.user_id, channel)
    instructions = {
        "telegram": f"Откройте вашего бота в Telegram и отправьте: /start {code}",
        "whatsapp": f"Отправьте на номер JARVIS в WhatsApp сообщение: link {code}",
    }[channel]
    return {"code": code, "expires_in": 600, "instructions": instructions}


@router.delete("/links/{link_id}")
async def unlink(link_id: uuid.UUID, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        link = await session.get(ChannelLink, link_id)
        if link is None or link.user_id != p.user_id:
            raise HTTPException(404, "not found")
        await session.delete(link)
        await audit(session, action="channel.unlinked", actor="user", user_id=p.user_id, target=link.channel,
                    data={"external_id": link.external_id})
        await session.commit()
    return {"ok": True}


@router.post("/telegram/webhook")
async def telegram_set_webhook(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    if app.settings.telegram_mode != "webhook":
        raise HTTPException(400, "JARVIS_TELEGRAM_MODE is not 'webhook'")
    try:
        await app.channels.adapters["telegram"].set_webhook()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Telegram rejected the webhook: {exc}") from exc
    return {"ok": True}
