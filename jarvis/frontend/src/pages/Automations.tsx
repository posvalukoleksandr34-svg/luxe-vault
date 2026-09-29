import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Bot, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Switch, Textarea } from "../components/ui";
import { del, get, patch, post } from "../lib/api";
import { ago } from "../lib/format";
import type { Automation } from "../lib/types";

const CRON_PRESETS = [
  { label: "Каждый день в 08:00", cron: "0 8 * * *" },
  { label: "По будням в 07:30", cron: "30 7 * * 1-5" },
  { label: "По понедельникам в 09:00", cron: "0 9 * * 1" },
  { label: "По пятницам в 18:00", cron: "0 18 * * 5" },
  { label: "Каждый вечер в 21:00", cron: "0 21 * * *" },
];

function describeSchedule(a: Automation): string {
  if (a.schedule_type === "cron") return CRON_PRESETS.find((p) => p.cron === a.cron)?.label ?? `cron: ${a.cron}`;
  if (a.schedule_type === "interval") return `каждые ${Math.round((a.interval_seconds ?? 0) / 60)} мин`;
  return "однократно";
}

function NewAutomation({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"reminder" | "agent">("agent");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [schedule, setSchedule] = useState<"cron" | "once">("cron");
  const [cron, setCron] = useState(CRON_PRESETS[1].cron);
  const [runAt, setRunAt] = useState("");
  const create = useMutation({
    mutationFn: () =>
      post("/api/automations", {
        name,
        kind,
        message: kind === "reminder" ? body || name : undefined,
        prompt: kind === "agent" ? body : undefined,
        cron: schedule === "cron" ? cron : undefined,
        run_at: schedule === "once" ? runAt : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automations"] });
      onClose();
      setName("");
      setBody("");
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="Новая автоматизация" footer={<Button variant="primary" loading={create.isPending} disabled={!name || (kind === "agent" && !body)} onClick={() => create.mutate()}>Создать</Button>}>
      <div className="space-y-3">
        <Field label="Тип">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "reminder" | "agent")} className="w-full">
            <option value="agent">Задача для JARVIS (выполнить промпт и прислать результат)</option>
            <option value="reminder">Напоминание (просто прислать текст)</option>
          </Select>
        </Field>
        <Field label="Название"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "agent" ? "Утренний брифинг" : "Выпить воды"} /></Field>
        <Field label={kind === "agent" ? "Что сделать" : "Текст напоминания"} hint={kind === "agent" ? "Промпт выполняется с теми же инструментами и разрешениями; разговора он не видит." : undefined}>
          <Textarea rows={kind === "agent" ? 5 : 2} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={kind === "agent" ? "Посмотри мой календарь на сегодня, непрочитанные важные письма и погоду; составь краткий брифинг." : ""} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Расписание">
            <Select value={schedule} onChange={(e) => setSchedule(e.target.value as "cron" | "once")} className="w-full">
              <option value="cron">Повторять</option>
              <option value="once">Один раз</option>
            </Select>
          </Field>
          {schedule === "cron" ? (
            <Field label="Когда" hint={<span className="font-mono">{cron}</span>}>
              <Select value={cron} onChange={(e) => setCron(e.target.value)} className="w-full">
                {CRON_PRESETS.map((p) => <option key={p.cron} value={p.cron}>{p.label}</option>)}
              </Select>
            </Field>
          ) : (
            <Field label="Дата и время"><Input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} /></Field>
          )}
        </div>
        <ErrorNote error={create.error} />
      </div>
    </Modal>
  );
}

export function AutomationsPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["automations"], queryFn: () => get<{ automations: Automation[] }>("/api/automations") });
  const toggle = useMutation({ mutationFn: (a: Automation) => patch(`/api/automations/${a.id}`, { enabled: !a.enabled }), onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/automations/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }) });
  const run = useMutation({ mutationFn: (id: string) => post(`/api/automations/${id}/run`), onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }) });
  const items = data?.automations ?? [];
  return (
    <>
      <PageHeader
        title="Автоматизации"
        description="Напоминания и регулярные задачи. Создаются из чата («каждую пятницу…», «напомни завтра в 10…») или здесь."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Создать</Button>}
      />
      {isLoading ? (
        <div className="flex justify-center p-10"><Spinner /></div>
      ) : !items.length ? (
        <Card><Empty icon={<BellRing className="size-6" />} title="Пока ничего не запланировано">Скажите JARVIS: «Каждый будний день в 7:30 присылай утренний брифинг».</Empty></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((a) => (
            <Card key={a.id} className={a.enabled ? "" : "opacity-60"}>
              <div className="flex items-start gap-3">
                <div className={`rounded-lg p-2 ${a.kind === "reminder" ? "bg-accent-soft text-accent" : "bg-violet/10 text-violet"}`}>
                  {a.kind === "reminder" ? <BellRing className="size-4" /> : <Bot className="size-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{describeSchedule(a)}</p>
                </div>
                <Switch checked={a.enabled} onChange={() => toggle.mutate(a)} label="Включено" />
              </div>
              {a.payload.prompt && <p className="mt-3 line-clamp-3 text-xs text-muted">{a.payload.prompt}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                {a.next_run_local && <Badge tone="accent">далее: {a.next_run_local}</Badge>}
                {a.last_status && <Badge>{a.last_status}</Badge>}
                <span>запусков: {a.run_count}</span>
                {a.last_run_at && <span>· {ago(a.last_run_at)}</span>}
                <span className="ml-auto flex gap-1">
                  <Button size="icon" variant="ghost" title="Запустить сейчас" onClick={() => run.mutate(a.id)}><Play className="size-3.5" /></Button>
                  <Button size="icon" variant="ghost" title="Удалить" onClick={() => confirm(`Удалить «${a.name}»?`) && remove.mutate(a.id)}><Trash2 className="size-3.5" /></Button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
      <NewAutomation open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
