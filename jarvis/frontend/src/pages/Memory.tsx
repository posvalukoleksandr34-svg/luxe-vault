import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Brain, Check, Download, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from "../components/ui";
import { del, get, patch, post, qs } from "../lib/api";
import { MEMORY_KIND, ago } from "../lib/format";
import type { Memory, MemoryKind } from "../lib/types";

const KINDS = Object.keys(MEMORY_KIND) as MemoryKind[];

function MemoryRow({ m }: { m: Memory }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(m.content);
  const refresh = () => qc.invalidateQueries({ queryKey: ["memory"] });
  const save = useMutation({ mutationFn: (body: Partial<Memory>) => patch(`/api/memory/${m.id}`, body), onSuccess: () => { setEditing(false); refresh(); } });
  const remove = useMutation({ mutationFn: () => del(`/api/memory/${m.id}`), onSuccess: refresh });
  const k = MEMORY_KIND[m.kind];
  return (
    <li className="group px-4 py-3 hover:bg-hover/50">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <Textarea rows={2} value={content} onChange={(e) => setContent(e.target.value)} autoFocus />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={save.isPending} onClick={() => save.mutate({ content })}>Сохранить</Button>
                <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => { setEditing(false); setContent(m.content); }}>Отмена</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-relaxed">{m.content}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
            <Badge tone={k.tone}>{k.label}</Badge>
            {m.pinned && <Badge tone="accent"><Pin className="size-2.5" /> закреплено</Badge>}
            {m.subject && <span className="text-muted">{m.subject}</span>}
            <span>· важность {Math.round(m.importance * 100)}%</span>
            <span>· {m.source === "extracted" ? "извлечено из разговора" : m.source === "user" ? "добавлено вами" : "сохранено JARVIS"}</span>
            <span>· {ago(m.updated_at)}</span>
            {m.access_count > 0 && <span>· использовано {m.access_count}×</span>}
            {m.score !== undefined && <span className="font-mono">· score {m.score.toFixed(3)}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5 opacity-60 transition group-hover:opacity-100">
          <Button size="icon" variant="ghost" title={m.pinned ? "Открепить" : "Закрепить (всегда в контексте)"} onClick={() => save.mutate({ pinned: !m.pinned })}>
            {m.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </Button>
          <Button size="icon" variant="ghost" title="Исправить" onClick={() => setEditing(true)}><Pencil className="size-3.5" /></Button>
          <Button size="icon" variant="ghost" title="Забыть" onClick={() => confirm("Забыть этот факт?") && remove.mutate()}><Trash2 className="size-3.5" /></Button>
        </div>
      </div>
    </li>
  );
}

function AddMemory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ content: "", kind: "profile" as MemoryKind, subject: "", pinned: false, importance: 0.7 });
  const add = useMutation({
    mutationFn: () => post("/api/memory", { ...form, subject: form.subject || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory"] });
      setForm({ ...form, content: "", subject: "" });
      onClose();
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="Добавить в память" footer={<Button variant="primary" disabled={!form.content} loading={add.isPending} onClick={() => add.mutate()}>Сохранить</Button>}>
      <div className="space-y-3">
        <Field label="Факт" hint="Одно самостоятельное утверждение: «Анна — сестра, живёт в Берлине».">
          <Textarea rows={3} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Тип">
            <Select className="w-full" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as MemoryKind })}>
              {KINDS.map((k) => <option key={k} value={k}>{MEMORY_KIND[k].label}</option>)}
            </Select>
          </Field>
          <Field label="О ком / о чём"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="user, Анна, проект X" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} /> Закрепить — всегда держать в контексте
        </label>
        <ErrorNote error={add.error} />
      </div>
    </Modal>
  );
}

export function MemoryPage() {
  const [kind, setKind] = useState<MemoryKind | "">("");
  const [q, setQ] = useState("");
  const [semantic, setSemantic] = useState("");
  const [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ["memory", kind, q],
    queryFn: () => get<{ memories: Memory[]; total: number }>(`/api/memory${qs({ kind, q, limit: 200 })}`),
    enabled: !semantic,
  });
  const search = useQuery({
    queryKey: ["memory", "search", semantic],
    queryFn: () => get<{ results: Memory[] }>(`/api/memory/search${qs({ q: semantic, limit: 20 })}`),
    enabled: !!semantic,
  });
  const counts = useQuery({ queryKey: ["memory", "all-counts"], queryFn: () => get<{ memories: Memory[]; total: number }>("/api/memory?limit=200") });
  const byKind = (counts.data?.memories ?? []).reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.kind]: (acc[m.kind] ?? 0) + 1 }), {});
  const items = semantic ? search.data?.results ?? [] : list.data?.memories ?? [];
  const loading = semantic ? search.isLoading : list.isLoading;

  const exportAll = async () => {
    const data = await get("/api/memory/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `jarvis-memory-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  return (
    <>
      <PageHeader
        title="Память"
        description="Что JARVIS знает о вас. Факты извлекаются из разговоров автоматически, дубликаты объединяются; в каждый ответ попадают только релевантные. Всё можно исправить или удалить."
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={exportAll}>Экспорт</Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Добавить</Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setKind("")} className={clsx("rounded-full border px-3 py-1 text-xs", !kind ? "border-accent/40 bg-accent-soft text-text" : "border-line text-muted hover:text-text")}>
          Все · {counts.data?.total ?? 0}
        </button>
        {KINDS.map((k) => (
          <button key={k} onClick={() => setKind(k)} className={clsx("rounded-full border px-3 py-1 text-xs", kind === k ? "border-accent/40 bg-accent-soft text-text" : "border-line text-muted hover:text-text")}>
            {MEMORY_KIND[k].label} · {byKind[k] ?? 0}
          </button>
        ))}
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <div className="relative">
          <Search className="absolute top-2.5 left-3 size-4 text-faint" />
          <Input className="pl-9" placeholder="Фильтр по тексту" value={q} onChange={(e) => { setQ(e.target.value); setSemantic(""); }} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setSemantic(String(new FormData(e.currentTarget).get("s") ?? "")); }} className="relative">
          <Brain className="absolute top-2.5 left-3 size-4 text-accent" />
          <Input name="s" className="pl-9" placeholder="Спросить память по смыслу: «где живёт Анна?» + Enter" />
        </form>
      </div>
      {semantic && (
        <p className="mb-3 text-xs text-muted">
          Гибридный поиск (векторы + полнотекст + нечёткое совпадение) по запросу «{semantic}» — так JARVIS вспоминает контекст.{" "}
          <button className="text-accent" onClick={() => setSemantic("")}>сбросить</button>
        </p>
      )}
      <Card padded={false}>
        {loading ? (
          <div className="flex justify-center p-10"><Spinner /></div>
        ) : !items.length ? (
          <Empty icon={<Brain className="size-6" />} title={semantic ? "Ничего не вспомнилось" : "Память пуста"}>Скажите JARVIS: «Запомни, что я люблю итальянскую кухню».</Empty>
        ) : (
          <ul className="divide-y divide-line">{items.map((m) => <MemoryRow key={m.id} m={m} />)}</ul>
        )}
      </Card>
      <AddMemory open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
