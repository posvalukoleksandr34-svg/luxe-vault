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
import uuid
from typing import TYPE_CHECKING, Any

from fastapi import WebSocket, WebSocketDisconnect

from jarvis.core.logging import log
from jarvis.permissions.approvals import ApprovalError
from jarvis.voice.service import SentenceBuffer, VoiceError

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

YES = re.compile(r"^(да|ага|подтверждаю|подтверди|давай|конечно|yes|yeah|yep|confirm|do it|go ahead)\b", re.I)
NO = re.compile(r"^(нет|не надо|отмена|отклони|no|nope|cancel|don't)\b", re.I)


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
        self._send_lock = asyncio.Lock()
        self._tts_queue: asyncio.Queue[tuple[int, str] | None] = asyncio.Queue()

    async def send(self, payload: dict[str, Any] | bytes) -> None:
        async with self._send_lock:
            if isinstance(payload, bytes):
                await self.ws.send_bytes(payload)
            else:
                await self.ws.send_text(json.dumps(payload, ensure_ascii=False))

    async def run(self) -> None:
        stt = await self.app.voice.stt_provider()
        tts = await self.app.voice.tts_provider()
        events = asyncio.create_task(self._pump_events())
        tts_worker = asyncio.create_task(self._tts_worker())
        await self.send({"type": "ready", "stt": stt, "tts": tts})
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

    async def _on_audio(self, audio: bytes) -> None:
        if len(audio) < 3200:  # < 0.1 s of 16 kHz PCM — VAD misfire
            return
        await self.send({"type": "status", "state": "transcribing", "label": "Распознаю…"})
        try:
            text = await self.app.voice.transcribe(audio, "audio/wav")
        except VoiceError as exc:
            await self.send({"type": "error", "message": str(exc)})
            return
        await self._on_transcript(text)

    async def _on_transcript(self, text: str) -> None:
        if not text:
            await self.send({"type": "status", "state": "idle", "label": "Не расслышал"})
            return
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
        _, task = await self.app.conversations.submit(user_id=self.user_id, text=text, channel="voice",
                                                      conversation_id=self.conversation_id)
        self.current_task = task.id if task else None
        self.buffer = SentenceBuffer()

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
                rest = self.buffer.flush()
                if rest:
                    await self._tts_queue.put((self.seq, rest))
                await self.send({"type": "done", "text": (data.get("message") or {}).get("content", "")})
                self.current_task = None

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
                async for chunk in self.app.voice.synthesize(text):
                    if seq != self.seq:
                        break
                    await self.send(chunk)
                await self.send({"type": "audio_end", "seq": seq})
            except VoiceError as exc:
                self.server_tts = False
                await self.send({"type": "tts_unavailable", "message": str(exc)})
            except Exception:  # noqa: BLE001
                log.exception("voice.tts_failed")
