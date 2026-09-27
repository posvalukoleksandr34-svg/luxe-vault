"""JARVIS voice satellite — "Hey JARVIS" on a small device.

    mic ─► openWakeWord (on device) ─► "hey jarvis" ─► record until silence ─► /api/ws/voice
    ◄── spoken reply (MP3 sentences, played as they arrive) ◄── JARVIS
    saying "hey jarvis" while it talks interrupts it (barge-in)

Privacy: audio never leaves the device until the wake word fires; only the utterance after it is sent.
The wake-word model runs locally on CPU (~1-3% of a Raspberry Pi 4 core); the expensive model is never
fed a continuous stream.

    pip install -r requirements.txt && cp .env.example .env && python jarvis_satellite.py
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import queue
import ssl
import struct
import sys
import threading
import time
import wave

import numpy as np
import sounddevice as sd

RATE = 16000
FRAME = 1280  # 80 ms — openWakeWord's native frame size


def load_env(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def to_wav(pcm: np.ndarray) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.astype(np.int16).tobytes())
    return buf.getvalue()


class Player:
    """Decodes MP3 sentences and plays them back-to-back on a background thread; stoppable at any time."""

    def __init__(self, device: str | None):
        self.device = device or None
        self.q: queue.Queue[bytes | None] = queue.Queue()
        self.stop_flag = threading.Event()
        self.playing = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    def enqueue(self, mp3: bytes) -> None:
        self.q.put(mp3)

    def stop(self) -> None:
        self.stop_flag.set()
        while not self.q.empty():
            self.q.get_nowait()
        sd.stop()

    def _run(self) -> None:
        import miniaudio

        while True:
            mp3 = self.q.get()
            if mp3 is None:
                return
            self.stop_flag.clear()
            try:
                decoded = miniaudio.decode(mp3, output_format=miniaudio.SampleFormat.SIGNED16, nchannels=1)
            except Exception:  # noqa: BLE001 - skip undecodable chunk
                continue
            samples = np.frombuffer(decoded.samples, dtype=np.int16)
            self.playing.set()
            sd.play(samples, decoded.sample_rate, device=self.device)
            while sd.get_stream().active and not self.stop_flag.is_set():
                time.sleep(0.02)
            if self.q.empty():
                self.playing.clear()


class Satellite:
    def __init__(self) -> None:
        from openwakeword.model import Model

        self.url = os.environ["JARVIS_URL"].rstrip("/").replace("https://", "wss://").replace("http://", "ws://")
        self.token = os.environ["JARVIS_TOKEN"]
        self.wake_word = os.environ.get("WAKE_WORD", "hey_jarvis")
        self.threshold = float(os.environ.get("WAKE_THRESHOLD", "0.5"))
        self.silence_ms = int(os.environ.get("SILENCE_MS", "800"))
        self.max_s = float(os.environ.get("MAX_UTTERANCE_S", "15"))
        self.speech_rms = float(os.environ.get("SPEECH_RMS", "500"))
        self.model = Model(wakeword_models=[self.wake_word], inference_framework="onnx")
        self.frames: asyncio.Queue[np.ndarray] = asyncio.Queue(maxsize=200)
        self.player = Player(os.environ.get("OUTPUT_DEVICE"))
        self.ws = None
        self.pending_mp3: list[bytes] = []

    def _mic_callback(self, indata, frames, t, status) -> None:  # noqa: ANN001 - sounddevice signature
        try:
            self.loop.call_soon_threadsafe(self.frames.put_nowait, indata[:, 0].copy())
        except asyncio.QueueFull:
            pass

    def wake_score(self, frame: np.ndarray) -> float:
        scores = self.model.predict(frame)
        return max(scores.values()) if scores else 0.0

    async def record_utterance(self) -> np.ndarray:
        """Record after the wake word until SILENCE_MS of quiet (simple RMS endpointing)."""
        chunks: list[np.ndarray] = []
        silent_ms = 0
        heard = False
        started = time.monotonic()
        while time.monotonic() - started < self.max_s:
            frame = await self.frames.get()
            chunks.append(frame)
            rms = float(np.sqrt(np.mean(frame.astype(np.float32) ** 2)))
            if rms > self.speech_rms:
                heard, silent_ms = True, 0
            else:
                silent_ms += 80
            if heard and silent_ms >= self.silence_ms:
                break
            if not heard and silent_ms >= 4000:
                return np.array([], dtype=np.int16)  # woke up, nobody spoke
        return np.concatenate(chunks) if chunks else np.array([], dtype=np.int16)

    async def receiver(self) -> None:
        async for msg in self.ws:
            if isinstance(msg, bytes):
                self.pending_mp3.append(msg)
                continue
            data = json.loads(msg)
            kind = data.get("type")
            if kind == "audio_start":
                self.pending_mp3 = []
            elif kind == "audio_end":
                self.player.enqueue(b"".join(self.pending_mp3))
                self.pending_mp3 = []
            elif kind == "transcript":
                print(f"  you: {data['text']}")
            elif kind == "done":
                print(f"  jarvis: {data.get('text', '')[:200]}")
            elif kind == "approval":
                print(f"  ⚠ approval needed: {data.get('summary')} — say 'hey jarvis, да' or 'нет'")
            elif kind in ("error", "tts_unavailable"):
                print(f"  ! {data.get('message')}")

    async def run(self) -> None:
        import websockets

        self.loop = asyncio.get_running_loop()
        ssl_ctx = ssl.create_default_context() if self.url.startswith("wss://") else None
        headers = {"Authorization": f"Bearer {self.token}"}
        stream = sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=FRAME,
                                device=os.environ.get("INPUT_DEVICE") or None, callback=self._mic_callback)
        stream.start()
        print(f"listening for '{self.wake_word}' … (Ctrl+C to quit)")
        while True:
            try:
                async with websockets.connect(f"{self.url}/api/ws/voice", additional_headers=headers, ssl=ssl_ctx,
                                              max_size=16 * 1024 * 1024) as ws:
                    self.ws = ws
                    ready = json.loads(await ws.recv())
                    await ws.send(json.dumps({"type": "start", "tts": "server"}))
                    if ready.get("stt") == "browser":
                        print("! server has no speech-to-text key (DEEPGRAM_API_KEY / OPENAI_API_KEY) — satellite needs it")
                    recv = asyncio.create_task(self.receiver())
                    try:
                        await self.listen_loop()
                    finally:
                        recv.cancel()
            except (OSError, websockets.exceptions.WebSocketException) as exc:
                print(f"connection lost ({exc}); retrying in 5 s")
                await asyncio.sleep(5)

    async def listen_loop(self) -> None:
        while True:
            frame = await self.frames.get()
            if self.wake_score(frame) < self.threshold:
                continue
            if self.player.playing.is_set():  # barge-in
                self.player.stop()
                await self.ws.send(json.dumps({"type": "interrupt"}))
            print("• wake word")
            self.model.reset()
            beep()
            pcm = await self.record_utterance()
            if pcm.size < RATE // 4:
                continue
            await self.ws.send(to_wav(pcm))


def beep() -> None:
    t = np.linspace(0, 0.12, int(RATE * 0.12), False)
    tone = (np.sin(880 * 2 * np.pi * t) * 0.2 * 32767).astype(np.int16)
    sd.play(tone, RATE)


def calibrate(seconds: int = 5) -> None:
    print(f"stay quiet for {seconds} s …")
    audio = sd.rec(int(seconds * RATE), samplerate=RATE, channels=1, dtype="int16")
    sd.wait()
    frames = audio[: len(audio) // FRAME * FRAME].reshape(-1, FRAME).astype(np.float32)
    noise = float(np.percentile(np.sqrt((frames ** 2).mean(axis=1)), 90))
    print(f"background RMS ≈ {noise:.0f}; suggested SPEECH_RMS={int(noise * 3 + 150)}")


def main() -> None:
    load_env()
    ap = argparse.ArgumentParser(description="JARVIS voice satellite")
    ap.add_argument("--calibrate", action="store_true", help="measure background noise and suggest SPEECH_RMS")
    ap.add_argument("--list-devices", action="store_true")
    args = ap.parse_args()
    if args.list_devices:
        print(sd.query_devices())
        return
    if args.calibrate:
        calibrate()
        return
    if not os.environ.get("JARVIS_URL") or not os.environ.get("JARVIS_TOKEN"):
        sys.exit("set JARVIS_URL and JARVIS_TOKEN (see .env.example)")
    try:
        import openwakeword

        openwakeword.utils.download_models([os.environ.get("WAKE_WORD", "hey_jarvis")])
    except Exception as exc:  # noqa: BLE001
        print(f"note: could not pre-download wake-word model: {exc}")
    asyncio.run(Satellite().run())


_ = struct  # stdlib kept for packers that trim unused imports

if __name__ == "__main__":
    main()
