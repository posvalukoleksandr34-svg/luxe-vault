/**
 * JARVIS desktop widget (/widget): a floating glass window in three columns.
 *
 *   left   — session timer, plan usage, current weather (Open-Meteo via /api/weather)
 *   centre — live voice dialog: the big microphone with ripple rings, status line, dock
 *   right  — the dialog itself (voice or typed), glowing sphere while it is empty
 *
 * Everything shown is real: the microphone starts the same voice session as /voice, the counter is the
 * account's monthly usage, weather comes from the server. Open it as its own window with the
 * "JARVIS Widget" shortcut (scripts/windows/create-shortcuts.ps1) — Edge/Chrome app mode, 1280×720.
 */
import clsx from "clsx";
import {
  Clipboard, Clock3, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun,
  LayoutGrid, Maximize2, Menu, Mic, MicOff, Minimize2, Moon, Send, Settings, Sun, Type, X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { Markdown } from "../components/Markdown";
import { VoiceSettings } from "../components/VoiceSettings";
import { get, post } from "../lib/api";
import { onEvent, useRealtime } from "../lib/realtime";
import type { JarvisEvent } from "../lib/types";
import { VoiceClient, type VoicePhase } from "../voice/client";
import { usePublicConfig } from "./Public";

// ------------------------------------------------------------------------------------------ helpers

type Tone = "cyan" | "violet" | "rose";
const TONES: Record<Tone, { rgb: string; text: string }> = {
  cyan: { rgb: "94 234 212", text: "text-teal-200" },
  violet: { rgb: "167 139 250", text: "text-violet-200" },
  rose: { rgb: "251 113 133", text: "text-rose-200" },
};

const PHASE_TEXT: Record<VoicePhase, string> = {
  off: "Нажмите, чтобы начать живой диалог",
  connecting: "Подключаюсь…",
  listening: "Слушаю",
  hearing: "Слышу вас…",
  transcribing: "Распознаю…",
  thinking: "Думаю…",
  speaking: "Говорю — можно перебить",
  error: "Ошибка — нажмите, чтобы повторить",
};

const toneOf = (p: VoicePhase): Tone => (p === "error" ? "rose" : p === "thinking" || p === "transcribing" ? "violet" : "cyan");

const pad = (n: number) => String(n).padStart(2, "0");
const hms = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;

/** Seeded PRNG so the topographic pattern is stable between renders and reloads. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------ background

/** Contour lines of a few "hills": concentric closed curves with low-frequency wobble. */
function TopoBackground() {
  const paths = useMemo(() => {
    const rand = rng(7);
    const hills = Array.from({ length: 6 }, () => ({
      cx: rand() * 1600, cy: rand() * 900, base: 60 + rand() * 90, rings: 7 + Math.floor(rand() * 6),
      waves: Array.from({ length: 3 }, (_, i) => ({ n: 2 + i + Math.floor(rand() * 3), a: 0.05 + rand() * 0.1, ph: rand() * Math.PI * 2 })),
    }));
    const out: string[] = [];
    for (const h of hills) {
      for (let k = 1; k <= h.rings; k++) {
        const pts: string[] = [];
        for (let i = 0; i <= 96; i++) {
          const t = (i / 96) * Math.PI * 2;
          const wobble = h.waves.reduce((acc, w) => acc + w.a * Math.sin(w.n * t + w.ph + k * 0.35), 0);
          const r = h.base * k * 0.55 * (1 + wobble);
          pts.push(`${(h.cx + r * Math.cos(t)).toFixed(1)},${(h.cy + r * Math.sin(t) * 0.8).toFixed(1)}`);
        }
        out.push(`M${pts.join("L")}Z`);
      }
    }
    return out;
  }, []);
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <radialGradient id="topo-fade" cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="0.35" />
        </radialGradient>
        <mask id="topo-mask"><rect width="1600" height="900" fill="url(#topo-fade)" /></mask>
      </defs>
      <g mask="url(#topo-mask)" fill="none" stroke="rgb(255 255 255 / 0.055)" strokeWidth="1">
        {paths.map((d, i) => <path key={i} d={d} />)}
      </g>
    </svg>
  );
}

