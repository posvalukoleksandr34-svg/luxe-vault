import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Lock, ShieldCheck, Trash2, Zap } from "lucide-react";
import { useState } from "react";

import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner } from "../components/ui";
import { del, get, put } from "../lib/api";
import { CHANNEL, RISK, TIER, ago } from "../lib/format";
import type { Risk, Tier, ToolInfo } from "../lib/types";

interface PermissionsResponse {
  tiers: Tier[];
  risks: Risk[];
  defaults: Record<Risk, Tier>;
  tool_policy: Record<string, Tier>;
  forbidden: string[];
  channels: Record<string, Tier>;
  taint: { write: Tier; exempt: string[] };
  elevation_minutes: number;
  rules: { id: string; target: string; channel: string; tier: Tier; note: string; updated_at: string }[];
}

const TIER_ICON: Record<Tier, React.ReactNode> = {
  autonomous: <Zap className="size-4" />,
  confirm: <ShieldCheck className="size-4" />,
  restricted: <Lock className="size-4" />,
  forbidden: <Ban className="size-4" />,
};

export function PermissionsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["permissions"], queryFn: () => get<PermissionsResponse>("/api/permissions") });
  const tools = useQuery({ queryKey: ["tools"], queryFn: () => get<{ tools: ToolInfo[] }>("/api/tools") });
  const [target, setTarget] = useState("");
  const [tier, setTier] = useState<Tier>("confirm");
  const [channel, setChannel] = useState("*");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["permissions"] });
    qc.invalidateQueries({ queryKey: ["tools"] });
  };
  const upsert = useMutation({ mutationFn: () => put("/api/permissions/rules", { target, tier, channel }), onSuccess: () => { setTarget(""); refresh(); } });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/permissions/rules/${id}`), onSuccess: refresh });
  if (isLoading || !data) return <div className="flex justify-center p-10"><Spinner /></div>;
  return (
    <>
      <PageHeader
        title="Разрешения"
        description="JARVIS автономен, но не безрассуден. Каждый инструмент объявляет риск; политика превращает риск в уровень: автономно, с подтверждением, ограничено (только из веба с повторным входом) или запрещено."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(data.tiers as Tier[]).map((t) => (
          <div key={t} className="rounded-xl border border-line bg-surface p-4">
            <div className={`flex items-center gap-2 text-sm font-semibold ${TIER[t].tone === "ok" ? "text-ok" : TIER[t].tone === "warn" ? "text-warn" : TIER[t].tone === "danger" ? "text-danger" : "text-muted"}`}>
              {TIER_ICON[t]} {TIER[t].label}
            </div>
            <p className="mt-1.5 text-xs text-muted">{TIER[t].hint}</p>
            <p className="mt-3 text-[11px] text-faint">
              по умолчанию для: {(Object.entries(data.defaults) as [Risk, Tier][]).filter(([, v]) => v === t).map(([r]) => RISK[r].label).join(", ") || "—"}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Ваши правила" subtitle="Переопределяют файл config/permissions.yaml (кроме запретов). Ослабление правил требует повторного входа.">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); upsert.mutate(); }}>
            <Field label="Инструмент, skill:<имя> или risk:<уровень>">
              <Input list="tool-names" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="email_send_draft" />
              <datalist id="tool-names">{tools.data?.tools.map((t) => <option key={t.name} value={t.name} />)}</datalist>
            </Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Уровень">
              <Select className="w-full" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
                {data.tiers.map((t) => <option key={t} value={t}>{TIER[t].label}</option>)}
              </Select>
            </Field>
            <Field label="Канал">
              <Select className="w-full" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="*">любой</option>
                {Object.keys(data.channels).map((c) => <option key={c} value={c}>{CHANNEL[c] ?? c}</option>)}
              </Select>
            </Field>
            <Button type="submit" variant="primary" disabled={!target} loading={upsert.isPending}>Сохранить</Button>
            </div>
          </form>
          <ErrorNote error={upsert.error} />
          <ul className="mt-4 divide-y divide-line">
            {data.rules.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{r.target}</span>
                {r.channel !== "*" && <Badge>{CHANNEL[r.channel] ?? r.channel}</Badge>}
                <Badge tone={TIER[r.tier].tone} dot>{TIER[r.tier].label}</Badge>
                <span className="hidden text-[11px] text-faint sm:inline">{ago(r.updated_at)}</span>
                <Button size="icon" variant="ghost" onClick={() => remove.mutate(r.id)} aria-label="Удалить правило"><Trash2 className="size-3.5" /></Button>
              </li>
            ))}
            {!data.rules.length && <p className="py-3 text-xs text-faint">Своих правил нет — действует политика по умолчанию.</p>}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card title="Кто может подтверждать" subtitle="Самый строгий уровень, который можно подтвердить из канала">
            <ul className="space-y-2">
              {Object.entries(data.channels).map(([c, t]) => (
                <li key={c} className="flex items-center justify-between text-sm">
                  <span>{CHANNEL[c] ?? c}</span>
                  <Badge tone={TIER[t].tone}>до «{TIER[t].label}»</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              Повторная аутентификация действует {data.elevation_minutes} мин. Включите 2FA в настройках, чтобы подтверждать кодом.
            </p>
          </Card>
          <Card title="Защита от prompt injection" subtitle="После чтения внешнего содержимого (страницы, письма, файлы) правила ужесточаются">
            <p className="text-sm text-muted">
              Инструменты записи требуют уровня <Badge tone={TIER[data.taint.write].tone}>{TIER[data.taint.write].label}</Badge>, внешние действия — минимум подтверждения.
            </p>
            <p className="mt-2 text-xs text-faint">Исключения: {data.taint.exempt.join(", ") || "нет"}</p>
          </Card>
          <Card title="Политика инструментов" subtitle="config/permissions.yaml + рекомендации навыков">
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {Object.entries(data.tool_policy).map(([k, t]) => (
                <li key={k} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-mono text-muted">{k}</span>
                  <Badge tone={TIER[t].tone}>{TIER[t].label}</Badge>
                </li>
              ))}
            </ul>
            {data.forbidden.length > 0 && (
              <p className="mt-3 text-xs text-muted">Запрещено всегда: <span className="font-mono">{data.forbidden.join(", ")}</span></p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
