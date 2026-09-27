import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Ban, Bot, Plus, RotateCcw, Wrench } from "lucide-react";
import { useState } from "react";

import { ApprovalCard } from "../components/Approvals";
import { Badge, Button, Card, Drawer, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner, Tabs, Textarea } from "../components/ui";
import { get, post, qs } from "../lib/api";
import { CHANNEL, RISK, TASK_KIND, TASK_STATUS, TIER, ago, dateTime, ms, usd } from "../lib/format";
import { useRealtime } from "../lib/realtime";
import type { Task, TaskDetail } from "../lib/types";

type Filter = "active" | "all" | "failed";

function TaskDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["task", id], queryFn: () => get<TaskDetail>(`/api/tasks/${id}`), refetchInterval: 5000 });
  const live = useRealtime((s) => s.status[id]);
  const cancel = useMutation({ mutationFn: () => post(`/api/tasks/${id}/cancel`), onSuccess: () => qc.invalidateQueries({ queryKey: ["task", id] }) });
  const retry = useMutation({ mutationFn: () => post(`/api/tasks/${id}/retry`), onSuccess: () => qc.invalidateQueries({ queryKey: ["task", id] }) });
  const t = data?.task;
  const active = t && ["queued", "running", "waiting_approval"].includes(t.status);
  return (
    <Drawer
      open
      onClose={onClose}
      title={t?.title || "Задача"}
      actions={
        <>
          {active && <Button size="sm" variant="danger" icon={<Ban className="size-3.5" />} loading={cancel.isPending} onClick={() => cancel.mutate()}>Отменить</Button>}
          {t && ["failed", "cancelled"].includes(t.status) && (
            <Button size="sm" icon={<RotateCcw className="size-3.5" />} loading={retry.isPending} onClick={() => retry.mutate()}>Повторить</Button>
          )}
        </>
      }
    >
      {isLoading || !data || !t ? (
        <div className="flex justify-center p-10"><Spinner /></div>
      ) : (
        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TASK_STATUS[t.status].tone} dot>{TASK_STATUS[t.status].label}</Badge>
            <Badge>{TASK_KIND[t.kind] ?? t.kind}</Badge>
            <Badge>{CHANNEL[t.channel] ?? t.channel}</Badge>
            {live && active && <span className="animate-pulse-soft text-xs text-accent">{live.label}</span>}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            {[
              ["Создана", dateTime(t.created_at)],
              ["Длительность", t.started_at ? ms(new Date(t.finished_at ?? Date.now()).getTime() - new Date(t.started_at).getTime()) : "—"],
              ["Стоимость", usd(t.cost_usd, 4)],
              ["Токены", `${t.input_tokens} → ${t.output_tokens}`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                <dt className="text-faint">{k}</dt>
                <dd className="mt-0.5 font-mono text-text tabular">{v}</dd>
              </div>
            ))}
          </dl>
          {(data.input.text || data.input.prompt) && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Запрос{data.input.agent && data.input.agent !== "jarvis" ? ` · агент ${data.input.agent}` : ""}</p>
              <p className="rounded-lg border border-line bg-surface-2 p-3 text-sm whitespace-pre-wrap">{data.input.text || data.input.prompt}</p>
            </div>
          )}
          {data.approvals.filter((a) => a.status === "pending").map((a) => <ApprovalCard key={a.id} approval={a} compact />)}
          {t.error && <ErrorNote error={t.error} />}
          {t.result && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Результат</p>
              <p className="max-h-72 overflow-y-auto rounded-lg border border-line bg-surface-2 p-3 text-sm whitespace-pre-wrap">{t.result}</p>
            </div>
          )}
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Инструменты ({data.tool_calls.length})</p>
            <ol className="space-y-2">
              {data.tool_calls.map((c) => (
                <li key={c.id} className="rounded-lg border border-line bg-surface-2">
                  <details>
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
                      <Wrench className="size-3.5 text-faint" />
                      <span className="font-mono text-text">{c.tool}</span>
                      <Badge tone={c.status === "succeeded" ? "ok" : c.status === "failed" ? "danger" : c.status === "denied" ? "muted" : "warn"}>{c.status}</Badge>
                      <Badge tone={RISK[c.risk].tone}>{RISK[c.risk].label}</Badge>
                      <Badge tone={TIER[c.tier].tone}>{TIER[c.tier].label}</Badge>
                      <span className="ml-auto font-mono text-faint">{ms(c.duration_ms)}{c.attempts > 1 ? ` · ×${c.attempts}` : ""}</span>
                    </summary>
                    <div className="space-y-2 border-t border-line p-3">
                      <pre className="overflow-x-auto font-mono text-[11px] text-muted">{JSON.stringify(c.input, null, 2)}</pre>
                      {c.output && <pre className="max-h-60 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-text">{c.output}</pre>}
                      {c.error && <p className="text-xs text-danger">{c.error}</p>}
                    </div>
                  </details>
                </li>
              ))}
              {!data.tool_calls.length && <p className="text-xs text-faint">Инструменты не вызывались</p>}
            </ol>
          </div>
          {data.children.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted">Под-агенты</p>
              <ul className="space-y-1.5">
                {data.children.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">
                    <Bot className="size-3.5 text-violet" />
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <Badge tone={TASK_STATUS[c.status].tone}>{TASK_STATUS[c.status].label}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Вызовы модели</p>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-surface-2 text-faint">
                  <tr>
                    <th className="px-2.5 py-1.5 font-medium">маршрут</th>
                    <th className="px-2.5 py-1.5 font-medium">модель</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">вход/выход</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">кэш</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">время</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">$</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular">
                  {data.llm_calls.map((c, i) => (
                    <tr key={i} className={clsx("border-t border-line", c.status !== "ok" && "text-danger")}>
                      <td className="px-2.5 py-1.5">{c.route}</td>
                      <td className="px-2.5 py-1.5">{c.model}</td>
                      <td className="px-2.5 py-1.5 text-right">{c.input_tokens}/{c.output_tokens}</td>
                      <td className="px-2.5 py-1.5 text-right">{c.cache_read_tokens}</td>
                      <td className="px-2.5 py-1.5 text-right">{ms(c.latency_ms)}</td>
                      <td className="px-2.5 py-1.5 text-right">{usd(c.cost_usd, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Хронология</p>
            <ol className="space-y-1 border-l border-line pl-4">
              {data.events.map((e, i) => (
                <li key={i} className="relative text-xs text-muted">
                  <span className="absolute top-1.5 -left-[19px] size-1.5 rounded-full bg-line-strong" />
                  <span className="font-mono text-faint">{new Date(e.at).toLocaleTimeString("ru-RU")}</span>{" "}
                  {e.type} {typeof e.data.tool === "string" ? `· ${e.data.tool}` : ""}
                  {typeof e.data.status === "string" ? ` · ${e.data.status}` : ""}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function NewTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const create = useMutation({
    mutationFn: () => post("/api/tasks", { title, instructions }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setTitle("");
      setInstructions("");
      onClose();
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="Новая фоновая задача" footer={<Button variant="primary" loading={create.isPending} disabled={!title || !instructions} onClick={() => create.mutate()}>Запустить</Button>}>
      <div className="space-y-3">
        <Field label="Название"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Сравнить тарифы VPS" /></Field>
        <Field label="Что сделать" hint="JARVIS выполнит задачу в фоне и пришлёт результат уведомлением.">
          <Textarea rows={6} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Исследуй… сравни… сделай отчёт в файл reports/…" />
        </Field>
        <ErrorNote error={create.error} />
      </div>
    </Modal>
  );
}

export function TasksPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const status = filter === "active" ? "queued,running,waiting_approval" : filter === "failed" ? "failed" : undefined;
  const { data, isLoading } = useQuery({
    queryKey: ["tasks", filter],
    queryFn: () => get<{ tasks: Task[] }>(`/api/tasks${qs({ status, kind: "agent_turn,background,automation_run,subagent", limit: 200 })}`),
  });
  const live = useRealtime((s) => s.status);
  return (
    <>
      <PageHeader
        title="Задачи"
        description="Всё, что выполняет JARVIS: диалоги, фоновые задачи, автоматизации и под-агенты. Состояние сохраняется — после перезапуска задачи продолжаются."
        actions={
          <>
            <Tabs value={filter} onChange={setFilter} items={[{ value: "all", label: "Все" }, { value: "active", label: "Активные" }, { value: "failed", label: "Ошибки" }]} />
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Фоновая задача</Button>
          </>
        }
      />
      <Card padded={false}>
        {isLoading ? (
          <div className="flex justify-center p-10"><Spinner /></div>
        ) : !data?.tasks.length ? (
          <Empty title="Задач нет" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-line text-xs text-faint">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Статус</th>
                  <th className="px-4 py-2.5 font-medium">Задача</th>
                  <th className="px-4 py-2.5 font-medium">Тип</th>
                  <th className="px-4 py-2.5 font-medium">Канал</th>
                  <th className="px-4 py-2.5 text-right font-medium">Стоимость</th>
                  <th className="px-4 py-2.5 text-right font-medium">Когда</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((t) => (
                  <tr key={t.id} onClick={() => setOpen(t.id)} className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-hover">
                    <td className="px-4 py-2.5"><Badge tone={TASK_STATUS[t.status].tone} dot>{TASK_STATUS[t.status].label}</Badge></td>
                    <td className="max-w-md px-4 py-2.5">
                      <p className="truncate">{t.title || "—"}</p>
                      {live[t.id] && <p className="animate-pulse-soft truncate text-xs text-accent">{live[t.id].label}</p>}
                      {t.error && <p className="truncate text-xs text-danger">{t.error}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{TASK_KIND[t.kind] ?? t.kind}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{CHANNEL[t.channel] ?? t.channel}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs tabular text-muted">{usd(t.cost_usd, 4)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-faint">{ago(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <TaskDrawer id={open} onClose={() => setOpen(null)} />}
      <NewTaskModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
