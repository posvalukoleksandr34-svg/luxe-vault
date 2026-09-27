"""Speech providers.

STT  deepgram (Nova-3, multilingual, ~300 ms for short utterances) | openai (gpt-4o-mini-transcribe)
TTS  elevenlabs (Flash v2.5 streaming, ~75 ms model latency)       | openai (gpt-4o-mini-tts)
Both fall back to the browser's own speech APIs when no key is configured
(the client is told via /api/voice/config), so voice works out of the box in Chrome.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext


class VoiceError(Exception):
    pass


class VoiceService:
    def __init__(self, app: "AppContext", transport: httpx.AsyncBaseTransport | None = None):
        self.app = app
        self.transport = transport

    async def stt_provider(self) -> str:
        pref = self.app.settings.stt_provider
        if pref == "deepgram" and await self.app.secrets.get("deepgram_api_key"):
            return "deepgram"
        if pref in ("openai", "deepgram") and await self.app.secrets.get("openai_api_key"):
            return "openai"
        if await self.app.secrets.get("deepgram_api_key"):
            return "deepgram"
        return "browser"

    async def tts_provider(self) -> str:
        pref = self.app.settings.tts_provider
        if pref == "elevenlabs" and await self.app.secrets.get("elevenlabs_api_key"):
            return "elevenlabs"
        if pref in ("openai", "elevenlabs") and await self.app.secrets.get("openai_api_key"):
            return "openai"
        if await self.app.secrets.get("elevenlabs_api_key"):
            return "elevenlabs"
        return "browser"

    async def transcribe(self, audio: bytes, mime: str = "audio/wav", *, language: str | None = None) -> str:
        provider = await self.stt_provider()
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

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        """Stream MP3 audio for one sentence/paragraph."""
        provider = await self.tts_provider()
        if provider == "elevenlabs":
            key = await self.app.secrets.get("elevenlabs_api_key")
            s = self.app.settings
            url = f"https://api.elevenlabs.io/v1/text-to-speech/{s.elevenlabs_voice_id}/stream"
            async with httpx.AsyncClient(timeout=60, transport=self.transport) as client:
                async with client.stream("POST", url, params={"output_format": "mp3_44100_128"},
                                         headers={"xi-api-key": key},
                                         json={"text": text, "model_id": s.elevenlabs_model}) as r:
                    if r.status_code >= 400:
                        raise VoiceError(f"elevenlabs error {r.status_code}")
                    async for chunk in r.aiter_bytes(4096):
                        yield chunk
            return
        if provider == "openai":
            key = await self.app.secrets.get("openai_api_key")
            async with httpx.AsyncClient(timeout=60, transport=self.transport) as client:
                async with client.stream("POST", "https://api.openai.com/v1/audio/speech",
                                         headers={"Authorization": f"Bearer {key}"},
                                         json={"model": "gpt-4o-mini-tts", "voice": "onyx", "input": text,
                                               "response_format": "mp3"}) as r:
                    if r.status_code >= 400:
                        raise VoiceError(f"openai tts error {r.status_code}")
                    async for chunk in r.aiter_bytes(4096):
                        yield chunk
            return
        raise VoiceError("no server-side text-to-speech configured")


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
