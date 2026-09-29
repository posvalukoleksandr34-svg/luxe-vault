import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { post } from "../lib/api";
import { CHANNEL, RISK, TIER, ago } from "../lib/format";
import type { Approval } from "../lib/types";
import { Badge, Button, ErrorNote } from "./ui";

/** "Я готов выполнить действие. Подтвердить?" */
export function ApprovalCard({ approval, compact }: { approval: Approval; compact?: boolean }) {
  const qc = useQueryClient();
  const [showArgs, setShowArgs] = useState(false);
  const decide = useMutation({
    mutationFn: (body: { approve: boolean; always?: boolean }) => post(`/api/approvals/${approval.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const restricted = approval.tier === "restricted";
  return (
    <div
      className={clsx(
        "rounded-xl border p-3.5",
        restricted ? "border-danger/30 bg-danger/[0.06]" : "border-warn/30 bg-warn/[0.06]",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={clsx("mt-0.5 rounded-lg p-1.5", restricted ? "bg-danger/15 text-danger" : "bg-warn/15 text-warn")}>
          <ShieldAlert className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-text">Я готов выполнить действие. Подтвердить?</p>
          <p className="mt-1 text-sm text-muted break-words">{approval.summary}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone={TIER[approval.tier].tone}>{TIER[approval.tier].label}</Badge>
            <Badge tone={RISK[approval.risk].tone}>{RISK[approval.risk].label}</Badge>
            <span className="font-mono text-[11px] text-faint">{approval.tool}</span>
            {!compact && <span className="text-[11px] text-faint">· {CHANNEL[approval.channel] ?? approval.channel} · {ago(approval.created_at)}</span>}
          </div>
          {showArgs && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-line bg-surface-2 p-2 font-mono text-[11px] text-muted">
              {JSON.stringify(approval.arguments, null, 2)}
            </pre>
          )}
          <ErrorNote error={decide.error} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" icon={<ShieldCheck className="size-3.5" />} loading={decide.isPending}
              onClick={() => decide.mutate({ approve: true })}>
              Подтвердить
            </Button>
            <Button size="sm" variant="secondary" onClick={() => decide.mutate({ approve: false })} disabled={decide.isPending}>
              Отклонить
            </Button>
            {approval.tier === "confirm" && approval.risk !== "high" && (
              <Button size="sm" variant="ghost" onClick={() => decide.mutate({ approve: true, always: true })} disabled={decide.isPending}
                title="Больше не спрашивать для этого инструмента">
                Всегда разрешать
              </Button>
            )}
            <button className="ml-auto text-[11px] text-faint hover:text-muted" onClick={() => setShowArgs((v) => !v)}>
              {showArgs ? "скрыть детали" : "детали"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
