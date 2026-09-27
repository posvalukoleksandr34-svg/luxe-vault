/**
 * Real-time voice conversation client.
 *
 *   mic ─► Silero VAD (in-browser) ─► utterance WAV ─► /api/ws/voice ─► STT ─► JARVIS ─► TTS sentences ─► speaker
 *   speaking over JARVIS ─► VAD speech-start ─► stop playback + "interrupt" (barge-in)
 *
 * Fallback when the server has no STT/TTS keys: the browser's Web Speech API does recognition
 * and synthesis; the same socket carries text instead of audio.
 */
import type { MicVAD } from "@ricky0123/vad-web";

export type VoicePhase = "off" | "connecting" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking" | "error";

export interface VoiceCallbacks {
  onPhase: (p: VoicePhase, label?: string) => void;
  onTranscript: (text: string) => void;
  onDelta: (text: string) => void;
  onDone: (text: string) => void;
  onApproval: (data: { id: string; summary: string; tier: string }) => void;
  onLevel: (level: number) => void;
  onError: (message: string) => void;
}

export function encodeWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Plays decoded sentences back-to-back; exposes an output level for the orb. */
class Player {
  ctx: AudioContext;
  analyser: AnalyserNode;
  private queue: AudioBuffer[] = [];
  private current: AudioBufferSourceNode | null = null;
  onIdle?: () => void;

  constructor() {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.ctx.destination);
  }

  get playing() {
    return this.current !== null || this.queue.length > 0;
  }

  async enqueue(mp3: ArrayBuffer) {
    try {
      const buf = await this.ctx.decodeAudioData(mp3);
      this.queue.push(buf);
      if (!this.current) this.next();
    } catch {
      /* undecodable chunk — skip */
    }
  }

  private next() {
    const buf = this.queue.shift();
    if (!buf) {
      this.current = null;
      this.onIdle?.();
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    src.onended = () => {
      if (this.current === src) this.next();
    };
    this.current = src;
    src.start();
  }

  stop() {
    this.queue = [];
    const c = this.current;
    this.current = null;
    try {
      c?.stop();
    } catch {
      /* already stopped */
    }
  }

  level(): number {
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data.reduce((a, b) => a + b, 0) / data.length / 255;
  }
}

type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>> }) => void;
  onspeechstart: () => void;
  onend: () => void;
  onerror: (e: { error: string }) => void;
  start: () => void;
  stop: () => void;
};

export class VoiceClient {
  private ws: WebSocket | null = null;
  private vad: MicVAD | null = null;
  private player: Player | null = null;
  private recognition: SR | null = null;
  private pending: Uint8Array[] = [];
  private raf = 0;
  private speakingBrowser = false;
  private sentenceBuf = "";
  mode: { stt: string; tts: string } = { stt: "browser", tts: "browser" };
  active = false;
  private cb: VoiceCallbacks;
  private conversationId?: string;

  constructor(cb: VoiceCallbacks, conversationId?: string) {
    this.cb = cb;
    this.conversationId = conversationId;
  }

