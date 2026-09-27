import clsx from "clsx";
import { Hand, Mic, MicOff, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Markdown } from "../components/Markdown";
import { Orb } from "../components/Orb";
import { Badge, Button } from "../components/ui";
import { post } from "../lib/api";
import { type CoreState, useRealtime } from "../lib/realtime";
import { VoiceClient, type VoicePhase } from "../voice/client";

const PHASE_LABEL: Record<VoicePhase, string> = {
  off: "Нажмите, чтобы начать разговор",
  connecting: "Подключаюсь…",
  listening: "Слушаю",
  hearing: "Слышу вас…",
  transcribing: "Распознаю…",
  thinking: "Думаю…",
  speaking: "Говорю — можно перебить",
  error: "Ошибка",
};

const toCore = (p: VoicePhase): CoreState =>
  p === "off" || p === "error" ? "idle" : p === "speaking" ? "speaking" : p === "thinking" || p === "transcribing" ? "thinking" : p === "connecting" ? "thinking" : "listening";

interface Turn {
  role: "user" | "assistant";
  text: string;
}

export function VoicePage() {
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [label, setLabel] = useState<string | undefined>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<{ id: string; summary: string; tier: string } | null>(null);
  const [typed, setTyped] = useState("");
  const client = useRef<VoiceClient | null>(null);
  const setVoiceState = useRealtime((s) => s.setVoiceState);

  useEffect(() => {
    setVoiceState(phase === "off" ? null : toCore(phase));
  }, [phase, setVoiceState]);
  useEffect(() => () => void client.current?.stop(), []);

  const start = async () => {
    setError(null);
    const c = new VoiceClient({
      onPhase: (p, l) => {
        setPhase(p);
        setLabel(l);
      },
      onTranscript: (text) => setTurns((t) => [...t, { role: "user", text }, { role: "assistant", text: "" }]),
      onDelta: (text) =>
        setTurns((t) => {
          const copy = [...t];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") copy[copy.length - 1] = { ...last, text: last.text + text };
          else copy.push({ role: "assistant", text });
          return copy;
        }),
      onDone: () => setApproval(null),
      onApproval: (a) => setApproval(a),
      onLevel: setLevel,
      onError: (m) => setError(m),
    });
    client.current = c;
    try {
      await c.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const stop = async () => {
    await client.current?.stop();
    client.current = null;
  };

  const on = phase !== "off" && phase !== "error";
  const mode = client.current?.mode;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative flex flex-1 flex-col items-center justify-center px-4 pt-8">
        <button onClick={on ? stop : start} className="rounded-full focus-visible:outline-offset-8" aria-label={on ? "Завершить разговор" : "Начать разговор"}>
          <Orb state={toCore(phase)} size={220} level={level} />
        </button>
        <p className={clsx("mt-8 text-sm", phase === "error" ? "text-danger" : "text-muted")}>{label && phase !== "listening" ? label : PHASE_LABEL[phase]}</p>
        {on && mode && (
          <div className="mt-3 flex gap-1.5">
            <Badge tone={mode.stt === "browser" ? "muted" : "accent"}>STT: {mode.stt}</Badge>
            <Badge tone={mode.tts === "browser" ? "muted" : "accent"}>TTS: {mode.tts}</Badge>
          </div>
        )}
        {error && <p className="mt-3 max-w-md text-center text-xs text-danger">{error}</p>}
        {approval && (
          <div className="mt-6 w-full max-w-md rounded-xl border border-warn/30 bg-warn/[0.07] p-4 text-sm">
            <p className="font-medium">Нужно подтверждение</p>
            <p className="mt-1 text-muted">{approval.summary}</p>
            <p className="mt-2 text-xs text-faint">Скажите «да» или «нет», либо нажмите:</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" onClick={async () => { await post(`/api/approvals/${approval.id}`, { approve: true }); setApproval(null); }}>Подтвердить</Button>
              <Button size="sm" onClick={async () => { await post(`/api/approvals/${approval.id}`, { approve: false }); setApproval(null); }}>Отклонить</Button>
            </div>
          </div>
        )}
      </div>

      <div className="relative mx-auto w-full max-w-2xl px-4 pb-6">
        <div className="max-h-[32vh] space-y-3 overflow-y-auto pb-4">
          {turns.slice(-8).map((t, i) => (
            <div key={i} className={clsx("text-sm", t.role === "user" ? "text-right text-muted" : "text-text")}>
              {t.role === "user" ? <span className="inline-block rounded-2xl bg-elevated px-3 py-1.5">{t.text}</span> : <Markdown text={t.text || "…"} />}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant={on ? "danger" : "primary"} size="lg" icon={on ? <MicOff className="size-4" /> : <Mic className="size-4" />} onClick={on ? stop : start}>
            {on ? "Завершить" : "Говорить"}
          </Button>
          {on && (
            <Button variant="secondary" size="lg" icon={<Hand className="size-4" />} onClick={() => client.current?.interrupt()} title="Перебить">
              Перебить
            </Button>
          )}
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim() && client.current) {
                client.current.sendText(typed);
                setTyped("");
              }
            }}
          >
            <input value={typed} onChange={(e) => setTyped(e.target.value)} disabled={!on} placeholder={on ? "…или напечатайте" : ""}
              className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm outline-none placeholder:text-faint disabled:opacity-40" />
            <Button type="submit" size="icon" className="size-11" disabled={!on} aria-label="Отправить"><Send className="size-4" /></Button>
          </form>
        </div>
        <p className="mt-3 text-center text-[11px] text-faint">
          Микрофон слушает постоянно, но детектор речи (VAD) работает прямо в браузере — на сервер уходят только ваши фразы.
          Для «Hey JARVIS» без экрана используйте голосовой сателлит (satellite/).
        </p>
      </div>
    </div>
  );
}
