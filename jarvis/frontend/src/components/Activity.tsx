import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell, Bot, CheckCircle2, CircleAlert, MessageSquare, ShieldAlert, ShieldCheck, Wrench, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { get } from "../lib/api";
import { TASK_KIND, TASK_STATUS, ago, ms, time } from "../lib/format";
import { useRealtime } from "../lib/realtime";
import type { JarvisEvent, Task, ToolCallRow } from "../lib/types";
import { Empty } from "./ui";

function describe(e: JarvisEvent): { icon: ReactNode; text: ReactNode; tone?: string } | null {
  const d = e.data ?? {};
  switch (e.type) {
    case "tool.started":
      return { icon: <Wrench className="size-3.5" />, text: <>{d.activity || d.tool}<span className="text-faint"> · {d.tool}</span></> };
    case "tool.finished":
      return d.ok
        ? { icon: <CheckCircle2 className="size-3.5" />, text: <>{d.tool} <span className="text-faint">· {d.duration_ms ?? 0} мс</span></>, tone: "text-ok" }
        : { icon: <XCircle className="size-3.5" />, text: <>{d.tool}: {d.error || d.status || "ошибка"}</>, tone: "text-danger" };
    case "approval.requested":
      return { icon: <ShieldAlert className="size-3.5" />, text: <>Нужно подтверждение: {d.summary}</>, tone: "text-warn" };
    case "approval.resolved":
      return { icon: <ShieldCheck className="size-3.5" />, text: <>{d.status === "approved" ? "Подтверждено" : "Отклонено"}: {d.tool}</> };
    case "notification":
      return { icon: <Bell className="size-3.5" />, text: d.title, tone: "text-accent" };
    case "message.completed":
      return { icon: <Bot className="size-3.5" />, text: <>Ответ: {String(d.message?.content ?? "").slice(0, 90)}</> };
    case "message.created":
      return d.message?.role === "user"
        ? { icon: <MessageSquare className="size-3.5" />, text: <>{d.message?.channel !== "web" ? `[${d.message?.channel}] ` : ""}{String(d.message?.content ?? "").slice(0, 90)}</> }
        : null;
    case "task.updated": {
      if (d.kind === "memory_extract") return null;
      const st = TASK_STATUS[d.status as Task["status"]];
      if (!st || d.status === "queued") return null;
      return {
        icon: d.status === "failed" ? <CircleAlert className="size-3.5" /> : <Bot className="size-3.5" />,
        text: <>{TASK_KIND[d.kind] ?? d.kind}: {d.title || "задача"} — {st.label}</>,
        tone: d.status === "failed" ? "text-danger" : undefined,
      };
    }
    default:
      return null;
  }
}

export function ActivityFeed({ limit = 40, className }: { limit?: number; className?: string }) {
  const events = useRealtime((s) => s.events);
  const rows = events.map((e) => ({ e, d: describe(e) })).filter((x) => x.d).slice(0, limit);
  const history = useQuery({
    queryKey: ["tool-log", "recent"],
    queryFn: () => get<{ calls: ToolCallRow[] }>("/api/logs/tools?limit=20"),
    enabled: rows.length === 0,
  });
  if (!rows.length) {
    const calls = history.data?.calls ?? [];
    if (!calls.length)
      return <Empty title="Пока тихо">Здесь в реальном времени появляются действия JARVIS: инструменты, задачи, подтверждения.</Empty>;
    return (
      <div>
        <p className="px-2 pt-1 pb-2 text-[11px] text-faint">Недавние действия</p>
        <ol className={clsx("space-y-0.5", className)}>
          {calls.map((c) => (
            <li key={c.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-hover">
              <span className={clsx("mt-0.5 shrink-0", c.status === "succeeded" ? "text-ok" : c.status === "failed" ? "text-danger" : "text-muted")}>
                {c.status === "failed" ? <XCircle className="size-3.5" /> : <Wrench className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1 text-muted [overflow-wrap:anywhere]">
                {c.tool}<span className="text-faint"> · {c.task} · {ms(c.duration_ms)}</span>
              </span>
              <time className="shrink-0 text-[10.5px] text-faint">{ago(c.at)}</time>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <ol className={clsx("space-y-0.5", className)}>
      {rows.map(({ e, d }, i) => (
        <li key={`${e.ts}-${i}`} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-hover">
          <span className={clsx("mt-0.5 shrink-0 text-muted", d!.tone)}>{d!.icon}</span>
          <span className="min-w-0 flex-1 text-muted [overflow-wrap:anywhere]">{d!.text}</span>
          <time className="shrink-0 font-mono text-[10.5px] text-faint tabular">{time(e.ts)}</time>
        </li>
      ))}
    </ol>
  );
}
