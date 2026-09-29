import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Command, Gamepad2, Pencil, Play, Plus, ShieldCheck, Sunrise, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Switch, Textarea } from "../components/ui";
import { del, get, post, put } from "../lib/api";
import { ago } from "../lib/format";
import type { CatalogTool, CommandStep, CustomCommand, JsonProp, StepCondition } from "../lib/types";

type Draft = Omit<CustomCommand, "id" | "run_count" | "last_run_at" | "last_status" | "updated_at"> & { id?: string };

const EMPTY: Draft = { name: "", description: "", triggers: [], steps: [], response: "", enabled: true, preapproved: false };

const TEMPLATES: { label: string; icon: ReactNode; draft: Draft }[] = [
  {
    label: "Игровой режим",
    icon: <Gamepad2 className="size-4" />,
    draft: {
      ...EMPTY,
      name: "Игровой режим",
      triggers: ["игровой режим", "включи игровой режим", "gaming mode"],
      response: "Игровой режим активирован.",
      steps: [
        { type: "tool", tool: "computer_open_app", args: { name: "spotify" } },
        { type: "wait", seconds: 2 },
        { type: "tool", tool: "computer_volume", args: { action: "set", level: 35 } },
        { type: "tool", tool: "computer_open_app", args: { name: "discord" } },
        { type: "tool", tool: "computer_open_app", args: { name: "steam" } },
      ],
    },
  },
  {
    label: "Доброе утро",
    icon: <Sunrise className="size-4" />,
    draft: {
      ...EMPTY,
      name: "Доброе утро",
      triggers: ["доброе утро", "morning"],
      response: "Доброе утро! Собираю брифинг — пришлю через минуту.",
      steps: [
        { type: "agent", text: "Утренний брифинг: погода в моём городе, мой календарь на сегодня, важные непрочитанные письма. Коротко." },
        { type: "tool", tool: "computer_open_app", args: { name: "chrome" }, when: "device_online", continue_on_error: true },
      ],
    },
  },
];

const QUICK: { label: string; step: CommandStep }[] = [
  { label: "Открыть приложение", step: { type: "tool", tool: "computer_open_app", args: { name: "" } } },
  { label: "Закрыть приложение", step: { type: "tool", tool: "computer_close_app", args: { name: "" } } },
  { label: "Открыть сайт / поиск", step: { type: "tool", tool: "computer_open_url", args: { url: "" } } },
  { label: "Громкость", step: { type: "tool", tool: "computer_volume", args: { action: "set", level: 40 } } },
  { label: "Медиа", step: { type: "tool", tool: "computer_media", args: { action: "play_pause" } } },
  { label: "Подождать", step: { type: "wait", seconds: 2 } },
  { label: "Сказать", step: { type: "say", text: "" } },
  { label: "Уведомление", step: { type: "notify", text: "" } },
  { label: "Задача для JARVIS", step: { type: "agent", text: "" } },
];

const CONDITIONS: { value: StepCondition; label: string }[] = [
  { value: "always", label: "всегда" },
  { value: "device_online", label: "если компьютер подключён" },
  { value: "device_offline", label: "если компьютер не подключён" },
  { value: "weekday", label: "в будни" },
  { value: "weekend", label: "в выходные" },
  { value: "morning", label: "утром (5–12)" },
  { value: "afternoon", label: "днём (12–18)" },
  { value: "evening", label: "вечером" },
];

function propType(p: JsonProp): string {
  if (p.enum) return "enum";
  if (p.type) return p.type;
  const t = p.anyOf?.find((x) => x.type && x.type !== "null");
  return t?.enum ? "enum" : t?.type ?? "string";
}
function propEnum(p: JsonProp): string[] | undefined {
  return p.enum ?? p.anyOf?.find((x) => x.enum)?.enum;
}

