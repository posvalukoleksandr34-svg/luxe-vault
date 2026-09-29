import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LifeBuoy, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { api, get, post } from "../lib/api";
import { LIMIT_LABELS, PlanCard, type PublicPlan } from "../pages/Public";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Spinner, Textarea } from "./ui";

interface Metric {
  used: number;
  limit: number | null;
}
interface AccountInfo {
  user: { email: string; is_owner: boolean; email_verified: boolean };
  plan: PublicPlan;
  subscription: { source: string; status: string | null; provider: string | null; current_period_end: string | null; cancel_at_period_end: boolean; trial_ends_at: string | null };
  usage: { period: string; metrics: Record<string, Metric> };
  billing: { configured: boolean };
  plans: PublicPlan[];
}

const STATUS: Record<string, string> = {
  active: "активна", trialing: "пробный период", past_due: "проблема с оплатой", canceled: "отменена",
  unpaid: "не оплачена", incomplete: "не завершена", manual: "назначена владельцем",
};

function UsageBar({ name, m }: { name: string; m: Metric }) {
  const pct = m.limit ? Math.min(100, (m.used / m.limit) * 100) : 0;
  const tone = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warn" : "bg-accent";
  const fmt = (v: number) => (name === "llm_usd_month" ? `$${v.toFixed(2)}` : String(Math.round(v)));
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted">{LIMIT_LABELS[name] ?? name}</span>
        <span className="font-mono">{fmt(m.used)}{m.limit !== null ? ` / ${fmt(m.limit)}` : " · без лимита"}</span>
      </div>
      {m.limit !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elevated" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function SupportForm() {
  const [kind, setKind] = useState("bug");
  const [message, setMessage] = useState("");
  const send = useMutation({ mutationFn: () => post("/api/support", { kind, message, page: location.pathname }), onSuccess: () => setMessage("") });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
      <div className="flex gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Тип обращения">
          <option value="bug">Ошибка</option>
          <option value="feedback">Идея / отзыв</option>
          <option value="support">Вопрос</option>
        </Select>
      </div>
      <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Что случилось или что улучшить? Не вставляйте пароли и ключи." />
      <div className="flex items-center gap-2">
        <Button type="submit" icon={<LifeBuoy className="size-4" />} loading={send.isPending} disabled={message.trim().length < 3}>Отправить</Button>
        {send.isSuccess && <Badge tone="ok">Отправлено владельцу</Badge>}
      </div>
      <p className="text-[11px] text-faint">К обращению прикладываются только версия, страница и браузер.</p>
      <ErrorNote error={send.error} />
    </form>
  );
}

