import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, UserPlus } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router";

import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Stat, Switch, Textarea } from "../components/ui";
import { get, patch, post, put } from "../lib/api";
import { useMe } from "../lib/auth";
import { ago, usd } from "../lib/format";

interface Overview {
  version: { app: string; api: string; schema: string | null };
  users: number;
  active_this_month: number;
  subscriptions: Record<string, number>;
  usage_this_month: Record<string, number>;
  llm_spend_month_usd: number;
  failed_tasks_month: number;
  open_support_reports: number;
  signup_mode: string;
  maintenance: { enabled: boolean; message: string };
  flags: Record<string, boolean>;
  flag_labels: Record<string, string>;
  plans: Record<string, { id: string; title: string; hidden: boolean }>;
}
interface AdminUser {
  id: string;
  email: string;
  name: string;
  is_owner: boolean;
  created_at: string;
  email_verified: boolean;
  disabled: boolean;
  plan: string;
  subscription: { plan: string; status: string; provider: string } | null;
  usage: Record<string, number>;
}
interface Report {
  id: string;
  kind: string;
  message: string;
  status: string;
  email: string | null;
  created_at: string;
  context: Record<string, string>;
}

function Users({ plans }: { plans: Overview["plans"] }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const users = useQuery({ queryKey: ["admin-users", q], queryFn: () => get<{ users: AdminUser[] }>(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`) });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => patch(`/api/admin/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", plan: "" });
  const create = useMutation({
    mutationFn: () => post("/api/admin/users", { ...form, plan: form.plan || undefined }),
    onSuccess: () => { setAdding(false); setForm({ email: "", password: "", name: "", plan: "" }); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });
  return (
    <Card title="Пользователи" actions={<Button size="sm" icon={<UserPlus className="size-3.5" />} onClick={() => setAdding(true)}>Создать</Button>}>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по e-mail" className="mb-3" />
      {users.isLoading ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-faint">
              <tr><th className="py-2 pr-3 font-medium">Аккаунт</th><th className="pr-3 font-medium">Тариф</th><th className="pr-3 font-medium">Сообщений</th><th className="pr-3 font-medium">Модель, $</th><th className="pr-3 font-medium">Статус</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.data?.users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 pr-3">
                    <p className="text-sm text-text">{u.email} {u.is_owner && <Badge tone="accent">владелец</Badge>}</p>
                    <p className="text-faint">{u.name} · {ago(u.created_at)} {!u.email_verified && "· e-mail не подтверждён"}</p>
                  </td>
                  <td className="pr-3">
                    {u.is_owner ? "Owner" : u.subscription?.provider === "stripe" ? (
                      <span>{plans[u.plan]?.title ?? u.plan} <Badge>Stripe · {u.subscription.status}</Badge></span>
                    ) : (
                      <Select value={u.subscription?.plan ?? ""} onChange={(e) => update.mutate({ id: u.id, body: { plan: e.target.value } })} aria-label="Тариф">
                        <option value="">по умолчанию</option>
                        {Object.values(plans).filter((p) => !p.hidden).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                      </Select>
                    )}
                  </td>
                  <td className="pr-3 font-mono">{u.usage.messages_month ?? 0}</td>
                  <td className="pr-3 font-mono">{(u.usage.llm_usd_month ?? 0).toFixed(2)}</td>
                  <td className="pr-3">
                    {!u.is_owner && <Switch checked={!u.disabled} onChange={(v) => update.mutate({ id: u.id, body: { disabled: !v } })} label={u.disabled ? "Заблокирован" : "Активен"} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorNote error={update.error} />
      <Modal open={adding} onClose={() => setAdding(false)} title="Новый пользователь">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
          <Field label="Имя"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Временный пароль" hint="Минимум 10 символов; попросите сменить после входа"><Input type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
          <Field label="Тариф">
            <Select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} className="w-full">
              <option value="">по умолчанию</option>
              {Object.values(plans).filter((p) => !p.hidden).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </Select>
          </Field>
          <ErrorNote error={create.error} />
          <Button type="submit" variant="primary" loading={create.isPending}>Создать</Button>
        </form>
      </Modal>
    </Card>
  );
}

function Invite() {
  const [email, setEmail] = useState("");
  const invite = useMutation({ mutationFn: () => post<{ link: string; emailed: boolean; signup_mode: string }>("/api/admin/invites", { email: email || undefined }) });
  return (
    <Card title="Приглашение" subtitle="Одноразовая ссылка на регистрацию (нужен JARVIS_SIGNUP_MODE=invite или open)">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e-mail (необязательно)" />
        <Button type="submit" loading={invite.isPending}>Создать</Button>
      </form>
      {invite.data && (
        <div className="mt-3 space-y-1 text-xs">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
            <code className="flex-1 font-mono break-all">{invite.data.link}</code>
            <Button size="icon" variant="ghost" onClick={() => navigator.clipboard.writeText(invite.data!.link)} aria-label="Копировать"><Copy className="size-3.5" /></Button>
          </div>
          <p className="text-muted">{invite.data.emailed ? "Письмо отправлено." : "Передайте ссылку сами (почта не настроена или e-mail не указан)."} {invite.data.signup_mode === "closed" && "Внимание: регистрация сейчас закрыта (JARVIS_SIGNUP_MODE=closed)."}</p>
        </div>
      )}
      <ErrorNote error={invite.error} />
    </Card>
  );
}

function Support() {
  const qc = useQueryClient();
  const reports = useQuery({ queryKey: ["admin-support"], queryFn: () => get<{ reports: Report[] }>("/api/admin/support?status=open") });
  const resolve = useMutation({ mutationFn: (id: string) => patch(`/api/admin/support/${id}`, { status: "resolved" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-support"] }) });
  return (
    <Card title="Обращения" subtitle="Ошибки, идеи и вопросы пользователей">
      {!reports.data?.reports.length ? <p className="text-sm text-muted">Открытых обращений нет.</p> : (
        <ul className="divide-y divide-line">
          {reports.data.reports.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-center gap-2 text-xs">
                <Badge tone={r.kind === "bug" ? "danger" : "accent"}>{r.kind}</Badge>
                <span className="text-muted">{r.email ?? "удалённый аккаунт"} · {ago(r.created_at)} · {r.context.page} · v{r.context.version}</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => resolve.mutate(r.id)}>Решено</Button>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{r.message}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function AdminPage() {
  const me = useMe();
  const qc = useQueryClient();
  const ov = useQuery({ queryKey: ["admin"], queryFn: () => get<Overview>("/api/admin/overview"), enabled: !!me.data?.user.is_owner });
  const flags = useMutation({ mutationFn: (f: Record<string, boolean>) => put("/api/admin/flags", { flags: f }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }) });
  const [maintMsg, setMaintMsg] = useState<string | null>(null);
  const maint = useMutation({ mutationFn: (enabled: boolean) => put("/api/admin/maintenance", { enabled, message: maintMsg ?? ov.data?.maintenance.message ?? "" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }) });
  if (me.data && !me.data.user.is_owner) return <Navigate to="/" replace />;
  if (!ov.data) return <div className="flex justify-center p-10"><Spinner /></div>;
  const d = ov.data;
  return (
    <>
      <PageHeader title="Админка" description={`Версия ${d.version.app} · API ${d.version.api} · схема БД ${d.version.schema ?? "?"} · регистрация: ${d.signup_mode}`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Пользователи" value={d.users} sub={`${d.active_this_month} активны в этом месяце`} />
        <Stat label="Подписки" value={Object.values(d.subscriptions).reduce((a, b) => a + b, 0)} sub={Object.entries(d.subscriptions).map(([k, v]) => `${k}: ${v}`).join(" · ") || "нет"} />
        <Stat label="Сообщений за месяц" value={d.usage_this_month.messages ?? 0} />
        <Stat label="Расход на модели" value={usd(d.llm_spend_month_usd)} sub="за месяц, все аккаунты" />
        <Stat label="Ошибки задач" value={d.failed_tasks_month} sub={`${d.open_support_reports} открытых обращений`} tone={d.failed_tasks_month ? "warn" : undefined} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Users plans={d.plans} />
          <Support />
        </div>
        <div className="space-y-6">
          <Card title="Режим обслуживания" subtitle="Пользователи видят сообщение и не могут работать; владелец — может">
            <div className="flex items-center gap-3">
              <Switch checked={d.maintenance.enabled} onChange={(v) => maint.mutate(v)} label="Режим обслуживания" />
              {d.maintenance.enabled ? <Badge tone="warn" dot>включён</Badge> : <Badge dot>выключен</Badge>}
            </div>
            <Field label="Сообщение для пользователей">
              <Textarea rows={2} value={maintMsg ?? d.maintenance.message} onChange={(e) => setMaintMsg(e.target.value)} placeholder="Обновляемся, вернёмся через 10 минут" />
            </Field>
            <ErrorNote error={maint.error} />
          </Card>
          <Card title="Функции (выключатели)" subtitle="Глобально для всех аккаунтов, поверх тарифов">
            <ul className="space-y-2">
              {Object.entries(d.flag_labels).map(([k, label]) => (
                <li key={k} className="flex items-center gap-3 text-sm">
                  <Switch checked={d.flags[k] ?? true} onChange={(v) => flags.mutate({ [k]: v })} label={label} />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
            <ErrorNote error={flags.error} />
          </Card>
          <Invite />
          <Card title="Использование за месяц">
            <ul className="space-y-1 text-xs">
              {Object.entries(d.usage_this_month).sort().map(([k, v]) => (
                <li key={k} className="flex justify-between"><span className="font-mono text-muted">{k}</span><span className="font-mono">{v}</span></li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-faint">Только счётчики — без содержимого сообщений.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
