"""Speech providers and per-user voice profiles.

STT  deepgram (Nova-3, multilingual, ~300 ms for short utterances) | openai (gpt-4o-mini-transcribe)
TTS  elevenlabs (Flash v2.5 streaming, ~75 ms model latency)       | openai (gpt-4o-mini-tts)
Both fall back to the browser's own speech APIs when no key is configured
(the client is told via /api/voice/config), so voice works out of the box in Chrome.

Voice profile (users.settings["voice"], one per user): which provider and voice JARVIS speaks with,
speed / pitch / style, and hands-free listening (act only on utterances that start with the wake
word, plus a short follow-up window). Providers are resolved per call, so switching provider or voice
never needs code changes: VoiceProfile → provider (elevenlabs | openai | browser) → audio.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Any, Literal

import httpx
from pydantic import BaseModel, Field

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext


class VoiceError(Exception):
    pass


# OpenAI's built-in TTS voices (gpt-4o-mini-tts). Gender is how the voice sounds, not a claim about a person.
OPENAI_VOICES = [
    ("alloy", "neutral"), ("ash", "male"), ("ballad", "male"), ("coral", "female"), ("echo", "male"),
    ("fable", "male"), ("nova", "female"), ("onyx", "male"), ("sage", "female"), ("shimmer", "female"),
    ("verse", "male"),
]


class VoiceProfile(BaseModel):
    """What a user's JARVIS sounds like and how it listens. Every field is optional in storage."""

    tts_provider: Literal["auto", "elevenlabs", "openai", "browser"] = "auto"
    stt_provider: Literal["auto", "deepgram", "openai", "browser"] = "auto"
    voice_id: str | None = Field(None, max_length=120, description="Provider voice id (ElevenLabs id, OpenAI name, "
                                                                    "or browser voice name)")
    voice_name: str | None = Field(None, max_length=120)
    speed: float = Field(1.0, ge=0.5, le=2.0)
    pitch: float = Field(1.0, ge=0.5, le=2.0, description="Browser voices only")
    style: str = Field("", max_length=500, description="Speaking style (OpenAI voices), e.g. 'calm, dry British wit'")
    hands_free: bool = False
    wake_words: list[str] = Field(default_factory=lambda: ["джарвис", "jarvis"], max_length=10)
    follow_up_s: int = Field(8, ge=0, le=60, description="Seconds after an answer when no wake word is needed")


class VoiceProfilePatch(BaseModel):
    tts_provider: Literal["auto", "elevenlabs", "openai", "browser"] | None = None
    stt_provider: Literal["auto", "deepgram", "openai", "browser"] | None = None
    voice_id: str | None = Field(None, max_length=120)
    voice_name: str | None = Field(None, max_length=120)
    speed: float | None = Field(None, ge=0.5, le=2.0)
    pitch: float | None = Field(None, ge=0.5, le=2.0)
    style: str | None = Field(None, max_length=500)
    hands_free: bool | None = None
    wake_words: list[str] | None = Field(None, max_length=10)
    follow_up_s: int | None = Field(None, ge=0, le=60)


