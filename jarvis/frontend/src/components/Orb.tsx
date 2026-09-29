import clsx from "clsx";

import type { CoreState } from "../lib/realtime";

const LABEL: Record<CoreState, string> = {
  offline: "Нет связи",
  idle: "На связи",
  thinking: "Думаю",
  tool: "Выполняю",
  waiting: "Жду подтверждения",
  speaking: "Говорю",
  listening: "Слушаю",
  error: "Ошибка",
};

/**
 * The JARVIS core. Idle: slow breathing. Listening: the core follows your voice (mic level).
 * Thinking: fast arcs. Executing: arcs + a second counter-rotating ring. Speaking: follows JARVIS's
 * own audio. Waiting for approval: amber. Error: red. Respects prefers-reduced-motion via CSS.
 */
export function Orb({ state, size = 40, level = 0, showLabel = false }: { state: CoreState; size?: number; level?: number; showLabel?: boolean }) {
  const active = state === "thinking" || state === "tool";
  const color = state === "waiting" ? "var(--warn)" : state === "error" ? "var(--danger)" : state === "offline" ? "var(--faint)"
    : state === "tool" ? "var(--violet, var(--accent))" : "var(--accent)";
  const reactive = state === "listening" || state === "speaking";
  const scale = 1 + (reactive ? Math.min(level, 1) * 0.22 : 0);
  const halo = reactive ? 0.45 + Math.min(level, 1) * 0.55 : 0.6;
  return (
    <div className="flex items-center gap-2.5" aria-live="polite">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <div
          className="absolute inset-0 rounded-full blur-md transition-opacity duration-100"
          style={{ background: `radial-gradient(circle, ${color} 0%, transparent 65%)`, opacity: state === "offline" ? 0 : halo }}
        />
        <svg viewBox="0 0 100 100" className="absolute inset-0">
          <circle cx="50" cy="50" r="44" fill="none" stroke={color} strokeOpacity="0.18" strokeWidth="2" />
          <g className={clsx(active ? "animate-spin-fast" : "animate-spin-slow")} style={{ transformOrigin: "50px 50px" }}>
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={active ? "40 236" : "14 262"}
            />
          </g>
          <g
            className={clsx(active && "animate-spin-slow")}
            style={{ transformOrigin: "50px 50px", animationDirection: "reverse" }}
          >
            <circle cx="50" cy="50" r="34" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 7" />
          </g>
          {state === "tool" && (
            <g className="animate-spin-fast" style={{ transformOrigin: "50px 50px", animationDirection: "reverse" }}>
              <circle cx="50" cy="50" r="39" fill="none" stroke={color} strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="10 30" />
            </g>
          )}
        </svg>
        <div
          className={clsx("absolute rounded-full transition-transform duration-100", state === "idle" && "animate-breathe")}
          style={{
            inset: size * 0.3,
            transform: `scale(${scale})`,
            background: `radial-gradient(circle at 40% 35%, #ffffff 0%, ${color} 45%, color-mix(in srgb, ${color} 30%, black) 100%)`,
            boxShadow: `0 0 ${size / 3}px ${color}`,
            opacity: state === "offline" ? 0.4 : 1,
          }}
        />
      </div>
      {showLabel && (
        <div className="leading-tight">
          <p className="text-[13px] font-semibold tracking-[0.18em] text-text">JARVIS</p>
          <p className={clsx("text-[11px]", state === "waiting" ? "text-warn" : state === "offline" ? "text-faint" : "text-muted")}>
            {LABEL[state]}
          </p>
        </div>
      )}
    </div>
  );
}
