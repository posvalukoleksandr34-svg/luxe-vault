import type { MemoryKind, Risk, Task, Tier } from "./types";

const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "только что";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function time(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function usd(v: number | null | undefined, digits = 2): string {
  const n = v ?? 0;
  if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(digits)}`;
}

export function compact(n: number | null | undefined): string {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(n ?? 0);
}

export function ms(v: number | null | undefined): string {
  if (v == null) return "—";
  return v < 1000 ? `${v} мс` : `${(v / 1000).toFixed(1)} с`;
}

export const TASK_STATUS: Record<Task["status"], { label: string; tone: Tone }> = {
  queued: { label: "в очереди", tone: "muted" },
  running: { label: "выполняется", tone: "accent" },
  waiting_approval: { label: "ждёт подтверждения", tone: "warn" },
  succeeded: { label: "готово", tone: "ok" },
  failed: { label: "ошибка", tone: "danger" },
  cancelled: { label: "отменено", tone: "muted" },
};

export const TASK_KIND: Record<string, string> = {
  agent_turn: "Диалог",
  background: "Фоновая",
  subagent: "Под-агент",
  automation_run: "Автоматизация",
  memory_extract: "Память",
};

export const TIER: Record<Tier, { label: string; tone: Tone; hint: string }> = {
  autonomous: { label: "автономно", tone: "ok", hint: "Выполняется без вопросов" },
  confirm: { label: "с подтверждением", tone: "warn", hint: "Одно «да» в любом канале" },
  restricted: { label: "ограничено", tone: "danger", hint: "Только в веб-интерфейсе с повторным входом" },
  forbidden: { label: "запрещено", tone: "muted", hint: "Недоступно агенту" },
};

export const RISK: Record<Risk, { label: string; tone: Tone }> = {
  read: { label: "чтение", tone: "muted" },
  write: { label: "запись", tone: "accent" },
  external: { label: "внешнее", tone: "warn" },
  high: { label: "высокий риск", tone: "danger" },
};

export const MEMORY_KIND: Record<MemoryKind, { label: string; tone: Tone }> = {
  profile: { label: "Профиль", tone: "accent" },
  semantic: { label: "Факт", tone: "muted" },
  episodic: { label: "Событие", tone: "violet" },
  project: { label: "Проект", tone: "ok" },
  relationship: { label: "Люди", tone: "warn" },
  important: { label: "Важное", tone: "danger" },
};

export type Tone = "accent" | "ok" | "warn" | "danger" | "muted" | "violet";

export const CHANNEL: Record<string, string> = {
  web: "Web",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  voice: "Голос",
  automation: "Автоматизация",
};