class VoiceService:
    def __init__(self, app: "AppContext", transport: httpx.AsyncBaseTransport | None = None):
        self.app = app
        self.transport = transport

    # ------------------------------------------------------------------ profiles

    async def profile(self, user_id: uuid.UUID | None) -> VoiceProfile:
        if user_id is None:
            return VoiceProfile()
        from jarvis.db.models import User

        async with self.app.sessionmaker() as session:
            user = await session.get(User, user_id)
        raw = ((user.settings or {}).get("voice") if user else None) or {}
        try:
            return VoiceProfile.model_validate(raw)
        except Exception:  # noqa: BLE001 — a broken stored profile must never break voice
            return VoiceProfile()

    async def save_profile(self, user_id: uuid.UUID, patch: VoiceProfilePatch) -> VoiceProfile:
        from sqlalchemy.orm.attributes import flag_modified

        from jarvis.db.models import User

        current = (await self.profile(user_id)).model_dump()
        changes = patch.model_dump(exclude_unset=True)
        if "wake_words" in changes and changes["wake_words"] is not None:
            changes["wake_words"] = [w.strip().lower() for w in changes["wake_words"] if w.strip()] or ["джарвис"]
        merged = VoiceProfile.model_validate({**current, **changes})
        async with self.app.sessionmaker() as session:
            user = await session.get(User, user_id)
            settings = dict(user.settings or {})
            settings["voice"] = merged.model_dump()
            user.settings = settings
            flag_modified(user, "settings")
            await session.commit()
        return merged

    async def _premium(self, user_id: uuid.UUID | None) -> bool:
        """Server-side STT/TTS costs money per minute: only plans with voice_premium get it."""
        if user_id is None or getattr(self.app, "billing", None) is None:
            return True
        return await self.app.billing.allowed(user_id, "voice_premium")

    async def stt_provider(self, user_id: uuid.UUID | None = None) -> str:
        chosen = (await self.profile(user_id)).stt_provider if user_id else "auto"
        if chosen == "browser" or not await self._premium(user_id):
            return "browser"
        if chosen == "deepgram" and await self.app.secrets.get("deepgram_api_key"):
            return "deepgram"
        if chosen == "openai" and await self.app.secrets.get("openai_api_key"):
            return "openai"
        pref = self.app.settings.stt_provider
        if pref == "deepgram" and await self.app.secrets.get("deepgram_api_key"):
            return "deepgram"
        if pref in ("openai", "deepgram") and await self.app.secrets.get("openai_api_key"):
            return "openai"
        if await self.app.secrets.get("deepgram_api_key"):
            return "deepgram"
        return "browser"

    async def tts_provider(self, user_id: uuid.UUID | None = None) -> str:
        chosen = (await self.profile(user_id)).tts_provider if user_id else "auto"
        if chosen == "browser" or not await self._premium(user_id):
            return "browser"
        if chosen == "elevenlabs" and await self.app.secrets.get("elevenlabs_api_key"):
            return "elevenlabs"
        if chosen == "openai" and await self.app.secrets.get("openai_api_key"):
            return "openai"
        pref = self.app.settings.tts_provider
        if pref == "elevenlabs" and await self.app.secrets.get("elevenlabs_api_key"):
            return "elevenlabs"
        if pref in ("openai", "elevenlabs") and await self.app.secrets.get("openai_api_key"):
            return "openai"
        if await self.app.secrets.get("elevenlabs_api_key"):
            return "elevenlabs"
        return "browser"

    async def available_providers(self) -> dict[str, list[str]]:
        tts, stt = ["browser"], ["browser"]
        if await self.app.secrets.get("elevenlabs_api_key"):
            tts.insert(0, "elevenlabs")
        if await self.app.secrets.get("openai_api_key"):
            tts.insert(0, "openai")
            stt.insert(0, "openai")
        if await self.app.secrets.get("deepgram_api_key"):
            stt.insert(0, "deepgram")
        return {"tts": tts, "stt": stt}

    _voices_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}

    async def list_voices(self, provider: str) -> list[dict[str, Any]]:
        """Voices a provider offers. ElevenLabs includes the account's own cloned/custom voices."""
        if provider == "openai":
            return [{"id": v, "name": v.capitalize(), "gender": g, "category": "premade", "provider": "openai"}
                    for v, g in OPENAI_VOICES]
        if provider == "elevenlabs":
            hit = self._voices_cache.get("elevenlabs")
            if hit and time.monotonic() - hit[0] < 600:
                return hit[1]
            key = await self.app.secrets.get("elevenlabs_api_key")
            if not key:
                raise VoiceError("ElevenLabs API key is not configured")
            async with httpx.AsyncClient(timeout=20, transport=self.transport) as client:
                r = await client.get("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": key})
            if r.status_code >= 400:
                raise VoiceError(f"elevenlabs voices error {r.status_code}")
            voices = [{"id": v["voice_id"], "name": v.get("name", v["voice_id"]),
                       "gender": (v.get("labels") or {}).get("gender"), "accent": (v.get("labels") or {}).get("accent"),
                       "category": v.get("category"), "preview_url": v.get("preview_url"), "provider": "elevenlabs"}
                      for v in r.json().get("voices", [])]
            self._voices_cache["elevenlabs"] = (time.monotonic(), voices)
            return voices
        return []  # browser voices are listed by the browser itself

    async def transcribe(self, audio: bytes, mime: str = "audio/wav", *, language: str | None = None,
                         user_id: uuid.UUID | None = None) -> str:
        provider = await self.stt_provider(user_id)
        if provider == "deepgram":
            key = await self.app.secrets.get("deepgram_api_key")
            params = {"model": "nova-3", "smart_format": "true", "punctuate": "true",
                      "language": language or "multi"}
            async with httpx.AsyncClient(timeout=30, transport=self.transport) as client:
                r = await client.post("https://api.deepgram.com/v1/listen", params=params, content=audio,
                                      headers={"Authorization": f"Token {key}", "Content-Type": mime.split(";")[0]})
            if r.status_code >= 400:
                raise VoiceError(f"deepgram error {r.status_code}: {r.text[:200]}")
            alts = r.json()["results"]["channels"][0]["alternatives"]
            return (alts[0].get("transcript") or "").strip() if alts else ""
        if provider == "openai":
            key = await self.app.secrets.get("openai_api_key")
            ext = {"audio/wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm", "audio/mpeg": "mp3"}.get(
                mime.split(";")[0], "wav")
            async with httpx.AsyncClient(timeout=60, transport=self.transport) as client:
                r = await client.post("https://api.openai.com/v1/audio/transcriptions",
                                      headers={"Authorization": f"Bearer {key}"},
                                      files={"file": (f"audio.{ext}", audio, mime)},
                                      data={"model": "gpt-4o-mini-transcribe"})
            if r.status_code >= 400:
                raise VoiceError(f"openai stt error {r.status_code}: {r.text[:200]}")
            return (r.json().get("text") or "").strip()
        raise VoiceError("no server-side speech-to-text configured (DEEPGRAM_API_KEY or OPENAI_API_KEY)")

    async def synthesize(self, text: str, profile: VoiceProfile | None = None, *,
                         user_id: uuid.UUID | None = None) -> AsyncIterator[bytes]:
        """Stream MP3 audio for one sentence/paragraph in the user's chosen voice."""
        profile = profile or await self.profile(user_id)
        provider = await self._provider_for(profile)
        if provider == "elevenlabs":
            key = await self.app.secrets.get("elevenlabs_api_key")
            s = self.app.settings
            voice = profile.voice_id if profile.voice_id and profile.tts_provider in ("elevenlabs", "auto") \
                and not _is_openai_voice(profile.voice_id) else s.elevenlabs_voice_id
            url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}/stream"
            body: dict[str, Any] = {"text": text, "model_id": s.elevenlabs_model}
            if abs(profile.speed - 1.0) > 0.01:
                body["voice_settings"] = {"speed": max(0.7, min(1.2, profile.speed))}  # ElevenLabs range
            async with httpx.AsyncClient(timeout=60, transport=self.transport) as client:
                async with client.stream("POST", url, params={"output_format": "mp3_44100_128"},
                                         headers={"xi-api-key": key}, json=body) as r:
                    if r.status_code >= 400:
                        raise VoiceError(f"elevenlabs error {r.status_code}")
                    async for chunk in r.aiter_bytes(4096):
                        yield chunk
            return
        if provider == "openai":
            key = await self.app.secrets.get("openai_api_key")
            voice = profile.voice_id if _is_openai_voice(profile.voice_id) else "onyx"
            body = {"model": "gpt-4o-mini-tts", "voice": voice, "input": text, "response_format": "mp3"}
            instructions = _openai_instructions(profile)
            if instructions:
                body["instructions"] = instructions
            async with httpx.AsyncClient(timeout=60, transport=self.transport) as client:
                async with client.stream("POST", "https://api.openai.com/v1/audio/speech",
                                         headers={"Authorization": f"Bearer {key}"}, json=body) as r:
                    if r.status_code >= 400:
                        raise VoiceError(f"openai tts error {r.status_code}")
                    async for chunk in r.aiter_bytes(4096):
                        yield chunk
            return
        raise VoiceError("no server-side text-to-speech configured")

    async def _provider_for(self, profile: VoiceProfile) -> str:
        """The provider a profile resolves to right now (falls back when its key is missing)."""
        if profile.tts_provider == "browser":
            return "browser"
        key = {"elevenlabs": "elevenlabs_api_key", "openai": "openai_api_key"}.get(profile.tts_provider)
        if key and await self.app.secrets.get(key):
            return profile.tts_provider
        return await self.tts_provider()