// ------------------------------------------------------------------------------------------ building blocks

function Glass({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx(
      "rounded-2xl border border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_20px_50px_-20px_rgb(0_0_0/0.8)] backdrop-blur-xl",
      className,
    )}>
      {children}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-semibold tracking-[0.28em] text-white/40 uppercase">{children}</p>;
}

function IconButton({ label, onClick, children, active }: { label: string; onClick?: () => void; children: ReactNode; active?: boolean }) {
  return (
    <motion.button
      type="button" onClick={onClick} title={label} aria-label={label}
      whileHover={{ scale: 1.12, y: -2 }} whileTap={{ scale: 0.92 }}
      className={clsx(
        "flex size-9 items-center justify-center rounded-xl text-white/55 transition-colors hover:bg-white/10 hover:text-white",
        active && "bg-white/10 text-teal-200",
      )}
    >
      {children}
    </motion.button>
  );
}

// ------------------------------------------------------------------------------------------ left column

interface Account { usage: { metrics: Record<string, { used: number; limit: number | null }> } }
interface Weather { place: string; temp_c: number; conditions: string; code: number; wind_kmh: number; is_day: boolean }

function weatherIcon(code: number, day: boolean) {
  const cls = "size-12 text-teal-200 drop-shadow-[0_0_12px_rgb(94_234_212/0.45)]";
  if (code === 0 || code === 1) return day ? <Sun className={cls} /> : <Moon className={cls} />;
  if (code === 2) return day ? <CloudSun className={cls} /> : <CloudMoon className={cls} />;
  if (code === 45 || code === 48) return <CloudFog className={cls} />;
  if (code >= 51 && code <= 57) return <CloudDrizzle className={cls} />;
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain className={cls} />;
  if (code >= 71 && code <= 77) return <CloudSnow className={cls} />;
  if (code >= 95) return <CloudLightning className={cls} />;
  return <Cloud className={cls} />;
}

function SessionCard({ seconds }: { seconds: number }) {
  const account = useQuery({ queryKey: ["account"], queryFn: () => get<Account>("/api/account"), refetchInterval: 60_000 });
  const m = account.data?.usage.metrics.messages_month;
  const pct = m?.limit ? Math.min(100, (m.used / m.limit) * 100) : 0;
  return (
    <Glass className="p-5">
      <Label>Сессия</Label>
      <p className="mt-4 font-mono text-4xl font-medium tracking-wider text-white tabular-nums [text-shadow:0_0_24px_rgb(94_234_212/0.35)]">
        {hms(seconds)}
      </p>
      <p className="mt-1 text-[10px] tracking-[0.25em] text-white/35 uppercase">Время сессии</p>
      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <p className="font-mono text-sm text-white/80 tabular-nums">
          {m ? `${Math.round(m.used)} / ${m.limit !== null ? Math.round(m.limit) : "∞"}` : "— / —"}
          <span className="ml-2 text-[10px] tracking-[0.2em] text-white/35 uppercase">запросов / месяц</span>
        </p>
        {m?.limit ? (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div className={clsx("h-full rounded-full", pct >= 90 ? "bg-rose-300" : "bg-teal-300")}
              initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
          </div>
        ) : null}
      </div>
    </Glass>
  );
}

