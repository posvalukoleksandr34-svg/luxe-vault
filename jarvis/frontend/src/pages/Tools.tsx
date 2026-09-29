import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge, Card, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { get } from "../lib/api";
import { RISK, TIER } from "../lib/format";
import type { ToolInfo } from "../lib/types";

export function ToolsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["tools"],
    queryFn: () => get<{ tools: ToolInfo[]; availability: Record<string, boolean>; mcp: Record<string, { ok: boolean; tools?: number; error?: string }>; server_tools: boolean }>("/api/tools"),
  });
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [open, setOpen] = useState<ToolInfo | null>(null);
  const tools = useMemo(
    () => (data?.tools ?? []).filter((t) => (!q || `${t.name} ${t.description}`.toLowerCase().includes(q.toLowerCase())) && (!source || t.source === source)),
    [data, q, source],
  );
  return (
    <>
      <PageHeader
        title="Инструменты"
        description="Реестр действий, доступных JARVIS. У каждого — схема входа, уровень риска, таймаут, ретраи и уровень разрешения. Инструменты из навыков и MCP-серверов подключаются без изменения ядра."
      />
      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="absolute top-2.5 left-3 size-4 text-faint" />
          <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск инструмента" />
        </div>
        <Select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Все источники</option>
          <option value="builtin">Ядро</option>
          <option value="skill">Навыки</option>
          <option value="mcp">MCP</option>
        </Select>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {Object.entries(data?.availability ?? {}).map(([k, v]) => (
          <Badge key={k} tone={v ? "ok" : "muted"} dot>{k}</Badge>
        ))}
        {data?.server_tools && <Badge tone="accent">web_search / web_fetch: на стороне Anthropic</Badge>}
        {Object.entries(data?.mcp ?? {}).map(([k, v]) => (
          <Badge key={k} tone={v.ok ? "ok" : "danger"} dot>MCP {k}{v.ok ? ` · ${v.tools}` : ""}</Badge>
        ))}
      </div>
      <Card padded={false}>
        {isLoading ? (
          <div className="flex justify-center p-10"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line text-xs text-faint">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Инструмент</th>
                  <th className="px-4 py-2.5 font-medium">Источник</th>
                  <th className="px-4 py-2.5 font-medium">Риск</th>
                  <th className="px-4 py-2.5 font-medium">Разрешение</th>
                  <th className="px-4 py-2.5 font-medium">Доступен</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.name} onClick={() => setOpen(t)} className={clsx("cursor-pointer border-b border-line/70 last:border-0 hover:bg-hover", !t.available && "opacity-55")}>
                    <td className="max-w-lg px-4 py-2.5">
                      <p className="font-mono text-[13px]">{t.name}</p>
                      <p className="truncate text-xs text-muted">{t.description}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{t.source === "builtin" ? "ядро" : t.source === "mcp" ? "MCP" : t.skill}</td>
                    <td className="px-4 py-2.5"><Badge tone={RISK[t.risk].tone}>{RISK[t.risk].label}</Badge></td>
                    <td className="px-4 py-2.5"><Badge tone={TIER[t.tier].tone} dot>{TIER[t.tier].label}</Badge></td>
                    <td className="px-4 py-2.5 text-xs">{t.available ? <span className="text-ok">да</span> : <span className="text-faint">нет{t.missing.length ? ` (${t.missing.join(", ")})` : ""}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && (
        <Modal open onClose={() => setOpen(null)} title={<span className="font-mono">{open.name}</span>} wide>
          <p className="text-sm text-muted">{open.description}</p>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <Badge tone={RISK[open.risk].tone}>риск: {RISK[open.risk].label}</Badge>
            <Badge tone={TIER[open.tier].tone}>{TIER[open.tier].label} — {open.tier_reason}</Badge>
            <Badge>таймаут {open.timeout_s} с</Badge>
            <Badge>ретраи {open.retries}</Badge>
            <Badge>{open.idempotent ? "идемпотентный" : "не идемпотентный"}</Badge>
            {open.activity && <Badge tone="accent">статус: «{open.activity}»</Badge>}
          </div>
          <p className="mt-4 mb-1.5 text-xs font-medium text-muted">Схема входа</p>
          <pre className="max-h-96 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px]">{JSON.stringify(open.input_schema, null, 2)}</pre>
        </Modal>
      )}
    </>
  );
}
