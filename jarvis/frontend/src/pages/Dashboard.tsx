import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CalendarDays, Cpu, Send, Zap } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { ActivityFeed } from "../components/Activity";
import { ApprovalCard } from "../components/Approvals";
import { BarChart } from "../components/BarChart";
import { Orb } from "../components/Orb";
import { Badge, Button, Card, Empty, Stat } from "../components/ui";
import { get, post } from "../lib/api";
import { useMe } from "../lib/auth";
import { TASK_KIND, TASK_STATUS, ago, compact, ms, usd } from "../lib/format";
import { coreStateFrom, useRealtime } from "../lib/realtime";
import type { Approval, Automation, CalendarEvent, Stats, SystemStatus, Task } from "../lib/types";

const SHORTCUTS = [
  "Что у меня сегодня?",
  "Разбери входящие письма и скажи, что требует ответа",
  "Спланируй мой завтрашний день",
  "Каждый будний день в 7:30 присылай утренний брифинг",
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
}

export function DashboardPage() {
  const me = useMe();
  const navigate = useNavigate();
  const { status, connected, voiceState } = useRealtime();
  const core = coreStateFrom(status, connected, voiceState);
  const [ask, setAsk] = useState("");
  const [sending, setSending] = useState(false);
  const sys = useQuery({ queryKey: ["system"], queryFn: () => get<SystemStatus>("/api/system/status") });
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => get<Stats>("/api/stats?days=14"), refetchInterval: 60_000 });
  const approvals = useQuery({ queryKey: ["approvals"], queryFn: () => get<{ approvals: Approval[] }>("/api/approvals") });
  const tasks = useQuery({ queryKey: ["tasks", "recent"], queryFn: () => get<{ tasks: Task[] }>("/api/tasks?limit=8&kind=agent_turn,background,automation_run") });
  const calendar = useQuery({ queryKey: ["calendar", 2], queryFn: () => get<{ source: string; events: CalendarEvent[] }>("/api/calendar?days=2") });
  const automations = useQuery({ queryKey: ["automations"], queryFn: () => get<{ automations: Automation[] }>("/api/automations") });

  const send = async (text: string) => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const r = await post<{ conversation_id: string }>("/api/chat", { text });
      navigate(`/chat/${r.conversation_id}`);
    } finally {
      setSending(false);
    }
  };

  const s = stats.data;
  const upcoming = (automations.data?.automations ?? []).filter((a) => a.enabled && a.next_run_at).slice(0, 5);
  const workersOnline = (sys.data?.workers ?? []).filter((w) => Date.now() / 1000 - w.seen_at < 40).length;
  const daily = (s?.llm.daily ?? []).map((d) => ({
    key: d.day,
    label: new Date(d.day).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }),
    value: d.cost_usd,
    sub: `${d.calls} вызовов`,
  }));

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface px-5 py-6 sm:px-8">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className="flex items-center gap-5">
            <Orb state={core} size={76} />
            <div>
              <p className="text-sm text-muted">{greeting()},</p>
              <h1 className="text-2xl font-semibold tracking-tight">{me.data?.user.display_name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <Badge tone={sys.data?.brain.configured ? "accent" : "warn"} dot>
                  <Cpu className="size-3" /> {sys.data?.brain.main_model ?? "…"}
                </Badge>
                <Badge tone={workersOnline || sys.data?.embedded_worker ? "ok" : "danger"} dot>
                  воркеров: {sys.data?.embedded_worker ? "встроенный" : workersOnline}
                </Badge>
                <Badge tone="muted">очередь: {sys.data?.queue_depth ?? 0}</Badge>
                <Badge tone="muted">навыков: {sys.data?.skills ?? 0} · инструментов: {sys.data?.tools ?? 0}</Badge>
              </div>
            </div>
          </div>
          <form
            className="flex flex-1 items-center gap-2 lg:ml-6"
            onSubmit={(e) => {
              e.preventDefault();
              send(ask);
            }}
          >
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="JARVIS, …"
              className="h-12 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface-2/80 px-4 text-[15px] outline-none placeholder:text-faint focus:border-accent/50 focus:ring-2 focus:ring-accent/15"
            />
            <Button type="submit" variant="primary" size="lg" loading={sending} icon={<Send className="size-4" />} aria-label="Отправить" />
          </form>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-2">
          {SHORTCUTS.map((sc) => (
            <button key={sc} onClick={() => send(sc)} className="rounded-full border border-line bg-surface-2/70 px-3 py-1.5 text-xs text-muted transition hover:border-accent/40 hover:text-text">
              <Zap className="mr-1 inline size-3 text-accent" />
              {sc}
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Расходы сегодня" value={usd(s?.llm.cost_today_usd)} sub={`лимит ${usd(s?.llm.daily_limit_usd, 0)}`}
          tone={s && s.llm.cost_today_usd > s.llm.daily_limit_usd * 0.8 ? "warn" : undefined} />
        <Stat label="Активные задачи" value={s?.active_tasks ?? 0} sub={`${s?.tasks.succeeded ?? 0} выполнено за 14 дн.`} />
        <Stat label="Вызовы модели" value={compact(s?.llm.calls)} sub={`${compact((s?.llm.input_tokens ?? 0) + (s?.llm.output_tokens ?? 0))} токенов`} />
        <Stat label="Задержка p95" value={ms(s?.llm.latency_p95_ms)} sub={`p50 ${ms(s?.llm.latency_p50_ms)}`} />
        <Stat label="Кэш промпта" value={`${Math.round((s?.llm.cache_hit_ratio ?? 0) * 100)}%`} sub="доля входа из кэша" />
        <Stat label="Память" value={Object.values(s?.memories ?? {}).reduce((a, b) => a + b, 0)} sub="активных фактов" />
      </div>

      {(approvals.data?.approvals.length ?? 0) > 0 && (
        <div className="space-y-3">
          {approvals.data!.approvals.slice(0, 3).map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Сегодня и завтра" subtitle={calendar.data ? `Календарь: ${calendar.data.source === "google" ? "Google" : "встроенный"}` : undefined}
              actions={<CalendarDays className="size-4 text-faint" />} padded={false}>
              {!calendar.data?.events.length ? (
                <Empty title="Событий нет">Попросите: «Назначь встречу с Анной завтра в 15:00».</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  {calendar.data.events.slice(0, 7).map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="w-24 shrink-0 font-mono text-xs text-muted tabular">
                        {new Date(e.start).toLocaleDateString("ru-RU", { weekday: "short" })} {e.start.slice(11, 16)}
                      </div>
                      <p className="min-w-0 flex-1 truncate text-sm">{e.title}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Ближайшие напоминания и автоматизации" padded={false} actions={<Link to="/automations" className="text-xs text-muted hover:text-text">все</Link>}>
              {!upcoming.length ? (
                <Empty title="Ничего не запланировано">«Напомни завтра в 10 купить молоко»</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  {upcoming.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                      <Badge tone={a.kind === "reminder" ? "accent" : "violet"}>{a.kind === "reminder" ? "напоминание" : "агент"}</Badge>
                      <p className="min-w-0 flex-1 truncate text-sm">{a.name}</p>
                      <span className="shrink-0 font-mono text-[11px] text-muted">{a.next_run_local}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Расходы на модели по дням" subtitle="USD, последние 14 дней">
            {daily.some((d) => d.value > 0) ? (
              <BarChart data={daily} format={(v) => usd(v)} label="Расходы, USD" />
            ) : (
              <Empty title="Расходов пока нет">{s?.llm.calls ? "Вызовы модели были, но бесплатные (локальная модель или демо-режим)." : "Появятся после первых запросов к модели."}</Empty>
            )}
          </Card>

          <Card title="Последние задачи" padded={false} actions={<Link to="/tasks" className="flex items-center gap-1 text-xs text-muted hover:text-text">все <ArrowUpRight className="size-3" /></Link>}>
            {!tasks.data?.tasks.length ? (
              <Empty title="Задач ещё не было" />
            ) : (
              <ul className="divide-y divide-line">
                {tasks.data.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Badge tone={TASK_STATUS[t.status].tone} dot>{TASK_STATUS[t.status].label}</Badge>
                    <span className="hidden text-xs text-faint sm:inline">{TASK_KIND[t.kind] ?? t.kind}</span>
                    <p className="min-w-0 flex-1 truncate text-sm">{t.title || "—"}</p>
                    <span className="shrink-0 font-mono text-[11px] text-faint tabular">{usd(t.cost_usd, 3)}</span>
                    <span className="hidden w-24 shrink-0 text-right text-[11px] text-faint md:inline">{ago(t.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Активность в реальном времени" subtitle="Инструменты, задачи и подтверждения — по мере выполнения" className="xl:sticky xl:top-0 xl:self-start" bodyClassName="max-h-[70vh] overflow-y-auto p-2">
          <ActivityFeed limit={60} />
        </Card>
      </div>
    </div>
  );
}