function WeatherCard() {
  const [place, setPlace] = useState(() => {
    try { return localStorage.getItem("jarvis.widget.place") || "Краснодар"; } catch { return "Краснодар"; }
  });
  const [editing, setEditing] = useState(false);
  const w = useQuery({
    queryKey: ["weather", place], queryFn: () => get<Weather>(`/api/weather?place=${encodeURIComponent(place)}`),
    refetchInterval: 15 * 60_000, retry: 0,
  });
  const save = (v: string) => {
    const next = v.trim() || place;
    setPlace(next);
    setEditing(false);
    try { localStorage.setItem("jarvis.widget.place", next); } catch { /* private mode */ }
  };
  return (
    <Glass className="p-5">
      <Label>Погода</Label>
      {editing ? (
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); save(new FormData(e.currentTarget).get("p") as string); }}>
          <input name="p" defaultValue={place} autoFocus onBlur={(e) => save(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white outline-none focus:border-teal-300/50" />
        </form>
      ) : (
        <button type="button" onClick={() => setEditing(true)} title="Сменить город"
          className="mt-3 text-left text-sm text-white/70 hover:text-white">
          {w.data?.place ?? place}
        </button>
      )}
      {w.isError ? (
        <p className="mt-4 text-xs text-rose-200/80">Погода недоступна{w.error instanceof Error ? `: ${w.error.message}` : ""}</p>
      ) : (
        <div className="mt-3 flex items-center justify-between">
          <p className="font-mono text-5xl font-light text-white tabular-nums">
            {w.data ? `${Math.round(w.data.temp_c)}°` : "—"}<span className="text-2xl text-white/50">C</span>
          </p>
          <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
            {weatherIcon(w.data?.code ?? 2, w.data?.is_day ?? true)}
          </motion.div>
        </div>
      )}
      {w.data && (
        <p className="mt-3 text-[11px] tracking-[0.15em] text-white/45 uppercase">
          {w.data.conditions}<span className="mx-1.5 text-white/20">·</span>
          <span className="normal-case tracking-normal">Ветер {Math.round(w.data.wind_kmh)} км/ч</span>
        </p>
      )}
    </Glass>
  );
}

// ------------------------------------------------------------------------------------------ centre

function MicOrb({ phase, level, onClick }: { phase: VoicePhase; level: number; onClick: () => void }) {
  const tone = TONES[toneOf(phase)];
  const on = phase !== "off" && phase !== "error";
  const busy = phase === "listening" || phase === "hearing" || phase === "speaking";
  const lvl = Math.min(1, level * 3);
  return (
    <div className="relative flex size-[min(44vh,340px)] items-center justify-center">
      {/* expanding ripples */}
      {[0, 1, 2, 3].map((i) => (
        <motion.span key={i} className="absolute inset-[22%] rounded-full border"
          style={{ borderColor: `rgb(${tone.rgb} / 0.55)`, boxShadow: `0 0 24px rgb(${tone.rgb} / 0.25), inset 0 0 18px rgb(${tone.rgb} / 0.12)` }}
          initial={{ scale: 1, opacity: 0 }}
          animate={{ scale: busy ? 2.3 : 1.9, opacity: [0, busy ? 0.7 : 0.45, 0] }}
          transition={{ duration: busy ? 2.2 : 3.6, repeat: Infinity, delay: i * (busy ? 0.55 : 0.9), ease: "easeOut" }} />
      ))}
      {/* static halo rings */}
      <span className="absolute inset-[8%] rounded-full border border-white/[0.05]" />
      <span className="absolute inset-[16%] rounded-full border border-dashed border-white/[0.07]" />
      {/* reactive glow */}
      <motion.span className="absolute inset-[24%] rounded-full blur-2xl"
        style={{ background: `radial-gradient(circle, rgb(${tone.rgb} / 0.55), transparent 70%)` }}
        animate={{ scale: on ? 1 + lvl * 0.35 : [1, 1.08, 1], opacity: on ? 0.55 + lvl * 0.4 : [0.35, 0.55, 0.35] }}
        transition={on ? { duration: 0.12 } : { duration: 3, repeat: Infinity, ease: "easeInOut" }} />
      {/* the button */}
      <motion.button
        type="button" onClick={onClick} aria-label={on ? "Завершить диалог" : "Начать живой диалог"}
        whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
        animate={phase === "thinking" ? { rotate: 360 } : { rotate: 0 }}
        transition={phase === "thinking" ? { duration: 6, repeat: Infinity, ease: "linear" } : { duration: 0.3 }}
        className="relative flex size-[30%] min-h-24 min-w-24 items-center justify-center rounded-full border border-white/15 backdrop-blur-xl"
        style={{
          background: `radial-gradient(circle at 35% 30%, rgb(255 255 255 / 0.22), rgb(${tone.rgb} / 0.16) 45%, rgb(10 14 18 / 0.85) 75%)`,
          boxShadow: `0 0 40px rgb(${tone.rgb} / ${on ? 0.55 : 0.3}), 0 0 90px rgb(${tone.rgb} / ${on ? 0.3 : 0.12}), inset 0 1px 1px rgb(255 255 255 / 0.25)`,
        }}
      >
        {on ? <Mic className={clsx("size-9", tone.text)} /> : <Mic className="size-9 text-white/85" />}
      </motion.button>
    </div>
  );
}

