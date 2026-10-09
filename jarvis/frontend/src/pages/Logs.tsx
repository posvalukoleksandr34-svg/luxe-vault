import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { BarChart } from "../components/BarChart";
import { Badge, Button, Card, Empty, PageHeader, Spinner, Stat, Tabs } from "../components/ui";
import { get } from "../lib/api";
import { RISK, TIER, compact, dateTime, ms, usd } from "../lib/format";
import type { LlmCallRow, Stats, ToolCallRow } from "../lib/types";

type Tab = "overview" | "audit" | "tools" | "llm";

interface AuditRow {
  id: number;
  ts: string;
  actor: string;
  action: string;
  target: string | null;
  data: Record<string, unknown>;
  hash: string;
}

export function LogsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const stats = useQuery({ queryKey: ["stats", 30], queryFn: () => get<Stats>("/api/stats?days=30"), enabled: tab === "overview" });
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => get<{ entries: AuditRow[] }>("/api/logs/audit?limit=300"), enabled: tab === "audit" });
  const tools = useQuery({ queryKey: ["tool-log"], queryFn: () => get<{ calls: ToolCallRow[] }>("/api/logs/tools?limit=300"), enabled: tab === "tools" });
  const llm = useQuery({ queryKey: ["llm-log"], queryFn: () => get<{ calls: LlmCallRow[] }>("/api/logs/llm?limit=300"), enabled: tab === "llm" });
  const verify = useMutation({ mutationFn: () => get<{ ok: boolean; first_broken_id: number | null }>("/api/logs/audit/verify") });
  const s = stats.data;
  return (
    <>
      <PageHeader
        title="Журнал"
        description="Что JARVIS сделал, какие инструменты использовал, сколько времени и денег это стоило и где случились ошибки. Аудит-журнал неизменяем и защищён хеш-цепочкой."
        actions={<Tabs value={tab} onChange={setTab} items={[{ value: "overview", label: "Обзор" }, { value: "audit", label: "Аудит" }, { value: "tools", label: "Инструменты" }, { value: "llm", label: "Модели" }]} />}
      />
      {tab === "overview" && (
        s ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="Расходы, 30 дн." value={usd(s.llm.cost_usd)} />
              <Stat label="Вызовы модели" value={compact(s.llm.calls)} sub={`ошибок ${(s.llm.error_rate * 100).toFixed(1)}%`} tone={s.llm.error_rate > 0.05 ? "warn" : undefined} />
              <Stat label="Токены" value={compact(s.llm.input_tokens + s.llm.output_tokens)} sub={`из кэша ${compact(s.llm.cache_read_tokens)}`} />
              <Stat label="Задержка" value={ms(s.llm.latency_p50_ms)} sub={`p95 ${ms(s.llm.latency_p95_ms)}`} />
              <Stat label="Кэш промпта" value={`${Math.round(s.llm.cache_hit_ratio * 100)}%`} />
            </div>
            <Card title="Расходы по дням" subtitle="USD, 30 дней">
              <BarChart data={s.llm.daily.map((d) => ({ key: d.day, label: new Date(d.day).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }), value: d.cost_usd, sub: `${d.calls} вызовов` }))} format={(v) => usd(v)} label="Расходы, USD" />
            </Card>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="По моделям" padded={false}>
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line text-xs text-faint"><tr><th className="px-4 py-2 font-medium">Модель</th><th className="px-4 py-2 text-right font-medium">Вызовы</th><th className="px-4 py-2 text-right font-medium">Стоимость</th></tr></thead>
                  <tbody className="font-mono text-xs tabular">
                    {s.llm.by_model.map((m) => (
                      <tr key={m.model} className="border-b border-line/70 last:border-0"><td className="px-4 py-2">{m.model}</td><td className="px-4 py-2 text-right">{m.calls}</td><td className="px-4 py-2 text-right">{usd(m.cost_usd, 3)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <Card title="Инструменты: использование и надёжность" padded={false}>
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line text-xs text-faint"><tr><th className="px-4 py-2 font-medium">Инструмент</th><th className="px-4 py-2 text-right font-medium">Вызовы</th><th className="px-4 py-2 text-right font-medium">Сбои</th><th className="px-4 py-2 text-right font-medium">Среднее</th></tr></thead>
                  <tbody className="font-mono text-xs tabular">
                    {s.tools.map((t) => (
                      <tr key={t.tool} className="border-b border-line/70 last:border-0">
                        <td className="px-4 py-2">{t.tool}</td><td className="px-4 py-2 text-right">{t.calls}</td>
                        <td className={clsx("px-4 py-2 text-right", t.failure_rate > 0.1 && "text-danger")}>{t.failures} ({Math.round(t.failure_rate * 100)}%)</td>
                        <td className="px-4 py-2 text-right">{ms(t.avg_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>
        ) : <div className="flex justify-center p-10"><Spinner /></div>
      )}
      {tab === "audit" && (
        <Card padded={false} title="Аудит-журнал" subtitle="Входы, подтверждения, действия агента, изменения прав и ключей"
          actions={
            <Button size="sm" icon={<ShieldCheck className="size-3.5" />} loading={verify.isPending} onClick={() => verify.mutate()}>
              {verify.data ? (verify.data.ok ? "Цепочка цела ✓" : `Нарушена на #${verify.data.first_broken_id}`) : "Проверить целостность"}
            </Button>
          }>
          {audit.isLoading ? <div className="flex justify-center p-10"><Spinner /></div> : !audit.data?.entries.length ? <Empty title="Записей нет" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b border-line text-faint"><tr><th className="px-4 py-2 font-medium">Время</th><th className="px-4 py-2 font-medium">Кто</th><th className="px-4 py-2 font-medium">Действие</th><th className="px-4 py-2 font-medium">Объект</th><th className="px-4 py-2 font-medium">Детали</th><th className="px-4 py-2 font-medium">hash</th></tr></thead>
                <tbody>
                  {audit.data.entries.map((e) => (
                    <tr key={e.id} className="border-b border-line/70 align-top last:border-0">
                      <td className="px-4 py-2 whitespace-nowrap text-muted">{dateTime(e.ts)}</td>
                      <td className="px-4 py-2 text-muted">{e.actor}</td>
                      <td className="px-4 py-2 font-mono">{e.action}</td>
                      <td className="px-4 py-2 font-mono text-muted">{e.target}</td>
                      <td className="max-w-md px-4 py-2 font-mono text-[10.5px] break-all text-faint">{JSON.stringify(e.data).slice(0, 220)}</td>
                      <td className="px-4 py-2 font-mono text-faint">{e.hash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === "tools" && (
        <Card padded={false}>
          {tools.isLoading ? <div className="flex justify-center p-10"><Spinner /></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="border-b border-line text-faint"><tr><th className="px-4 py-2 font-medium">Время</th><th className="px-4 py-2 font-medium">Инструмент</th><th className="px-4 py-2 font-medium">Статус</th><th className="px-4 py-2 font-medium">Риск / уровень</th><th className="px-4 py-2 font-medium">Задача</th><th className="px-4 py-2 text-right font-medium">Длит.</th></tr></thead>
                <tbody>
                  {tools.data?.calls.map((c) => (
                    <tr key={c.id} className="border-b border-line/70 last:border-0">
                      <td className="px-4 py-2 whitespace-nowrap text-muted">{dateTime(c.at)}</td>
                      <td className="px-4 py-2 font-mono">{c.tool}</td>
                      <td className="px-4 py-2"><Badge tone={c.status === "succeeded" ? "ok" : c.status === "failed" ? "danger" : "muted"}>{c.status}</Badge>{c.error && <p className="mt-1 max-w-xs truncate text-danger">{c.error}</p>}</td>
                      <td className="px-4 py-2"><Badge tone={RISK[c.risk].tone}>{RISK[c.risk].label}</Badge> <Badge tone={TIER[c.tier].tone}>{TIER[c.tier].label}</Badge></td>
                      <td className="max-w-xs truncate px-4 py-2 text-muted">{c.task}</td>
                      <td className="px-4 py-2 text-right font-mono tabular">{ms(c.duration_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === "llm" && (
        <Card padded={false}>
          {llm.isLoading ? <div className="flex justify-center p-10"><Spinner /></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="border-b border-line text-faint"><tr><th className="px-4 py-2 font-medium">Время</th><th className="px-4 py-2 font-medium">Маршрут</th><th className="px-4 py-2 font-medium">Модель</th><th className="px-4 py-2 text-right font-medium">Вход</th><th className="px-4 py-2 text-right font-medium">Выход</th><th className="px-4 py-2 text-right font-medium">Кэш</th><th className="px-4 py-2 text-right font-medium">Время</th><th className="px-4 py-2 text-right font-medium">$</th><th className="px-4 py-2 font-medium">Итог</th></tr></thead>
                <tbody className="font-mono tabular">
                  {llm.data?.calls.map((c, i) => (
                    <tr key={c.id ?? i} className={clsx("border-b border-line/70 last:border-0", c.status !== "ok" && "text-danger")}>
                      <td className="px-4 py-2 font-sans whitespace-nowrap text-muted">{dateTime(c.at)}</td>
                      <td className="px-4 py-2">{c.route}</td>
                      <td className="px-4 py-2">{c.model}</td>
                      <td className="px-4 py-2 text-right">{c.input_tokens}</td>
                      <td className="px-4 py-2 text-right">{c.output_tokens}</td>
                      <td className="px-4 py-2 text-right">{c.cache_read_tokens}</td>
                      <td className="px-4 py-2 text-right">{ms(c.latency_ms)}</td>
                      <td className="px-4 py-2 text-right">{usd(c.cost_usd, 4)}</td>
                      <td className="max-w-xs truncate px-4 py-2 font-sans">{c.error ?? c.stop_reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
