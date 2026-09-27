"""Runtime secret resolution: environment first, then encrypted values saved from the UI."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from jarvis.db.models import SystemSetting
from jarvis.security.crypto import SecretBox
from jarvis.settings import Settings

# key -> Settings attribute (env var) that overrides it
KNOWN_SECRETS: dict[str, str] = {
    "anthropic_api_key": "anthropic_api_key",
    "openai_api_key": "openai_api_key",
    "voyage_api_key": "voyage_api_key",
    "tavily_api_key": "tavily_api_key",
    "brave_api_key": "brave_api_key",
    "deepgram_api_key": "deepgram_api_key",
    "elevenlabs_api_key": "elevenlabs_api_key",
    "telegram_bot_token": "telegram_bot_token",
    "whatsapp_access_token": "whatsapp_access_token",
    "whatsapp_app_secret": "whatsapp_app_secret",
    "google_client_secret": "google_client_secret",
}


class SecretStore:
    def __init__(self, settings: Settings, sessionmaker: async_sessionmaker[AsyncSession], box: SecretBox):
        self.settings = settings
        self.sessionmaker = sessionmaker
        self.box = box
        self._cache: dict[str, tuple[float, str | None]] = {}

    def _env(self, key: str) -> str | None:
        attr = KNOWN_SECRETS.get(key)
        return getattr(self.settings, attr, None) if attr else None

    async def get(self, key: str) -> str | None:
        env = self._env(key)
        if env:
            return env
        hit = self._cache.get(key)
        if hit and time.monotonic() - hit[0] < 30:
            return hit[1]
        async with self.sessionmaker() as session:
            row = await session.get(SystemSetting, f"secret:{key}")
        value = self.box.decrypt(row.secret_enc) if row and row.secret_enc else None
        self._cache[key] = (time.monotonic(), value)
        return value

    async def set(self, key: str, value: str | None) -> None:
        if key not in KNOWN_SECRETS:
            raise KeyError(key)
        async with self.sessionmaker() as session:
            row = await session.get(SystemSetting, f"secret:{key}")
            if value:
                enc = self.box.encrypt(value)
                if row is None:
                    session.add(SystemSetting(key=f"secret:{key}", secret_enc=enc))
                else:
                    row.secret_enc = enc
            elif row is not None:
                await session.delete(row)
            await session.commit()
        self._cache.pop(key, None)

    async def status(self) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for key in KNOWN_SECRETS:
            if self._env(key):
                out[key] = {"configured": True, "source": "env"}
            else:
                out[key] = {"configured": bool(await self.get(key)), "source": "ui"}
        return out

    async def get_setting(self, key: str, default: Any = None) -> Any:
        async with self.sessionmaker() as session:
            row = await session.get(SystemSetting, key)
        return row.value if row and row.value is not None else default

    async def set_setting(self, key: str, value: Any) -> None:
        async with self.sessionmaker() as session:
            row = await session.get(SystemSetting, key)
            if row is None:
                session.add(SystemSetting(key=key, value=value))
            else:
                row.value = value
            await session.commit()