function ArgsForm({ tool, args, onChange }: { tool?: CatalogTool; args: Record<string, unknown>; onChange: (a: Record<string, unknown>) => void }) {
  if (!tool) return <p className="text-xs text-warn">Инструмент недоступен.</p>;
  const props = Object.entries(tool.input_schema.properties ?? {}).filter(([k]) => k !== "device");
  const required = new Set(tool.input_schema.required ?? []);
  if (!props.length) return <p className="text-xs text-faint">Без параметров.</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {props.map(([key, p]) => {
        const t = propType(p);
        const value = args[key];
        const set = (v: unknown) => onChange({ ...args, [key]: v === "" || v === undefined ? undefined : v });
        const label = `${key}${required.has(key) ? " *" : ""}`;
        return (
          <Field key={key} label={label} hint={p.description}>
            {t === "enum" ? (
              <Select value={(value as string) ?? ""} onChange={(e) => set(e.target.value)} className="w-full">
                {!required.has(key) && <option value="">—</option>}
                {propEnum(p)!.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            ) : t === "boolean" ? (
              <Switch checked={Boolean(value)} onChange={(v) => set(v)} label={key} />
            ) : t === "integer" || t === "number" ? (
              <Input type="number" value={value === undefined ? "" : String(value)} min={p.minimum} max={p.maximum}
                onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))} />
            ) : t === "array" ? (
              <Input value={Array.isArray(value) ? (value as string[]).join(", ") : ""} placeholder="через запятую"
                onChange={(e) => set(e.target.value ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean) : undefined)} />
            ) : (
              <Input value={(value as string) ?? ""} onChange={(e) => set(e.target.value)} />
            )}
          </Field>
        );
      })}
    </div>
  );
}

