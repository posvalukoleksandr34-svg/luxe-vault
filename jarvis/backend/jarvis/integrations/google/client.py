"""Google OAuth 2.0 (web server flow) and an authenticated REST client.

Tokens never leave the server: the refresh token is stored MultiFernet-encrypted
in `integrations.credentials_enc`; access tokens are refreshed on demand. The
OAuth `state` is an HMAC-signed, expiring token bound to the user.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

import httpx
from sqlalchemy import select

from jarvis.core.audit import audit
from jarvis.db.models import Integration
from jarvis.tools.base import ToolError

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
]


class GoogleAuth:
    def __init__(self, app: "AppContext", transport: httpx.AsyncBaseTransport | None = None):
        self.app = app
        self.transport = transport

    @property
    def redirect_uri(self) -> str:
        return f"{self.app.settings.public_url}/api/integrations/google/callback"

    async def configured(self) -> bool:
        return bool(self.app.settings.google_client_id and await self.app.secrets.get("google_client_secret"))

    def _sign(self, payload: dict[str, Any]) -> str:
        raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
        key = hashlib.sha256(self.app.box.keys[0].encode()).digest()
        sig = hmac.new(key, raw.encode(), hashlib.sha256).hexdigest()[:32]
        return f"{raw}.{sig}"

    def _verify(self, state: str) -> dict[str, Any]:
        try:
            raw, sig = state.rsplit(".", 1)
        except ValueError as exc:
            raise ToolError("invalid OAuth state") from exc
        key = hashlib.sha256(self.app.box.keys[0].encode()).digest()
        if not hmac.compare_digest(hmac.new(key, raw.encode(), hashlib.sha256).hexdigest()[:32], sig):
            raise ToolError("invalid OAuth state signature")
        payload = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        if payload.get("exp", 0) < time.time():
            raise ToolError("OAuth state expired — start again")
        return payload

    async def authorization_url(self, user_id: uuid.UUID) -> str:
        if not await self.configured():
            raise ToolError("Google OAuth is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET")
        state = self._sign({"uid": str(user_id), "n": secrets.token_urlsafe(8), "exp": int(time.time()) + 600})
        params = {
            "client_id": self.app.settings.google_client_id, "redirect_uri": self.redirect_uri,
            "response_type": "code", "scope": " ".join(SCOPES), "access_type": "offline",
            "prompt": "consent", "include_granted_scopes": "true", "state": state,
        }
        return f"{AUTH_URL}?{urlencode(params)}"

    async def handle_callback(self, code: str, state: str) -> Integration:
        payload = self._verify(state)
        user_id = uuid.UUID(payload["uid"])
        secret = await self.app.secrets.get("google_client_secret")
        async with httpx.AsyncClient(timeout=30, transport=self.transport) as client:
            r = await client.post(TOKEN_URL, data={
                "code": code, "client_id": self.app.settings.google_client_id, "client_secret": secret,
                "redirect_uri": self.redirect_uri, "grant_type": "authorization_code"})
            if r.status_code >= 400:
                raise ToolError(f"Google token exchange failed: {r.text[:200]}")
            tokens = r.json()
            info = (await client.get(USERINFO_URL, headers={"Authorization": f"Bearer {tokens['access_token']}"})).json()
        creds = {"access_token": tokens["access_token"], "refresh_token": tokens.get("refresh_token"),
                 "expires_at": time.time() + int(tokens.get("expires_in", 3600)) - 60}
        async with self.app.sessionmaker() as session:
            row = (await session.execute(select(Integration).where(
                Integration.user_id == user_id, Integration.provider == "google"))).scalar_one_or_none()
            if row is None:
                row = Integration(user_id=user_id, provider="google")
                session.add(row)
            if not creds["refresh_token"] and row.credentials_enc:
                creds["refresh_token"] = self.app.box.decrypt_json(row.credentials_enc).get("refresh_token")
            row.credentials_enc = self.app.box.encrypt_json(creds)
            row.status = "connected"
            row.account = info.get("email", "")
            row.scopes = tokens.get("scope", "").split()
            row.meta = {"name": info.get("name")}
            await audit(session, action="integration.connected", actor="user", user_id=user_id, target="google",
                        data={"account": row.account, "scopes": row.scopes})
            await session.commit()
        self.app.invalidate_availability(user_id)
        return row

    async def disconnect(self, user_id: uuid.UUID) -> None:
        async with self.app.sessionmaker() as session:
            row = (await session.execute(select(Integration).where(
                Integration.user_id == user_id, Integration.provider == "google"))).scalar_one_or_none()
            if row is None:
                return
            if row.credentials_enc:
                token = self.app.box.decrypt_json(row.credentials_enc).get("refresh_token")
                if token:
                    try:
                        async with httpx.AsyncClient(timeout=15, transport=self.transport) as client:
                            await client.post(REVOKE_URL, data={"token": token})
                    except httpx.HTTPError:
                        pass
            await audit(session, action="integration.disconnected", actor="user", user_id=user_id, target="google")
            await session.delete(row)
            await session.commit()
        self.app.invalidate_availability(user_id)

    async def access_token(self, user_id: uuid.UUID) -> str:
        async with self.app.sessionmaker() as session:
            row = (await session.execute(select(Integration).where(
                Integration.user_id == user_id, Integration.provider == "google",
                Integration.status == "connected"))).scalar_one_or_none()
            if row is None or not row.credentials_enc:
                raise ToolError("Google is not connected", hint="connect it in JARVIS → Integrations → Google")
            creds = self.app.box.decrypt_json(row.credentials_enc)
            if creds.get("expires_at", 0) > time.time() + 30:
                return creds["access_token"]
            if not creds.get("refresh_token"):
                row.status = "error"
                await session.commit()
                raise ToolError("Google authorization expired — reconnect in Integrations")
            secret = await self.app.secrets.get("google_client_secret")
            async with httpx.AsyncClient(timeout=30, transport=self.transport) as client:
                r = await client.post(TOKEN_URL, data={
                    "client_id": self.app.settings.google_client_id, "client_secret": secret,
                    "refresh_token": creds["refresh_token"], "grant_type": "refresh_token"})
            if r.status_code >= 400:
                row.status = "error"
                row.meta = {**(row.meta or {}), "error": r.text[:200]}
                await session.commit()
                raise ToolError("Google token refresh failed — reconnect in Integrations")
            data = r.json()
            creds["access_token"] = data["access_token"]
            creds["expires_at"] = time.time() + int(data.get("expires_in", 3600)) - 60
            row.credentials_enc = self.app.box.encrypt_json(creds)
            await session.commit()
            return creds["access_token"]


class GoogleAPI:
    """Minimal authenticated client with one automatic retry on 401 and friendly errors."""

    def __init__(self, app: "AppContext", user_id: uuid.UUID, transport: httpx.AsyncBaseTransport | None = None):
        self.app = app
        self.user_id = user_id
        self.transport = transport or app.google.transport

    async def request(self, method: str, url: str, *, raw: bool = False, **kw: Any) -> Any:
        for attempt in (1, 2):
            token = await self.app.google.access_token(self.user_id)
            headers = {**kw.pop("headers", {}), "Authorization": f"Bearer {token}"}
            async with httpx.AsyncClient(timeout=30, transport=self.transport) as client:
                r = await client.request(method, url, headers=headers, **kw)
            if r.status_code == 401 and attempt == 1:
                await self._expire()
                continue
            if r.status_code == 429 or r.status_code >= 500:
                raise ToolError(f"Google API temporarily unavailable ({r.status_code})", retryable=True)
            if r.status_code >= 400:
                try:
                    msg = r.json().get("error", {}).get("message", r.text[:200])
                except ValueError:
                    msg = r.text[:200]
                raise ToolError(f"Google API error {r.status_code}: {msg}")
            if raw:
                return r.content
            return r.json() if r.content else {}
        raise ToolError("Google authorization failed")

    async def _expire(self) -> None:
        async with self.app.sessionmaker() as session:
            row = (await session.execute(select(Integration).where(
                Integration.user_id == self.user_id, Integration.provider == "google"))).scalar_one_or_none()
            if row and row.credentials_enc:
                creds = self.app.box.decrypt_json(row.credentials_enc)
                creds["expires_at"] = 0
                row.credentials_enc = self.app.box.encrypt_json(creds)
                await session.commit()
