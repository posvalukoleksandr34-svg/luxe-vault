"""Desktop app (installer .exe) endpoints.

    POST /api/auth/device-login   e-mail + password (+ 2FA) → a long-lived device token for this computer
                                  (scopes computer + voice + chat). The app keeps it in Windows Credential
                                  Manager; the password is never stored.
    POST /api/auth/handoff        device token → a one-time link that opens the web UI already signed in
                                  (the tray's "Open JARVIS"), valid 60 s, single use.
    GET  /api/auth/handoff/{code} the link itself: creates a browser session and redirects.

The app never talks to OpenAI or any other provider: every model / speech call is made by this server with the
server's keys, under the account's plan limits.
"""

from __future__ import annotations

from datetime import timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

import jarvis
from jarvis.api.deps import Principal, current, get_app
from jarvis.api.routes.account import consume_token, issue_token
from jarvis.api.routes.auth import EMAIL, _issue, _set_cookie, authenticate, user_payload
from jarvis.core.audit import audit
from jarvis.core.container import AppContext
from jarvis.db.models import User

router = APIRouter(prefix="/api/auth", tags=["desktop app"])

DESKTOP_SCOPES = ["computer", "voice", "chat"]
HANDOFF_TTL = timedelta(seconds=60)


class DeviceLoginIn(BaseModel):
    email: str = Field(pattern=EMAIL, max_length=320)
    password: str = Field(min_length=1, max_length=200)
    totp: str | None = Field(None, max_length=12)
    device_name: str = Field("Windows PC", min_length=1, max_length=100)


@router.post("/device-login")
async def device_login(body: DeviceLoginIn, request: Request, app: AppContext = Depends(get_app)) -> dict:
    user = await authenticate(app, request, body.email, body.password, body.totp)
    token = await _issue(app, request, user, kind="device", name=body.device_name, scopes=DESKTOP_SCOPES, ttl_days=0)
    return {"token": token, "scopes": DESKTOP_SCOPES, "user": user_payload(user),
            "server": {"version": jarvis.__version__, "product_name": app.settings.product_name}}


class HandoffIn(BaseModel):
    next: str = Field("/widget", max_length=200)


def _safe_next(path: str) -> str:
    # only same-site paths: "/widget", "/settings#voice" — never "//evil.com" or "https://…"
    if not path.startswith("/") or path.startswith("//") or "\\" in path:
        return "/"
    return path


@router.post("/handoff")
async def create_handoff(body: HandoffIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    if p.session.kind != "device" or not p.has_scope("chat"):
        raise HTTPException(403, "only the JARVIS desktop app can open a signed-in window this way")
    code = await issue_token(app, "handoff", user_id=p.user_id, ttl=HANDOFF_TTL)
    return {"url": f"{app.settings.public_url}/api/auth/handoff/{code}?{urlencode({'next': _safe_next(body.next)})}",
            "expires_in": int(HANDOFF_TTL.total_seconds())}


@router.get("/handoff/{code}", include_in_schema=False)
async def use_handoff(code: str, request: Request, next: str = "/widget", app: AppContext = Depends(get_app)):
    try:
        row = await consume_token(app, "handoff", code)
    except HTTPException:
        return RedirectResponse(f"{app.settings.public_url}/login", status_code=303)
    async with app.sessionmaker() as session:
        user = await session.get(User, row.user_id)
        if user is None or user.disabled_at is not None:
            return RedirectResponse(f"{app.settings.public_url}/login", status_code=303)
        await audit(session, action="auth.handoff_used", actor="user", user_id=user.id,
                    data={"ip": request.client.host if request.client else None})
        await session.commit()
    response = RedirectResponse(f"{app.settings.public_url}{_safe_next(next)}", status_code=303)
    _set_cookie(response, app, await _issue(app, request, user, name="desktop app window"))
    return response
