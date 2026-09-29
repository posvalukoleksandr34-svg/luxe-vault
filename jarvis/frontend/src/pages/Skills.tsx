import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, Settings2, Sparkles } from "lucide-react";
import { useState } from "react";

import { Badge, Button, Card, ErrorNote, Modal, PageHeader, Spinner, Switch, Textarea } from "../components/ui";
import { get, patch, post } from "../lib/api";
import type { Skill } from "../lib/types";

function ConfigModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState(JSON.stringify(skill.config, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (config: unknown) => patch(`/api/skills/${skill.name}`, { config }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Настройки навыка: ${skill.title}`}
      footer={<Button variant="primary" loading={save.isPending} onClick={() => { try { save.mutate(JSON.parse(text)); } catch { setErr("Некорректный JSON"); } }}>Сохранить</Button>}>
      <Textarea rows={10} className="font-mono text-xs" value={text} onChange={(e) => { setText(e.target.value); setErr(null); }} />
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      <ErrorNote error={save.error} />
    </Modal>
  );
}

export function SkillsPage() {
  const qc = useQueryClient();
  const [config, setConfig] = useState<Skill | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["skills"], queryFn: () => get<{ skills: Skill[] }>("/api/skills") });
  const toggle = useMutation({ mutationFn: (s: Skill) => patch(`/api/skills/${s.name}`, { enabled: !s.enabled }), onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }) });
  const reload = useMutation({ mutationFn: () => post("/api/skills/reload"), onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }) });
  return (
    <>
      <PageHeader
        title="Навыки"
        description="Навык — отдельная способность: манифест, инструкции, инструменты и тесты в своей папке skills/<имя>/. Новый навык = новая папка, ядро не меняется. JARVIS видит список навыков и загружает инструкции, когда они нужны."
        actions={<Button icon={<RefreshCw className="size-4" />} loading={reload.isPending} onClick={() => reload.mutate()}>Перечитать папку</Button>}
      />
      {isLoading ? (
        <div className="flex justify-center p-10"><Spinner /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.skills.map((s) => (
            <Card key={s.name} className={s.enabled ? "" : "opacity-60"}>
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-accent-soft p-2 text-accent"><Sparkles className="size-4" /></div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold">{s.title} <span className="font-mono text-[10px] font-normal text-faint">v{s.version}</span></p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{s.description}</p>
                </div>
                <Switch checked={s.enabled} onChange={() => toggle.mutate(s)} label={`Навык ${s.title}`} />
              </div>
              {s.error && <p className="mt-3 flex items-center gap-1.5 text-xs text-danger"><AlertTriangle className="size-3.5" /> {s.error}</p>}
              {s.requires.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">{s.requires.map((r) => <Badge key={r} tone="warn">требует: {r}</Badge>)}</div>
              )}
              <div className="mt-3 flex flex-wrap gap-1">
                {s.tools.map((t) => <span key={t} className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">{t}</span>)}
                {!s.tools.length && <span className="text-[11px] text-faint">только инструкции</span>}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="truncate text-[11px] text-faint" title={s.triggers.join(", ")}>триггеры: {s.triggers.slice(0, 5).join(", ")}{s.triggers.length > 5 ? "…" : ""}</p>
                {Object.keys(s.config).length > 0 && (
                  <Button size="sm" variant="ghost" icon={<Settings2 className="size-3.5" />} onClick={() => setConfig(s)}>Настроить</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {config && <ConfigModal skill={config} onClose={() => setConfig(null)} />}
    </>
  );
}
