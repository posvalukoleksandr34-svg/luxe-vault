import clsx from "clsx";
import { Ear, Hand, Maximize2, Mic, MicOff, Send, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { Markdown } from "../components/Markdown";
import { Orb } from "../components/Orb";
import { Badge, Button, Drawer } from "../components/ui";
import { VoiceSettings } from "../components/VoiceSettings";
import { post } from "../lib/api";
import { type CoreState, useRealtime } from "../lib/realtime";
import { VoiceClient, type VoicePhase, type VoiceProfile } from "../voice/client";

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
  p === "off" ? "idle" : p === "error" ? "error" : p === "speaking" ? "speaking" : p === "thinking" || p === "transcribing" ? "thinking" : p === "connecting" ? "thinking" : "listening";

interface Turn {
  role: "user" | "assistant";
  text: string;
}

/** Full voice screen; `compact` = the small always-handy window at /mini (no sidebar, fewer turns). */
export function VoicePage({ compact = false }: { compact?: boolean }) {
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [label, setLabel] = useState<string | undefined>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<{ id: string; summary: string; tier: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [ignored, setIgnored] = useState<string | null>(null);
  const [awake, setAwake] = useState(false);
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
      onTranscript: (text) => {
        setIgnored(null);
        setTurns((t) => [...t, { role: "user", text }, { role: "assistant", text: "" }]);
      },
      onIgnored: (text) => setIgnored(text),
      onWake: () => {
        setAwake(true);
        setTimeout(() => setAwake(false), 1500);
      },
      onProfile: setProfile,
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
      {compact && (
        <Link to="/" className="absolute top-3 right-3 z-10 rounded-lg p-2 text-faint hover:text-text" title="Открыть полный интерфейс" aria-label="Открыть полный интерфейс">
          <Maximize2 className="size-4" />
        </Link>
      )}
      <div className={clsx("relative flex flex-1 flex-col items-center justify-center px-4", compact ? "pt-4" : "pt-8")}>
        <button onClick={on ? stop : start} className="rounded-full focus-visible:outline-offset-8" aria-label={on ? "Завершить разговор" : "Начать разговор"}>
          <Orb state={toCore(phase)} size={compact ? 140 : 220} level={level} />
        </button>
        <p className={clsx(compact ? "mt-5 text-sm" : "mt-8 text-sm", phase === "error" ? "text-danger" : "text-muted")}>{label && phase !== "listening" ? label : PHASE_LABEL[phase]}</p>
        {on && mode && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            <Badge tone={mode.stt === "browser" ? "muted" : "accent"}>STT: {mode.stt}</Badge>
            <Badge tone={mode.tts === "browser" ? "muted" : "accent"}>TTS: {mode.tts}{profile?.voice_name ? ` · ${profile.voice_name}` : ""}</Badge>
            {profile?.hands_free && (
              <Badge tone={awake ? "accent" : "muted"} dot>
                <Ear className="size-3" /> скажите «{profile.wake_words[0] ?? "джарвис"}»
              </Badge>
            )}
          </div>
        )}
        {ignored && profile?.hands_free && (
          <p className="mt-2 max-w-md truncate text-center text-[11px] text-faint" title={ignored}>не для меня: «{ignored}»</p>
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

      <div className={clsx("relative mx-auto w-full max-w-2xl px-4", compact ? "pb-3" : "pb-6")}>
        <div className={clsx("space-y-3 overflow-y-auto pb-4", compact ? "max-h-[28vh]" : "max-h-[32vh]")}>
          {turns.slice(compact ? -3 : -8).map((t, i) => (
            <div key={i} className={clsx("text-sm", t.role === "user" ? "text-right text-muted" : "text-text")}>
              {t.role === "user" ? <span className="inline-block rounded-2xl bg-elevated px-3 py-1.5">{t.text}</span> : <Markdown text={t.text || "…"} />}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant={on ? "danger" : "primary"} size="lg" icon={on ? <MicOff className="size-4" /> : <Mic className="size-4" />} onClick={on ? stop : start}>
            {compact ? null : on ? "Завершить" : "Говорить"}
          </Button>
          {on && !compact && (
            <Button variant="secondary" size="lg" icon={<Hand className="size-4" />} onClick={() => client.current?.interrupt()} title="Перебить">
              Перебить
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-11" onClick={() => setSettingsOpen(true)} aria-label="Настройки голоса" title="Голос JARVIS">
            <SlidersHorizontal className="size-4" />
          </Button>
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
        {!compact && <p className="mt-3 text-center text-[11px] text-faint">
          Микрофон слушает постоянно, но детектор речи (VAD) работает прямо в браузере — на сервер уходят только ваши фразы.
          Режим без рук и выбор голоса — кнопка настроек. Для «Hey JARVIS» без экрана — голосовой сателлит (satellite/).
        </p>}
      </div>
      <Drawer open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Голос JARVIS">
        <VoiceSettings onSaved={() => client.current?.reloadProfile()} />
      </Drawer>
    </div>
  );
}