export function AccountSettings() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const acc = useQuery({ queryKey: ["account"], queryFn: () => get<AccountInfo>("/api/account") });
  const checkout = useMutation({ mutationFn: (plan: string) => post<{ url: string }>("/api/billing/checkout", { plan }), onSuccess: (r) => (location.href = r.url) });
  const portal = useMutation({ mutationFn: () => post<{ url: string }>("/api/billing/portal"), onSuccess: (r) => (location.href = r.url) });
  const resend = useMutation({ mutationFn: () => post<{ sent: boolean; reason: string | null }>("/api/auth/verify/resend") });
  const [exportErr, setExportErr] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);
  const [del, setDel] = useState(false);
  const [delForm, setDelForm] = useState({ password: "", confirm_email: "" });
  const remove = useMutation({ mutationFn: () => post("/api/account/delete", delForm), onSuccess: () => { qc.setQueryData(["me"], null); location.href = "/login"; } });

  if (acc.isLoading || !acc.data) return <div className="flex justify-center p-6"><Spinner /></div>;
  const a = acc.data;
  const sub = a.subscription;
  const exportData = async () => {
    setExporting(true);
    setExportErr(null);
    try {
      const data = await api("/api/account/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `jarvis-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportErr(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {params.get("billing") === "success" && <p className="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">Оплата прошла. Тариф обновится, как только платёжная система подтвердит её (обычно в течение минуты).</p>}
      {params.get("billing") === "cancel" && <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted">Оплата отменена — ничего не списано.</p>}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Тариф" subtitle={a.user.is_owner ? "Вы владелец этой установки — ограничений нет." : undefined}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold">{a.plan.title}</p>
            {sub.status && <Badge tone={sub.status === "past_due" ? "warn" : "accent"}>{STATUS[sub.status] ?? sub.status}</Badge>}
            {sub.cancel_at_period_end && <Badge tone="warn">отменится в конце периода</Badge>}
          </div>
          {sub.current_period_end && <p className="mt-1 text-xs text-muted">Текущий период до {new Date(sub.current_period_end).toLocaleDateString()}</p>}
          {sub.trial_ends_at && <p className="mt-1 text-xs text-muted">Пробный период до {new Date(sub.trial_ends_at).toLocaleDateString()}</p>}
          <div className="mt-4 space-y-3">
            {Object.entries(a.usage.metrics).map(([k, m]) => <UsageBar key={k} name={k} m={m} />)}
          </div>
          <p className="mt-3 text-[11px] text-faint">Месяц {a.usage.period} (UTC). Бюджет модели считается по фактической стоимости запросов.</p>
          {sub.provider === "stripe" && (
            <Button className="mt-4" loading={portal.isPending} onClick={() => portal.mutate()}>Управлять подпиской и оплатой</Button>
          )}
          <ErrorNote error={portal.error} />
        </Card>
        <Card title="Аккаунт">
          <p className="text-sm">{a.user.email} {a.user.email_verified ? <Badge tone="ok" dot>подтверждён</Badge> : <Badge tone="warn" dot>не подтверждён</Badge>}</p>
          {!a.user.email_verified && (
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" loading={resend.isPending} onClick={() => resend.mutate()}>Отправить письмо ещё раз</Button>
              {resend.data && <span className="text-xs text-muted">{resend.data.sent ? "Письмо отправлено" : resend.data.reason}</span>}
            </div>
          )}
          <div className="mt-5 space-y-2">
            <p className="text-xs font-medium text-muted">Ваши данные</p>
            <div className="flex flex-wrap gap-2">
              <Button icon={<Download className="size-4" />} loading={exporting} onClick={exportData}>Скачать все мои данные (JSON)</Button>
              {!a.user.is_owner && <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDel(true)}>Удалить аккаунт</Button>}
            </div>
            <ErrorNote error={exportErr} />
          </div>
        </Card>
      </div>

      {!a.user.is_owner && a.plans.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-semibold">Сменить тариф</p>
          <div className="grid gap-4 md:grid-cols-3">
            {a.plans.map((p) => (
              <PlanCard key={p.id} plan={p} current={p.id === a.plan.id} action={
                p.id === a.plan.id ? undefined : sub.provider === "stripe" ? (
                  <Button className="w-full" onClick={() => portal.mutate()}>Сменить в кабинете оплаты</Button>
                ) : p.purchasable && a.billing.configured ? (
                  <Button variant="primary" className="w-full" loading={checkout.isPending && checkout.variables === p.id} onClick={() => checkout.mutate(p.id)}>Перейти на {p.title}</Button>
                ) : p.price_month ? (
                  <p className="text-center text-xs text-faint">Онлайн-оплата на этом сервере не настроена — обратитесь к владельцу.</p>
                ) : undefined
              } />
            ))}
          </div>
          <ErrorNote error={checkout.error} />
        </div>
      )}

      <Card title="Поддержка и обратная связь"><SupportForm /></Card>

      <Modal open={del} onClose={() => setDel(false)} title="Удалить аккаунт">
        <p className="text-sm text-muted">Будут удалены переписка, память, задачи, команды, автоматизации, интеграции и файлы. Это необратимо. Сначала можно скачать данные.</p>
        <div className="mt-4 space-y-3">
          <Field label="Пароль"><Input type="password" value={delForm.password} onChange={(e) => setDelForm({ ...delForm, password: e.target.value })} /></Field>
          <Field label={`Введите ваш e-mail (${a.user.email}) для подтверждения`}><Input value={delForm.confirm_email} onChange={(e) => setDelForm({ ...delForm, confirm_email: e.target.value })} /></Field>
          <ErrorNote error={remove.error} />
          <Button variant="danger" loading={remove.isPending} disabled={!delForm.password || delForm.confirm_email.trim().toLowerCase() !== a.user.email} onClick={() => remove.mutate()}>Удалить навсегда</Button>
        </div>
      </Modal>
    </div>
  );
}