function Dock({ onMenu, onClipboard, onClock, onSettings, onType, typing }: {
  onMenu: () => void; onClipboard: () => void; onClock: () => void; onSettings: () => void; onType: () => void; typing: boolean;
}) {
  return (
    <motion.nav initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3, type: "spring", stiffness: 180, damping: 20 }}
      className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.06] p-1.5 shadow-[0_10px_40px_-10px_rgb(0_0_0/0.9)] backdrop-blur-2xl"
      aria-label="Панель инструментов">
      <IconButton label="Полный интерфейс" onClick={onMenu}><Menu className="size-4" /></IconButton>
      <IconButton label="Отправить текст из буфера обмена" onClick={onClipboard}><Clipboard className="size-4" /></IconButton>
      <IconButton label="Напоминания и автоматизации" onClick={onClock}><Clock3 className="size-4" /></IconButton>
      <IconButton label="Настройки голоса" onClick={onSettings}><Settings className="size-4" /></IconButton>
      <span className="mx-1 h-5 w-px bg-white/10" />
      <IconButton label="Написать текстом" onClick={onType} active={typing}><Type className="size-4" /></IconButton>
    </motion.nav>
  );
}

// ------------------------------------------------------------------------------------------ right column

function GlowSphere() {
  return (
    <motion.div className="relative size-28" animate={{ y: [0, -8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
      <motion.div className="absolute -inset-6 rounded-full bg-teal-300/20 blur-3xl"
        animate={{ opacity: [0.4, 0.8, 0.4], scale: [0.9, 1.05, 0.9] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} />
      <div className="absolute inset-0 rounded-full"
        style={{
          background: "radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.95), rgb(153 246 228 / 0.85) 18%, rgb(45 212 191 / 0.55) 42%, rgb(15 60 70 / 0.9) 72%, rgb(5 10 14) 100%)",
          boxShadow: "0 0 50px rgb(45 212 191 / 0.45), inset -10px -14px 30px rgb(0 0 0 / 0.55)",
        }} />
      <motion.div className="absolute inset-[-10%] rounded-full border border-teal-200/20"
        animate={{ rotate: 360 }} transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        style={{ borderTopColor: "rgb(153 246 228 / 0.7)" }} />
    </motion.div>
  );
}

interface Turn { id: string; role: "user" | "assistant"; text: string }

/** Streamed reply: append to (or replace) the assistant turn at the end, creating it if needed. */
function withAssistant(turns: Turn[], text: string, append: boolean): Turn[] {
  const last = turns[turns.length - 1];
  if (last?.role === "assistant") return [...turns.slice(0, -1), { ...last, text: append ? last.text + text : text }];
  return [...turns, { id: crypto.randomUUID(), role: "assistant", text }];
}

function DialogPanel({ turns }: { turns: Turn[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [turns]);
  return (
    <Glass className="flex min-h-0 flex-1 flex-col p-5">
      <Label>Диалог</Label>
      {turns.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <GlowSphere />
          <p className="text-sm text-white/40">Диалог пока пуст</p>
        </div>
      ) : (
        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin]">
          <AnimatePresence initial={false}>
            {turns.map((t) => (
              <motion.div key={t.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className={clsx("max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm",
                  t.role === "user" ? "ml-auto bg-teal-300/10 text-teal-50" : "bg-white/[0.05] text-white/85")}>
                {t.role === "assistant" ? <Markdown text={t.text || "…"} /> : t.text}
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={end} />
        </div>
      )}
    </Glass>
  );
}

// ------------------------------------------------------------------------------------------ the widget

export function WidgetPage() {
  const navigate = useNavigate();
  const cfg = usePublicConfig();
  const setVoiceState = useRealtime((s) => s.setVoiceState);
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [label, setLabel] = useState<string | undefined>();
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [settings, setSettings] = useState(false);
  const client = useRef<VoiceClient | null>(null);
  const pendingTask = useRef<string | null>(null);
  // a fast reply can arrive before POST /api/chat returns its task id: keep recent events to replay
  const early = useRef<JarvisEvent[]>([]);
  const on = phase !== "off" && phase !== "error";

  // session timer: runs while the live dialog is on
  useEffect(() => {
    if (!on) return;
    const started = Date.now() - seconds * 1000;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  useEffect(() => setVoiceState(on ? (phase === "speaking" ? "speaking" : phase === "thinking" ? "thinking" : "listening") : null), [on, phase, setVoiceState]);
  useEffect(() => () => void client.current?.stop(), []);

  // typed messages without a voice session: follow the task's events
  const applyEvent = (e: JarvisEvent) => {
    if (e.type === "message.delta") setTurns((t) => withAssistant(t, String(e.data?.text ?? ""), true));
    if (e.type === "message.completed") {
      const text = e.data?.message?.content;
      if (typeof text === "string") setTurns((t) => withAssistant(t, text, false));
      pendingTask.current = null;
    }
  };
  useEffect(() => onEvent((e) => {
    if (e.type !== "message.delta" && e.type !== "message.completed") return;
    if (pendingTask.current && e.task_id === pendingTask.current) applyEvent(e);
    else early.current = [...early.current, e].slice(-50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const appendAssistant = (text: string) => setTurns((t) => withAssistant(t, text, true));

  const start = async () => {
    setError(null);
    setSeconds(0);
    const c = new VoiceClient({
      onPhase: (p, l) => { setPhase(p); setLabel(l); },
      onTranscript: (text) => setTurns((t) => [...t, { id: crypto.randomUUID(), role: "user", text }, { id: crypto.randomUUID(), role: "assistant", text: "" }]),
      onDelta: appendAssistant,
      onDone: () => undefined,
      onApproval: (a) => appendAssistant(`\n\n> Нужно подтверждение: ${a.summary}. Скажите «да» или «нет».`),
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
    setPhase("off");
    setLevel(0);
  };

  const send = async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTurns((t) => [...t, { id: crypto.randomUUID(), role: "user", text: clean }]);
    if (client.current && on) {
      client.current.sendText(clean);
      return;
    }
    try {
      const r = await post<{ task_id: string | null }>("/api/chat", { text: clean });
      setTurns((t) => [...t, { id: crypto.randomUUID(), role: "assistant", text: "" }]);
      pendingTask.current = r.task_id;
      const missed = early.current.filter((e) => e.task_id === r.task_id);
      early.current = early.current.filter((e) => e.task_id !== r.task_id);
      missed.forEach(applyEvent);
    } catch (e) {
      setTurns((t) => [...t, { id: crypto.randomUUID(), role: "assistant", text: `⚠️ ${e instanceof Error ? e.message : String(e)}` }]);
    }
  };

  const fromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) await send(text.slice(0, 20000));
      else setError("Буфер обмена пуст");
    } catch {
      setError("Нет доступа к буферу обмена — разрешите его браузеру");
    }
  };

  const status = error && phase !== "off" ? error : label && phase !== "listening" ? label : PHASE_TEXT[phase];
  const name = (cfg.data?.product_name ?? "JARVIS").toUpperCase();

  return (
    <div className="flex h-dvh items-center justify-center bg-[#050607] p-0 sm:p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative flex h-full w-full max-w-[1600px] flex-col overflow-hidden bg-[#0b0d10] text-white sm:aspect-video sm:h-auto sm:max-h-full sm:rounded-2xl sm:border sm:border-white/[0.08] sm:shadow-[0_40px_120px_-30px_rgb(0_0_0/0.95)]"
      >
        <TopoBackground />
        <div className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[60%] -translate-x-1/2 rounded-full bg-teal-400/[0.07] blur-3xl" />

        {/* title bar (Windows 11 style, drag region in app mode) */}
        <header className="relative z-10 flex h-10 shrink-0 items-center gap-2 px-4 [-webkit-app-region:drag]">
          <span className="size-2 rounded-full bg-teal-300 shadow-[0_0_10px_rgb(94_234_212/0.9)]" />
          <span className="text-[11px] tracking-[0.2em] text-white/45">{name}</span>
          <div className="ml-auto flex items-center gap-0.5 [-webkit-app-region:no-drag]">
            <IconButton label="Компактное окно" onClick={() => navigate("/mini")}><Minimize2 className="size-3.5" /></IconButton>
            <IconButton label="Полный интерфейс" onClick={() => navigate("/")}><Maximize2 className="size-3.5" /></IconButton>
            <IconButton label="Закрыть окно" onClick={() => window.close()}><X className="size-3.5" /></IconButton>
          </div>
        </header>

        <main className="relative z-10 grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto px-4 pb-4 md:content-stretch md:overflow-visible md:grid-cols-[minmax(220px,1fr)_minmax(0,1.6fr)_minmax(240px,1.1fr)] md:gap-5 md:px-6 md:pb-6">
          {/* left */}
          <section className="order-2 flex flex-col gap-4 md:order-1 md:min-h-0" aria-label="Информация">
            <SessionCard seconds={seconds} />
            <WeatherCard />
          </section>

          {/* centre */}
          <section className="order-1 flex min-h-[420px] flex-col items-center md:order-2" aria-label="Голос">
            <p className="text-[11px] font-medium tracking-[0.45em] text-white/35">{name} ASSISTANT</p>
            <div className="flex flex-1 flex-col items-center justify-center">
              <MicOrb phase={phase} level={level} onClick={on ? stop : start} />
              <AnimatePresence mode="wait">
                <motion.p key={status} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  className={clsx("mt-2 max-w-md text-center text-[11px] tracking-[0.3em] uppercase",
                    phase === "error" || (error && on) ? "text-rose-200/80" : "text-white/40")}>
                  {status}
                </motion.p>
              </AnimatePresence>
              {on && (
                <button type="button" onClick={() => client.current?.interrupt()}
                  className="mt-3 flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-[10px] tracking-[0.2em] text-white/45 uppercase hover:text-white">
                  <MicOff className="size-3" /> перебить
                </button>
              )}
            </div>
            <AnimatePresence>
              {typing && (
                <motion.form key="typing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                  onSubmit={(e) => { e.preventDefault(); void send(draft); setDraft(""); }}
                  className="mb-3 flex w-full max-w-md items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] p-1.5 backdrop-blur-xl">
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus placeholder="Напишите JARVIS…"
                    className="min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-white/30" />
                  <IconButton label="Отправить" onClick={() => { void send(draft); setDraft(""); }}><Send className="size-4" /></IconButton>
                </motion.form>
              )}
            </AnimatePresence>
            <Dock onMenu={() => navigate("/")} onClipboard={fromClipboard} onClock={() => navigate("/automations")}
              onSettings={() => setSettings(true)} onType={() => setTyping((v) => !v)} typing={typing} />
          </section>

          {/* right */}
          <section className="order-3 flex min-h-[360px] flex-col gap-3 md:min-h-0" aria-label="Диалог">
            <DialogPanel turns={turns} />
            <div className="flex justify-end gap-1">
              <IconButton label="Все разделы JARVIS" onClick={() => navigate("/")}><LayoutGrid className="size-4" /></IconButton>
              <IconButton label="Настройки" onClick={() => navigate("/settings")}><Settings className="size-4" /></IconButton>
            </div>
          </section>
        </main>

        {/* voice settings sheet */}
        <AnimatePresence>
          {settings && (
            <motion.div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSettings(false)}>
              <motion.div initial={{ y: 20, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="max-h-full w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0f1216]/95 p-5 backdrop-blur-2xl">
                <div className="mb-4 flex items-center">
                  <Label>Голос JARVIS</Label>
                  <button type="button" onClick={() => setSettings(false)} className="ml-auto text-white/40 hover:text-white" aria-label="Закрыть">
                    <X className="size-4" />
                  </button>
                </div>
                <VoiceSettings onSaved={() => client.current?.reloadProfile()} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