def _is_openai_voice(voice_id: str | None) -> bool:
    return bool(voice_id) and voice_id in {v for v, _ in OPENAI_VOICES}


def _openai_instructions(profile: VoiceProfile) -> str:
    """gpt-4o-mini-tts takes speaking style as instructions; speed is expressed the same way."""
    parts = [profile.style.strip()] if profile.style.strip() else []
    if profile.speed >= 1.25:
        parts.append("Speak noticeably faster than normal.")
    elif profile.speed > 1.05:
        parts.append("Speak slightly faster than normal.")
    elif profile.speed <= 0.8:
        parts.append("Speak noticeably slower than normal.")
    elif profile.speed < 0.95:
        parts.append("Speak slightly slower than normal.")
    return " ".join(parts)


class SentenceBuffer:
    """Accumulates streamed text and yields speakable chunks as soon as a sentence ends."""

    ENDERS = ".!?…\n"

    def __init__(self, min_chars: int = 25):
        self.buf = ""
        self.min_chars = min_chars

    def feed(self, text: str) -> list[str]:
        self.buf += text
        out: list[str] = []
        while True:
            idx = -1
            for i, ch in enumerate(self.buf):
                if ch in self.ENDERS and i + 1 >= self.min_chars:
                    nxt = self.buf[i + 1 : i + 2]
                    if nxt == "" or nxt.isspace():
                        idx = i
                        break
            if idx < 0:
                break
            sentence, self.buf = self.buf[: idx + 1].strip(), self.buf[idx + 1 :]
            if sentence:
                out.append(sentence)
        return out

    def flush(self) -> str:
        rest, self.buf = self.buf.strip(), ""
        return rest