function StepEditor({ step, index, count, tools, onChange, onMove, onRemove }: {
  step: CommandStep; index: number; count: number; tools: CatalogTool[];
  onChange: (s: CommandStep) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const tool = tools.find((t) => t.name === step.tool);
  const title = step.type === "tool" ? tool?.activity || step.tool : QUICK.find((q) => q.step.type === step.type)?.label;
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft font-mono text-[11px] text-accent">{index + 1}</span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
        {tool?.tier === "confirm" && <Badge tone="warn">нужно подтверждение</Badge>}
        {tool && !tool.available && <Badge tone="warn">сейчас недоступно</Badge>}
        <Button size="icon" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Выше"><ArrowUp className="size-3.5" /></Button>
        <Button size="icon" variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Ниже"><ArrowDown className="size-3.5" /></Button>
        <Button size="icon" variant="ghost" onClick={onRemove} aria-label="Удалить шаг"><X className="size-3.5" /></Button>
      </div>
      {step.type === "tool" && (
        <div className="space-y-2">
          <Select value={step.tool} onChange={(e) => onChange({ ...step, tool: e.target.value, args: {} })} className="w-full">
            {tools.map((t) => <option key={t.name} value={t.name}>{t.activity || t.name} · {t.name}</option>)}
          </Select>
          <ArgsForm tool={tool} args={step.args ?? {}} onChange={(args) => onChange({ ...step, args })} />
        </div>
      )}
      {step.type === "wait" && (
        <Field label="Секунд"><Input type="number" min={0} max={120} step={0.5} value={step.seconds ?? 0}
          onChange={(e) => onChange({ ...step, seconds: Number(e.target.value) })} /></Field>
      )}
      {(step.type === "say" || step.type === "notify" || step.type === "agent") && (
        <Textarea rows={step.type === "agent" ? 3 : 2} value={step.text ?? ""} onChange={(e) => onChange({ ...step, text: e.target.value })}
          placeholder={step.type === "agent" ? "Что JARVIS должен сделать (промпт)" : "Текст"} />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
        <label className="flex items-center gap-2">Условие
          <Select value={step.when ?? "always"} onChange={(e) => onChange({ ...step, when: e.target.value as StepCondition })}>
            {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </label>
        <Switch checked={Boolean(step.continue_on_error)} onChange={(v) => onChange({ ...step, continue_on_error: v })} label="Продолжать при ошибке" />
        <span>продолжать при ошибке</span>
      </div>
    </li>
  );
}

function clean(d: Draft) {
  return {
    ...d,
    triggers: d.triggers.map((t) => t.trim()).filter(Boolean),
    steps: d.steps.map((s) => ({ ...s, args: s.args ? Object.fromEntries(Object.entries(s.args).filter(([, v]) => v !== undefined && v !== "")) : undefined })),
  };
}

function Builder({ initial, onClose }: { initial: Draft | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(initial ?? EMPTY);
  const [triggersText, setTriggersText] = useState((initial?.triggers ?? []).join("\n"));
  useEffect(() => { setD(initial ?? EMPTY); setTriggersText((initial?.triggers ?? []).join("\n")); }, [initial]);
  const catalog = useQuery({ queryKey: ["commands-catalog"], queryFn: () => get<{ tools: CatalogTool[] }>("/api/commands/catalog"), enabled: initial !== null });
  const tools = catalog.data?.tools ?? [];
  const draft = useMemo(() => clean({ ...d, triggers: triggersText.split("\n") }), [d, triggersText]);
  const check = useQuery({
    queryKey: ["commands-validate", JSON.stringify(draft)],
    queryFn: () => post<{ ok: boolean; warnings?: string[]; error?: string }>("/api/commands/validate", draft),
    enabled: initial !== null && Boolean(draft.name && draft.triggers.length && draft.steps.length),
  });
  const save = useMutation({
    mutationFn: () => (d.id ? put(`/api/commands/${d.id}`, draft) : post("/api/commands", draft)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["commands"] }); onClose(); },
  });
  const setStep = (i: number, s: CommandStep) => setD({ ...d, steps: d.steps.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, dir: -1 | 1) => {
    const steps = [...d.steps];
    [steps[i], steps[i + dir]] = [steps[i + dir], steps[i]];
    setD({ ...d, steps });
  };
  return (
    <Modal wide open={initial !== null} onClose={onClose} title={d.id ? `Команда «${d.name}»` : "Новая команда"}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button variant="primary" loading={save.isPending} disabled={!draft.name || !draft.triggers.length || !draft.steps.length || check.data?.ok === false}
          onClick={() => save.mutate()}>Сохранить</Button>
      </>}>
      <div className="space-y-4">
        {!d.id && (
          <div className="flex flex-wrap gap-2">
            <span className="self-center text-xs text-faint">Шаблон:</span>
            {TEMPLATES.map((t) => (
              <Button key={t.label} size="sm" variant="secondary" icon={t.icon}
                onClick={() => { setD(t.draft); setTriggersText(t.draft.triggers.join("\n")); }}>{t.label}</Button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Название"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Игровой режим" /></Field>
          <Field label="Ответ после выполнения" hint="Если всё прошло успешно">
            <Input value={d.response} onChange={(e) => setD({ ...d, response: e.target.value })} placeholder="Игровой режим активирован." />
          </Field>
        </div>
        <Field label="Фразы запуска" hint="По одной на строку. «JARVIS», регистр и знаки препинания не важны.">
          <Textarea rows={3} value={triggersText} onChange={(e) => setTriggersText(e.target.value)} placeholder={"игровой режим\nвключи игровой режим"} />
        </Field>
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Шаги — выполняются по порядку</p>
          {catalog.isLoading ? <Spinner /> : (
            <ol className="space-y-2">
              {d.steps.map((s, i) => (
                <StepEditor key={i} step={s} index={i} count={d.steps.length} tools={tools}
                  onChange={(n) => setStep(i, n)} onMove={(dir) => move(i, dir)} onRemove={() => setD({ ...d, steps: d.steps.filter((_, j) => j !== i) })} />
              ))}
            </ol>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <Button key={q.label} size="sm" variant="ghost" icon={<Plus className="size-3" />}
                onClick={() => setD({ ...d, steps: [...d.steps, structuredClone(q.step)] })}>{q.label}</Button>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-3" />} disabled={!tools.length}
              onClick={() => setD({ ...d, steps: [...d.steps, { type: "tool", tool: tools[0]?.name, args: {} }] })}>Другой инструмент…</Button>
          </div>
        </div>
        <div className="rounded-xl border border-line p-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1 text-xs text-muted">
              <p className="text-sm text-text">Разрешить без подтверждения</p>
              Шаги, которые обычно требуют подтверждения (закрыть приложение, напечатать текст…), будут выполняться сразу.
              Нужен повторный ввод пароля. Опасные действия (команды в терминале, платежи) в командах запрещены всегда.
            </div>
            <Switch checked={d.preapproved} onChange={(v) => setD({ ...d, preapproved: v })} label="Разрешить без подтверждения" />
          </div>
        </div>
        {check.data?.ok === false && <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{check.data.error}</p>}
        {check.data?.warnings?.map((w) => <p key={w} className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">{w}</p>)}
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  );
}

function stepSummary(s: CommandStep): string {
  if (s.type === "wait") return `пауза ${s.seconds} с`;
  if (s.type === "say") return `сказать «${s.text}»`;
  if (s.type === "notify") return "уведомление";
  if (s.type === "agent") return "задача для JARVIS";
  const a = s.args ?? {};
  const detail = a.name ?? a.url ?? a.search ?? (a.level !== undefined ? `${a.level}%` : a.action);
  return `${s.tool?.replace(/^computer_/, "")}${detail ? `: ${detail}` : ""}`;
}

export function CommandsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["commands"], queryFn: () => get<{ commands: CustomCommand[] }>("/api/commands") });
  const toggle = useMutation({ mutationFn: (c: CustomCommand) => put(`/api/commands/${c.id}`, { ...c, enabled: !c.enabled }), onSuccess: () => qc.invalidateQueries({ queryKey: ["commands"] }) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/commands/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["commands"] }) });
  const run = useMutation({ mutationFn: (id: string) => post(`/api/commands/${id}/run`), onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["commands"] }), 1500) });
  const items = data?.commands ?? [];
  return (
    <>
      <PageHeader
        title="Команды"
        description="Свои голосовые и текстовые команды: одна фраза — несколько действий по порядку. Работают в чате, голосом, в Telegram и WhatsApp — без обращения к модели."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ ...EMPTY })}>Создать</Button>}
      />
      {isLoading ? (
        <div className="flex justify-center p-10"><Spinner /></div>
      ) : !items.length ? (
        <Card><Empty icon={<Command className="size-6" />} title="Команд пока нет">
          Например «Игровой режим»: открыть Spotify, громкость 35%, запустить Discord и Steam. Или скажите JARVIS: «создай команду…».
        </Empty></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => (
            <Card key={c.id} className={c.enabled ? "" : "opacity-60"}>
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-accent-soft p-2 text-accent"><Command className="size-4" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">«{c.triggers.join("», «")}»</p>
                </div>
                <Switch checked={c.enabled} onChange={() => toggle.mutate(c)} label="Включена" />
              </div>
              <ol className="mt-3 space-y-0.5 text-xs text-muted">
                {c.steps.slice(0, 5).map((s, i) => <li key={i} className="truncate"><span className="text-faint">{i + 1}.</span> {stepSummary(s)}</li>)}
                {c.steps.length > 5 && <li className="text-faint">… ещё {c.steps.length - 5}</li>}
              </ol>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                {c.preapproved && <Badge tone="accent">без подтверждения</Badge>}
                {c.last_status && <Badge tone={c.last_status === "ok" ? "ok" : "warn"}>{c.last_status === "ok" ? "успешно" : c.last_status === "partial" ? "частично" : "ошибка"}</Badge>}
                <span>запусков: {c.run_count}</span>
                {c.last_run_at && <span>· {ago(c.last_run_at)}</span>}
                <span className="ml-auto flex gap-1">
                  <Button size="icon" variant="ghost" title="Запустить" loading={run.isPending && run.variables === c.id} onClick={() => run.mutate(c.id)}><Play className="size-3.5" /></Button>
                  <Button size="icon" variant="ghost" title="Изменить" onClick={() => setEditing({ ...c })}><Pencil className="size-3.5" /></Button>
                  <Button size="icon" variant="ghost" title="Удалить" onClick={() => confirm(`Удалить «${c.name}»?`) && remove.mutate(c.id)}><Trash2 className="size-3.5" /></Button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Builder initial={editing} onClose={() => setEditing(null)} />
    </>
  );
}
