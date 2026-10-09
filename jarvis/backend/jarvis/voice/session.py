"""Real-time voice conversation over one WebSocket.

    client VAD ─► utterance (WAV) ─► STT ─► agent turn (voice route, low effort)
    agent text deltas ─► sentence buffer ─► TTS stream ─► client plays sentence by sentence
    user starts speaking while JARVIS talks ─► client stops playback + sends `interrupt`
                                              ─► server cancels the turn (barge-in)

Protocol (JSON text frames; audio as binary frames):
  → {"type":"start","conversation_id"?,"tts":"server|browser"}   → binary WAV utterance
  → {"type":"text","text":…}   (browser STT)      → {"type":"interrupt"}
  ← {"type":"ready",stt,tts} ← transcript ← status ← delta ← audio_start/binary mp3/audio_end
  ← approval (spoken "да / нет" answers it) ← done ← error
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import time
import uuid
from typing import TYPE_CHECKING, Any

from fastapi import WebSocket, WebSocketDisconnect

from jarvis.billing.service import QuotaExceeded
from jarvis.core.logging import log
from jarvis.permissions.approvals import ApprovalError
from jarvis.voice.service import SentenceBuffer, VoiceError, VoiceProfile

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

YES = re.compile(r"^(да|ага|подтверждаю|подтверди|давай|конечно|yes|yeah|yep|confirm|do it|go ahead)\b", re.I)
NO = re.compile(r"^(нет|не надо|отмена|отклони|no|nope|cancel|don't)\b", re.I)
# how speech-to-text commonly spells "Jarvis"
WAKE_VARIANTS = {"джарвис": ["джарвис", "джервис", "жарвис", "джарвиз", "jarvis"], "jarvis": ["jarvis", "джарвис"]}


def strip_wake(text: str, wake_words: list[str]) -> tuple[str, bool]:
    """('Джарвис, открой Chrome', [...]) → ('открой Chrome', True). Accepts 'hey/эй/ok' before the word."""
    words: set[str] = set()
    for w in wake_words:
        words.update(WAKE_VARIANTS.get(w.lower(), [w.lower()]))
    pattern = r"^\s*(?:hey|эй|ok|окей|хей)?[\s,]*(?:" + "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)) + \
        r")(?=$|[\s,!.:?\-—–])[\s,!.:?\-—–]*"
    m = re.match(pattern, text, re.I)
    if not m:
        return text, False
    return text[m.end():].strip(), True


class VoiceSession:
    def __init__(self, app: "AppContext", ws: WebSocket, user_id: uuid.UUID):
        self.app = app
        self.ws = ws
        self.user_id = user_id
        self.conversation_id: uuid.UUID | None = None
        self.server_tts = True
        self.current_task: uuid.UUID | None = None
        self.speaker: asyncio.Task | None = None
        self.pending_approval: str | None = None
        self.seq = 0
        self.buffer = SentenceBuffer()
        self.profile = VoiceProfile()
        self.follow_up_until = 0.0  # hands-free: no wake word needed until then
        self.streamed = False  # did the current answer arrive as text deltas?
        self._send_lock = asyncio.Lock()
        self._tts_queue: asyncio.Queue[tuple[int, str] | None] = asyncio.Queue()

    async def send(self, payload: dict[str, Any] | bytes) -> None:
        async with self._send_lock:
            if isinstance(payload, bytes):
                await self.ws.send_bytes(payload)
            else:
                await self.ws.send_text(json.dumps(payload, ensure_ascii=False))

    async def _ready(self) -> None:
        self.profile = await self.app.voice.profile(self.user_id)
        stt = await self.app.voice.stt_provider(self.user_id)
        tts = await self.app.voice.tts_provider(self.user_id)
        await self.send({"type": "ready", "stt": stt, "tts": tts, "profile": self.profile.model_dump()})

    async def run(self) -> None:
        events = asyncio.create_task(self._pump_events())
        tts_worker = asyncio.create_task(self._tts_worker())
        await self._ready()
        try:
            while True:
                msg = await self.ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if msg.get("bytes") is not None:
                    await self._on_audio(msg["bytes"])
                elif msg.get("text"):
                    await self._on_control(json.loads(msg["text"]))
        except WebSocketDisconnect:
            pass
        finally:
            events.cancel()
            tts_worker.cancel()
            if self.current_task:
                await self.app.tasks.cancel(self.current_task, user_id=self.user_id)

    async def _on_control(self, data: dict[str, Any]) -> None:
        kind = data.get("type")
        if kind == "start":
            if data.get("conversation_id"):
                with contextlib.suppress(ValueError):
                    self.conversation_id = uuid.UUID(data["conversation_id"])
            self.server_tts = data.get("tts", "server") == "server"
        elif kind == "text":
            await self._on_transcript((data.get("text") or "").strip())
        elif kind == "interrupt":
            await self._interrupt()
        elif kind == "reload_profile":  # the user changed voice settings mid-session
            await self._ready()

    async def _on_audio(self, audio: bytes) -> None:
        if len(audio) < 3200:  # < 0.1 s of 16 kHz PCM — VAD misfire
            return
        await self.send({"type": "status", "state": "transcribing", "label": "Распознаю…"})
        try:
            text = await self.app.voice.transcribe(audio, "audio/wav", user_id=self.user_id)
        except VoiceError as exc:
            await self.send({"type": "error", "message": str(exc)})
            return
        await self._on_transcript(text)

    async def _on_transcript(self, text: str) -> None:
        if not text:
            await self.send({"type": "status", "state": "idle", "label": "Не расслышал"})
            return
        if self.profile.hands_free and not self.pending_approval:
            command, woke = strip_wake(text, self.profile.wake_words)
            if not woke and time.monotonic() > self.follow_up_until:
                # background talk, TV, other people: never act without the wake word
                await self.send({"type": "ignored", "text": text})
                return
            if woke and not command:  # just "Джарвис" — acknowledge and keep listening
                self.follow_up_until = time.monotonic() + max(self.profile.follow_up_s, 6)
                await self.send({"type": "wake"})
                await self._say("Слушаю.")
                return
            text = command or text
            if woke:
                await self.send({"type": "wake"})
        await self.send({"type": "transcript", "text": text})
        if self.pending_approval and (YES.match(text) or NO.match(text)):
            try:
                await self.app.approvals.decide(uuid.UUID(self.pending_approval), user_id=self.user_id,
                                                approve=bool(YES.match(text)), via="voice")
            except ApprovalError as exc:
                await self._say(str(exc))
            self.pending_approval = None
            return
        await self._interrupt(silent=True)
        try:
            _, task = await self.app.conversations.submit(user_id=self.user_id, text=text, channel="voice",
                                                          conversation_id=self.conversation_id)
        except QuotaExceeded as exc:  # plan limit: say so instead of silently doing nothing
            await self._say(str(exc))
            task = None
        self.current_task = task.id if task else None
        self.buffer = SentenceBuffer()
        self.streamed = False
        if task is None:  # e.g. "стоп": nothing will answer, reopen the follow-up window now
            self.follow_up_until = time.monotonic() + self.profile.follow_up_s

    async def _interrupt(self, silent: bool = False) -> None:
        if self.current_task:
            await self.app.tasks.cancel(self.current_task, user_id=self.user_id)
            self.current_task = None
        self.seq += 1  # invalidates queued audio
        while not self._tts_queue.empty():
            self._tts_queue.get_nowait()
        if not silent:
            await self.send({"type": "status", "state": "interrupted", "label": "Слушаю"})

    async def _say(self, text: str) -> None:
        await self.send({"type": "delta", "text": text})
        await self._tts_queue.put((self.seq, text))

    async def _pump_events(self) -> None:
        async for ev in self.app.bus.subscribe(self.user_id):
            task_id = ev.get("task_id")
            if not self.current_task or task_id != str(self.current_task):
                continue
            data = ev.get("data") or {}
            et = ev.get("type")
            if et == "message.delta":
                self.streamed = True
                await self.send({"type": "delta", "text": data.get("text", "")})
                for sentence in self.buffer.feed(data.get("text", "")):
                    await self._tts_queue.put((self.seq, sentence))
            elif et in ("agent.status", "tool.started"):
                await self.send({"type": "status", "state": data.get("state", "tool"),
                                 "label": data.get("label") or data.get("activity")})
            elif et == "approval.requested":
                self.pending_approval = data.get("id")
                await self.send({"type": "approval", **data})
                await self._tts_queue.put((self.seq, f"Мне нужно подтверждение: {data.get('summary', '')}. Подтвердить?"))
            elif et == "message.completed":
                content = (data.get("message") or {}).get("content", "")
                if not self.streamed and content:
                    # answers that were not streamed (custom commands, notices) are spoken in full
                    await self.send({"type": "delta", "text": content})
                    for sentence in self.buffer.feed(_speakable(content) + " "):
                        await self._tts_queue.put((self.seq, sentence))
                rest = self.buffer.flush()
                if rest:
                    await self._tts_queue.put((self.seq, rest))
                await self.send({"type": "done", "text": content})
                self.current_task = None
                self.follow_up_until = time.monotonic() + self.profile.follow_up_s

    async def _tts_worker(self) -> None:
        while True:
            item = await self._tts_queue.get()
            if item is None:
                return
            seq, text = item
            if seq != self.seq or not self.server_tts:
                continue
            try:
                await self.send({"type": "audio_start", "format": "mp3", "seq": seq, "text": text})
                async for chunk in self.app.voice.synthesize(text, self.profile):
                    if seq != self.seq:
                        break
                    await self.send(chunk)
                await self.send({"type": "audio_end", "seq": seq})
            except VoiceError as exc:
                self.server_tts = False
                await self.send({"type": "tts_unavailable", "message": str(exc)})
            except Exception:  # noqa: BLE001
                log.exception("voice.tts_failed")


def _speakable(text: str) -> str:
    """Drop markdown and status glyphs before speaking a finished message."""
    text = re.sub(r"[*_`#>]|[✓✗⏰⏹⚠️✅]", "", text)
    return re.sub(r"([.!?…])?\s*\n\s*", lambda m: (m.group(1) or ".") + " ", text).strip()