  async start() {
    this.active = true;
    this.cb.onPhase("connecting");
    this.player = new Player();
    this.player.onIdle = () => this.active && this.cb.onPhase("listening");
    await this.player.ctx.resume();
    await this.openSocket();
    if (this.mode.stt === "browser") this.startBrowserRecognition();
    else await this.startVad();
    this.cb.onPhase("listening");
    const tick = () => {
      const lvl = this.player?.playing ? this.player.level() : 0;
      this.cb.onLevel(lvl);
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws/voice`);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onmessage = (m) => {
        if (typeof m.data !== "string") {
          this.pending.push(new Uint8Array(m.data as ArrayBuffer));
          return;
        }
        const msg = JSON.parse(m.data);
        switch (msg.type) {
          case "ready":
            this.mode = { stt: msg.stt, tts: msg.tts };
            ws.send(JSON.stringify({ type: "start", conversation_id: this.conversationId, tts: msg.tts === "browser" ? "browser" : "server" }));
            resolve();
            break;
          case "transcript":
            this.cb.onTranscript(msg.text);
            this.cb.onPhase("thinking");
            break;
          case "status":
            if (msg.state === "idle" || msg.state === "interrupted") this.cb.onPhase("listening", msg.label);
            else this.cb.onPhase(msg.state === "transcribing" ? "transcribing" : "thinking", msg.label);
            break;
          case "delta":
            this.cb.onDelta(msg.text);
            if (this.mode.tts === "browser") this.speakBrowserStream(msg.text);
            break;
          case "audio_start":
            this.pending = [];
            this.cb.onPhase("speaking");
            break;
          case "audio_end": {
            const total = this.pending.reduce((a, b) => a + b.length, 0);
            const joined = new Uint8Array(total);
            let off = 0;
            this.pending.forEach((p) => {
              joined.set(p, off);
              off += p.length;
            });
            this.pending = [];
            this.player?.enqueue(joined.buffer);
            break;
          }
          case "tts_unavailable":
            this.mode.tts = "browser";
            break;
          case "approval":
            this.cb.onApproval(msg);
            break;
          case "done":
            if (this.mode.tts === "browser") this.flushBrowserSpeech();
            this.cb.onDone(msg.text);
            if (!this.player?.playing && !this.speakingBrowser) this.cb.onPhase("listening");
            break;
          case "error":
            this.cb.onError(msg.message);
            break;
        }
      };
      ws.onerror = () => reject(new Error("voice socket error"));
      ws.onclose = () => {
        if (this.active) this.cb.onPhase("error", "Соединение закрыто");
      };
    });
  }

  private async startVad() {
    const { MicVAD } = await import("@ricky0123/vad-web");
    this.vad = await MicVAD.new({
      model: "v5",
      baseAssetPath: "/vad/",
      onnxWASMBasePath: "/vad/",
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.4,
      redemptionMs: 600,
      minSpeechMs: 250,
      getStream: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }),
      onSpeechStart: () => {
        this.bargeIn();
        this.cb.onPhase("hearing");
      },
      onVADMisfire: () => this.cb.onPhase("listening"),
      onSpeechEnd: (audio: Float32Array) => {
        this.cb.onPhase("transcribing");
        this.ws?.send(encodeWav(audio));
      },
    } as Parameters<typeof MicVAD.new>[0]);
    await this.vad.start();
  }

  private startBrowserRecognition() {
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
    if (!Ctor) {
      this.cb.onError("Браузер не поддерживает распознавание речи. Используйте Chrome или подключите Deepgram/OpenAI на сервере.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "ru-RU";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onspeechstart = () => {
      this.bargeIn();
      this.cb.onPhase("hearing");
    };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          if (text) this.ws?.send(JSON.stringify({ type: "text", text }));
        }
      }
    };
    rec.onerror = (e) => e.error !== "no-speech" && this.cb.onError(`Распознавание: ${e.error}`);
    rec.onend = () => this.active && rec.start(); // keep listening
    this.recognition = rec;
    rec.start();
  }

  /** User started talking while JARVIS speaks: stop audio and cancel the turn. */
  private bargeIn() {
    const speaking = this.player?.playing || this.speakingBrowser;
    if (speaking) {
      this.player?.stop();
      speechSynthesis.cancel();
      this.speakingBrowser = false;
      this.sentenceBuf = "";
      this.ws?.send(JSON.stringify({ type: "interrupt" }));
    }
  }

  private speakBrowserStream(delta: string) {
    this.sentenceBuf += delta;
    const m = /^([\s\S]*?[.!?…\n])\s/.exec(this.sentenceBuf);
    if (m && m[1].length > 20) {
      this.say(m[1]);
      this.sentenceBuf = this.sentenceBuf.slice(m[0].length);
    }
  }

  private flushBrowserSpeech() {
    if (this.sentenceBuf.trim()) this.say(this.sentenceBuf);
    this.sentenceBuf = "";
  }

  private say(text: string) {
    const clean = text.replace(/[*_`#>]/g, "").trim();
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "ru-RU";
    u.rate = 1.05;
    u.onstart = () => {
      this.speakingBrowser = true;
      this.cb.onPhase("speaking");
    };
    u.onend = () => {
      if (!speechSynthesis.pending) {
        this.speakingBrowser = false;
        if (this.active) this.cb.onPhase("listening");
      }
    };
    speechSynthesis.speak(u);
  }

  sendText(text: string) {
    this.ws?.send(JSON.stringify({ type: "text", text }));
  }

  interrupt() {
    this.bargeIn();
    this.ws?.send(JSON.stringify({ type: "interrupt" }));
  }

  async stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    try {
      this.recognition?.stop();
    } catch {
      /* noop */
    }
    await this.vad?.destroy();
    this.vad = null;
    this.player?.stop();
    await this.player?.ctx.close();
    speechSynthesis.cancel();
    this.ws?.close();
    this.cb.onPhase("off");
  }
}
