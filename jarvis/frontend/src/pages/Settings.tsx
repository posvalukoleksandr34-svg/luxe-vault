import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, KeyRound, Laptop, Moon, Smartphone, Sun, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Spinner } from "../components/ui";
import { del, get, patch, post, put } from "../lib/api";
import { useMe } from "../lib/auth";
import { ago } from "../lib/format";
import type { SystemStatus, User } from "../lib/types";

const SECRET_LABELS: Record<string, { label: string; hint: string }> = {
  anthropic_api_key: { label: "Anthropic (мозг)", hint: "Claude — основная модель. Обязательно." },
  deepgram_api_key: { label: "Deepgram (распознавание речи)", hint: "Nova-3, быстрый STT для голоса и голосовых сообщений" },
  elevenlabs_api_key: { label: "ElevenLabs (синтез речи)", hint: "Flash v2.5, потоковый голос" },
  openai_api_key: { label: "OpenAI (резерв STT/TTS/эмбеддингов)", hint: "Необязательно" },
  voyage_api_key: { label: "Voyage (эмбеддинги)", hint: "Необязательно; по умолчанию локальные эмбеддинги" },
  tavily_api_key: { label: "Tavily (поиск)", hint: "Если поиск не через Anthropic" },
  brave_api_key: { label: "Brave Search", hint: "Альтернатива Tavily" },
  telegram_bot_token: { label: "Telegram bot token", hint: "От @BotFather" },
  whatsapp_access_token: { label: "WhatsApp access token", hint: "Meta Cloud API" },
  whatsapp_app_secret: { label: "WhatsApp app secret", hint: "Для проверки подписи webhook" },
  google_client_secret: { label: "Google OAuth client secret", hint: "Вместе с GOOGLE_CLIENT_ID" },
};

function SecretRow({ k, status }: { k: string; status: { configured: boolean; source: string } }) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const save = useMutation({
    mutationFn: (v: string | null) => put(`/api/settings/secrets/${k}`, { value: v }),
    onSuccess: () => {
      setEditing(false);
      setValue("");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["system"] });
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
  });
  const meta = SECRET_LABELS[k] ?? { label: k, hint: "" };
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{meta.label}</p>
          <p className="text-xs text-faint">{meta.hint}</p>
        </div>
        {status.configured ? (
          <Badge tone="ok" dot>{status.source === "env" ? "задан в .env" : "задан"}</Badge>
        ) : (
          <Badge dot>не задан</Badge>
        )}
        {status.source !== "env" && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{status.configured ? "Заменить" : "Задать"}</Button>
        )}
        {status.source !== "env" && status.configured && !editing && (
          <Button size="sm" variant="ghost" onClick={() => confirm("Удалить ключ?") && save.mutate(null)}>Удалить</Button>
        )}
      </div>
      {editing && (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(value); }}>
          <Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Ключ хранится зашифрованным и никогда не показывается" autoFocus />
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!value}>Сохранить</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>
        </form>
      )}
      <ErrorNote error={save.error} />
    </li>
  );
}

