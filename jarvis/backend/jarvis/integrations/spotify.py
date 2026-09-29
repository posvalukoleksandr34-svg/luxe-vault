"""Spotify Web API: OAuth (authorization-code flow) + playback control.

Same shape as the Google integration: tokens live encrypted in `integrations` (provider "spotify"),
access tokens are refreshed on demand, the OAuth state is HMAC-signed and bound to the user.

Playback control (play / pause / next / volume) is a Spotify Premium feature; the API answers 403
PREMIUM_REQUIRED otherwise, which is reported as such. "No active device" is answered by starting the
Spotify app on the user's PC through the desktop agent (if connected) and transferring playback to it.

Redirect URI: <JARVIS_PUBLIC_URL>/api/integrations/spotify/callback. Spotify accepts only HTTPS or a
loopback IP (http://127.0.0.1:…) — plain http://localhost is rejected by Spotify.
"""

from __future__ import annotations

import asyncio
import base64
import secrets
import time
import uuid
from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

import httpx
from sqlalchemy import select

from jarvis.core.audit import audit
from jarvis.db.models import Integration
from jarvis.integrations.oauth_state import sign_state, verify_state
from jarvis.tools.base import ToolError

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
API = "https://api.spotify.com/v1"
SCOPES = ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing",
          "playlist-read-private", "user-library-read"]