function TotpSetup({ user }: { user: User }) {
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const start = useMutation({ mutationFn: () => post<{ secret: string; otpauth_uri: string }>("/api/auth/totp/setup"), onSuccess: setSetup });
  const enable = useMutation({ mutationFn: () => post("/api/auth/totp/enable", { code }), onSuccess: () => { setSetup(null); qc.invalidateQueries({ queryKey: ["me"] }); } });
  const disable = useMutation({ mutationFn: () => post("/api/auth/totp/disable", { code }), onSuccess: () => { setCode(""); qc.invalidateQueries({ queryKey: ["me"] }); } });
  if (user.totp_enabled)
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm text-ok"><CheckCircle2 className="size-4" /> 2FA включена</p>
        <div className="flex gap-2">
          <Input className="max-w-40" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Код" />
          <Button variant="danger" onClick={() => disable.mutate()} loading={disable.isPending} disabled={!code}>Отключить</Button>
        </div>
        <ErrorNote error={disable.error} />
      </div>
    );
  if (!setup) return <Button onClick={() => start.mutate()} loading={start.isPending} icon={<KeyRound className="size-4" />}>Включить 2FA (TOTP)</Button>;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">Добавьте аккаунт в приложение-аутентификатор (1Password, Authy, Google Authenticator): откройте ссылку на телефоне или введите секрет вручную.</p>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
        <code className="flex-1 font-mono text-xs break-all">{setup.secret}</code>
        <Button size="icon" variant="ghost" onClick={() => navigator.clipboard.writeText(setup.secret)} aria-label="Копировать"><Copy className="size-3.5" /></Button>
      </div>
      <a className="text-xs text-accent underline" href={setup.otpauth_uri}>otpauth-ссылка</a>
      <div className="flex gap-2">
        <Input className="max-w-40" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Код из приложения" />
        <Button variant="primary" onClick={() => enable.mutate()} loading={enable.isPending} disabled={!code}>Подтвердить</Button>
      </div>
      <ErrorNote error={enable.error} />
    </div>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["sessions"], queryFn: () => get<{ sessions: { id: string; kind: string; name: string; user_agent: string | null; ip: string | null; last_seen_at: string; scopes: string[]; current: boolean }[] }>("/api/auth/sessions") });
  const revoke = useMutation({ mutationFn: (id: string) => del(`/api/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }) });
  const [deviceName, setDeviceName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const device = useMutation({
    mutationFn: () => post<{ token: string }>("/api/auth/devices", { name: deviceName, scopes: ["voice", "chat"] }),
    onSuccess: (r) => { setToken(r.token); setDeviceName(""); qc.invalidateQueries({ queryKey: ["sessions"] }); },
  });
  return (
    <>
      <ul className="divide-y divide-line">
        {data?.sessions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2.5">
            {s.kind === "device" ? <Smartphone className="size-4 text-violet" /> : <Laptop className="size-4 text-muted" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{s.kind === "device" ? s.name : s.user_agent?.split(" ").slice(-2).join(" ") || "Браузер"} {s.current && <Badge tone="accent">текущая</Badge>}</p>
              <p className="text-[11px] text-faint">{s.ip ?? "—"} · активность {ago(s.last_seen_at)}{s.scopes.length ? ` · ${s.scopes.join(", ")}` : ""}</p>
            </div>
            {!s.current && <Button size="icon" variant="ghost" onClick={() => revoke.mutate(s.id)} aria-label="Отозвать"><Trash2 className="size-3.5" /></Button>}
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); device.mutate(); }}>
        <Input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="Новое устройство: «Сателлит на кухне»" />
        <Button type="submit" disabled={!deviceName} loading={device.isPending}>Выдать токен</Button>
      </form>
      <Modal open={!!token} onClose={() => setToken(null)} title="Токен устройства">
        <p className="text-sm text-muted">Показывается один раз. Вставьте его в <code className="font-mono">satellite/.env</code> как JARVIS_TOKEN.</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <code className="flex-1 font-mono text-xs break-all">{token}</code>
          <Button size="icon" variant="ghost" onClick={() => token && navigator.clipboard.writeText(token)} aria-label="Копировать"><Copy className="size-3.5" /></Button>
        </div>
      </Modal>
    </>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const me = useMe();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => get<{ secrets: Record<string, { configured: boolean; source: string }>; providers: Record<string, string> }>("/api/settings") });
  const sys = useQuery({ queryKey: ["system"], queryFn: () => get<SystemStatus>("/api/system/status") });
  const user = me.data?.user;
  const [profile, setProfile] = useState<{ display_name?: string; timezone?: string }>({});
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? "dark");
  const saveProfile = useMutation({ mutationFn: (body: object) => patch("/api/settings/profile", body), onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }) });
  const changePw = useMutation({ mutationFn: () => post("/api/auth/password", pw), onSuccess: () => setPw({ current_password: "", new_password: "" }) });
  if (!user || settings.isLoading) return <div className="flex justify-center p-10"><Spinner /></div>;
  const channels = user.settings.notify_channels ?? ["web", "telegram", "whatsapp"];
  const applyTheme = (t: string) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("jarvis.theme", t); } catch { /* private mode */ }
  };
  return (
    <>
      <PageHeader title="Настройки" description="Профиль, ключи, модели и безопасность." />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card title="Профиль">
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveProfile.mutate(profile); }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Имя"><Input defaultValue={user.display_name} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} /></Field>
                <Field label="Часовой пояс (IANA)" hint="Напоминания и календарь считаются в нём"><Input defaultValue={user.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} /></Field>
              </div>
              <Button type="submit" variant="primary" loading={saveProfile.isPending}>Сохранить</Button>
              <ErrorNote error={saveProfile.error} />
            </form>
          </Card>
          <Card title="Уведомления и внешний вид">
            <p className="mb-2 text-xs text-muted">Куда доставлять напоминания и результаты фоновых задач</p>
            <div className="flex flex-wrap gap-2">
              {["web", "telegram", "whatsapp"].map((c) => (
                <label key={c} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                  <input type="checkbox" checked={channels.includes(c)}
                    onChange={(e) => saveProfile.mutate({ notify_channels: e.target.checked ? [...channels, c] : channels.filter((x) => x !== c) })} />
                  {c === "web" ? "Web" : c === "telegram" ? "Telegram" : "WhatsApp"}
                </label>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-xs text-muted">Тема</span>
              <Button size="sm" variant={theme === "dark" ? "primary" : "secondary"} icon={<Moon className="size-3.5" />} onClick={() => applyTheme("dark")}>Тёмная</Button>
              <Button size="sm" variant={theme === "light" ? "primary" : "secondary"} icon={<Sun className="size-3.5" />} onClick={() => applyTheme("light")}>Светлая</Button>
            </div>
          </Card>
          <Card title="Модели" subtitle="config/models.yaml — маршрутизация задач по моделям">
            <ul className="space-y-1.5 text-sm">
              {Object.entries(sys.data?.brain.routes ?? {}).map(([name, r]) => (
                <li key={name} className="flex items-center gap-2">
                  <span className="w-16 font-mono text-xs text-muted">{name}</span>
                  <span className="font-mono text-xs">{r.model}</span>
                  {r.effort && <Badge>effort {r.effort}</Badge>}
                  <span className="ml-auto text-[11px] text-faint">{r.provider}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              Эмбеддинги: <span className="font-mono">{sys.data?.embeddings.model}</span> · Поиск: {settings.data?.providers.search} · STT: {settings.data?.providers.stt} · TTS: {settings.data?.providers.tts}
            </p>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Ключи API" subtitle="Хранятся зашифрованными (Fernet). Значения из .env имеют приоритет. Изменение требует повторного входа.">
            <ul className="divide-y divide-line">
              {Object.entries(settings.data?.secrets ?? {}).map(([k, v]) => <SecretRow key={k} k={k} status={v} />)}
            </ul>
          </Card>
          <Card title="Безопасность">
            <div className="space-y-5">
              <TotpSetup user={user} />
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); changePw.mutate(); }}>
                <p className="text-xs font-medium text-muted">Смена пароля (другие сессии будут завершены)</p>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Input type="password" autoComplete="current-password" placeholder="Текущий" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
                  <Input type="password" autoComplete="new-password" placeholder="Новый (от 10 символов)" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
                  <Button type="submit" disabled={!pw.current_password || pw.new_password.length < 10} loading={changePw.isPending}>Сменить</Button>
                </div>
                {changePw.isSuccess && <p className="text-xs text-ok">Пароль изменён</p>}
                <ErrorNote error={changePw.error} />
              </form>
            </div>
          </Card>
          <Card title="Сессии и устройства">
            <Sessions />
          </Card>
          <Card title="Система">
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-muted">Версия</dt><dd className="font-mono">{sys.data?.version}</dd>
              <dt className="text-muted">Окружение</dt><dd className="font-mono">{sys.data?.env}</dd>
              <dt className="text-muted">Публичный URL</dt><dd className="truncate font-mono">{sys.data?.public_url}</dd>
              <dt className="text-muted">Воркеры</dt><dd className="font-mono">{sys.data?.embedded_worker ? "встроенный" : sys.data?.workers.map((w) => `${w.id} (${w.running}/${w.concurrency})`).join(", ") || "нет"}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