class SpotifyAuth:
    def __init__(self, app: "AppContext", transport: httpx.AsyncBaseTransport | None = None):
        self.app = app
        self.transport = transport

    @property
    def redirect_uri(self) -> str:
        return f"{self.app.settings.public_url}/api/integrations/spotify/callback"

    async def configured(self) -> bool:
        return bool(self.app.settings.spotify_client_id and await self.app.secrets.get("spotify_client_secret"))

    async def _basic(self) -> str:
        secret = await self.app.secrets.get("spotify_client_secret")
        return base64.b64encode(f"{self.app.settings.spotify_client_id}:{secret}".encode()).decode()

    async def authorization_url(self, user_id: uuid.UUID) -> str:
        if not await self.configured():
            raise ToolError("Spotify is not configured: set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET")
        state = sign_state(self.app, {"uid": str(user_id), "p": "spotify", "n": secrets.token_urlsafe(8),
                                      "exp": int(time.time()) + 600})
        params = {"client_id": self.app.settings.spotify_client_id, "response_type": "code",
                  "redirect_uri": self.redirect_uri, "scope": " ".join(SCOPES), "state": state}
        return f"{AUTH_URL}?{urlencode(params)}"

    async def handle_callback(self, code: str, state: str) -> Integration:
        payload = verify_state(self.app, state)
        if payload.get("p") != "spotify":
            raise ToolError("OAuth state is for another integration")
        user_id = uuid.UUID(payload["uid"])
        async with httpx.AsyncClient(timeout=30, transport=self.transport) as client:
            r = await client.post(TOKEN_URL, headers={"Authorization": f"Basic {await self._basic()}"},
                                  data={"grant_type": "authorization_code", "code": code,
                                        "redirect_uri": self.redirect_uri})
            if r.status_code >= 400:
                raise ToolError(f"Spotify token exchange failed: {r.text[:200]}")
            tokens = r.json()
            me = (await client.get(f"{API}/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})).json()
        creds = {"access_token": tokens["access_token"], "refresh_token": tokens.get("refresh_token"),
                 "expires_at": time.time() + int(tokens.get("expires_in", 3600)) - 60}
        async with self.app.sessionmaker() as session:
            row = (await session.execute(select(Integration).where(
                Integration.user_id == user_id, Integration.provider == "spotify"))).scalar_one_or_none()
            if row is None:
                row = Integration(user_id=user_id, provider="spotify")
                session.add(row)
            row.credentials_enc = self.app.box.encrypt_json(creds)
            row.status = "connected"
            row.account = me.get("display_name") or me.get("id", "")
            row.scopes = (tokens.get("scope") or "").split()
            row.meta = {"product": me.get("product")}  # "premium" is needed for playback control
            await audit(session, action="integration.connected", actor="user", user_id=user_id, target="spotify",
                        data={"account": row.account, "product": me.get("product")})
            await session.commit()
        self.app.invalidate_availability(user_id)
        return row

    async def disconnect(self, user_id: uuid.UUID) -> None:
        async with self.app.sessionmaker() as session:
            row = (await session.execute(select(Integration).where(
                Integration.user_id == user_id, Integration.provider == "spotify"))).scalar_one_or_none()
            if row is None:
                return
            await audit(session, action="integration.disconnected", actor="user", user_id=user_id, target="spotify")
            await session.delete(row)
            await session.commit()
        self.app.invalidate_availability(user_id)

    async def access_token(self, user_id: uuid.UUID) -> str:
        async with self.app.sessionmaker() as session:
            row = (await session.execute(select(Integration).where(
                Integration.user_id == user_id, Integration.provider == "spotify",
                Integration.status == "connected"))).scalar_one_or_none()
            if row is None or not row.credentials_enc:
                raise ToolError("Spotify is not connected", hint="connect it in JARVIS → Integrations → Spotify")
            creds = self.app.box.decrypt_json(row.credentials_enc)
            if creds.get("expires_at", 0) > time.time() + 30:
                return creds["access_token"]
            async with httpx.AsyncClient(timeout=30, transport=self.transport) as client:
                r = await client.post(TOKEN_URL, headers={"Authorization": f"Basic {await self._basic()}"},
                                      data={"grant_type": "refresh_token", "refresh_token": creds.get("refresh_token")})
            if r.status_code >= 400:
                row.status = "error"
                row.meta = {**(row.meta or {}), "error": r.text[:200]}
                await session.commit()
                raise ToolError("Spotify authorization expired — reconnect in Integrations")
            data = r.json()
            creds["access_token"] = data["access_token"]
            creds["refresh_token"] = data.get("refresh_token") or creds.get("refresh_token")
            creds["expires_at"] = time.time() + int(data.get("expires_in", 3600)) - 60
            row.credentials_enc = self.app.box.encrypt_json(creds)
            await session.commit()
            return creds["access_token"]


class SpotifyAPI:
    def __init__(self, app: "AppContext", user_id: uuid.UUID):
        self.app = app
        self.user_id = user_id
        self.transport = app.spotify.transport

    async def request(self, method: str, path: str, *, params: dict | None = None, json: Any = None) -> Any:
        token = await self.app.spotify.access_token(self.user_id)
        async with httpx.AsyncClient(timeout=20, transport=self.transport) as client:
            r = await client.request(method, f"{API}{path}", params=params, json=json,
                                     headers={"Authorization": f"Bearer {token}"})
        if r.status_code in (200, 201) and r.content:
            return r.json()
        if r.status_code in (200, 201, 202, 204):
            return {}
        reason = ""
        try:
            err = r.json().get("error", {})
            reason = err.get("reason") or err.get("message") or ""
        except ValueError:
            pass
        if r.status_code == 403 and "PREMIUM" in reason.upper():
            raise ToolError("Spotify Premium is required to control playback")
        if r.status_code == 404 and "NO_ACTIVE_DEVICE" in reason.upper():
            raise NoActiveDevice("no active Spotify device")
        if r.status_code == 429 or r.status_code >= 500:
            raise ToolError(f"Spotify is temporarily unavailable ({r.status_code})", retryable=True)
        raise ToolError(f"Spotify API error {r.status_code}: {reason or r.text[:150]}")

    async def search(self, query: str, kind: str, limit: int = 5) -> list[dict[str, Any]]:
        data = await self.request("GET", "/search", params={"q": query, "type": kind, "limit": limit})
        items = (data.get(f"{kind}s") or {}).get("items") or []
        out = []
        for it in items:
            if not it:
                continue
            artists = ", ".join(a["name"] for a in it.get("artists", []))
            out.append({"name": it.get("name"), "uri": it.get("uri"), "artists": artists or None,
                        "owner": (it.get("owner") or {}).get("display_name")})
        return out

    async def ensure_device(self) -> str | None:
        """Make sure playback has somewhere to go: an active device, else start the app on the user's PC."""
        devices = (await self.request("GET", "/me/player/devices")).get("devices", [])
        active = next((d for d in devices if d.get("is_active")), None)
        if active:
            return active["id"]
        if devices:
            await self.request("PUT", "/me/player", json={"device_ids": [devices[0]["id"]], "play": False})
            return devices[0]["id"]
        if self.app.devices is not None and await self.app.devices.devices(self.user_id):
            try:
                await self.app.devices.call(self.user_id, "apps.open", {"name": "spotify"}, capability="apps")
            except Exception:  # noqa: BLE001
                return None
            for _ in range(8):  # the app registers with Spotify Connect a few seconds after start
                await asyncio.sleep(1.5)
                devices = (await self.request("GET", "/me/player/devices")).get("devices", [])
                if devices:
                    await self.request("PUT", "/me/player", json={"device_ids": [devices[0]["id"]], "play": False})
                    return devices[0]["id"]
        return None


class NoActiveDevice(ToolError):
    pass
