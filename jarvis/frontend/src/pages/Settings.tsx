import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, ExternalLink, KeyRound, Laptop, Monitor, Moon, Smartphone, Sun, SunMoon, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { VoiceSettings } from "../components/VoiceSettings";
import { del, get, patch, post, put } from "../lib/api";
import { useMe } from "../lib/auth";
import { ago } from "../lib/format";
import { ACCENTS, accentName, setAppearance, type ThemeMode, themeMode } from "../lib/theme";
import type { DeviceInfo, SystemStatus, User } from "../lib/types";

const SECRET_LABELS: Record<string, { label: string; hint: string }> = {
  anthropic_api_key: { label: "Anthropic (Claude)", hint: "Не нужен, если мозг — OpenAI" },
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
  spotify_client_secret: { label: "Spotify client secret", hint: "Вместе с SPOTIFY_CLIENT_ID" },
};

const BRAIN_LABELS: Record<string, { label: string; hint: string }> = {
  anthropic_api_key: { label: "Anthropic (Claude)", hint: "Не нужен, если мозг — OpenAI" },
  openai_api_key: { label: "OpenAI (мозг)", hint: "GPT — основная модель (JARVIS_LLM_PROVIDER=openai). Обязательно." },
};

function SecretRow({ k, status, brainKey }: { k: string; status: { configured: boolean; source: string }; brainKey?: string }) {
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
  const meta = (k === brainKey ? BRAIN_LABELS[k] : undefined) ?? SECRET_LABELS[k] ?? { label: k, hint: "" };
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

const DEVICE_KINDS = {
  computer: { label: "Компьютер (desktop-агент)", scopes: ["computer"], file: "desktop.env (JARVIS_TOKEN) — см. desktop/README.md", placeholder: "Мой ПК" },
  satellite: { label: "Голосовой сателлит", scopes: ["voice", "chat"], file: "satellite/.env как JARVIS_TOKEN", placeholder: "Сателлит на кухне" },
  script: { label: "Скрипт / API (только чат)", scopes: ["chat"], file: "заголовок Authorization: Bearer <токен>", placeholder: "Мой скрипт" },
} as const;
type DeviceKind = keyof typeof DEVICE_KINDS;

function Sessions() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["sessions"], queryFn: () => get<{ sessions: { id: string; kind: string; name: string; user_agent: string | null; ip: string | null; last_seen_at: string; scopes: string[]; current: boolean }[] }>("/api/auth/sessions") });
  const online = useQuery({ queryKey: ["devices"], queryFn: () => get<{ devices: DeviceInfo[] }>("/api/devices"), refetchInterval: 15_000 });
  const revoke = useMutation({ mutationFn: (id: string) => del(`/api/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }) });
  const [deviceName, setDeviceName] = useState("");
  const [kind, setKind] = useState<DeviceKind>("computer");
  const [token, setToken] = useState<{ token: string; kind: DeviceKind } | null>(null);
  const device = useMutation({
    mutationFn: () => post<{ token: string }>("/api/auth/devices", { name: deviceName, scopes: DEVICE_KINDS[kind].scopes }),
    onSuccess: (r) => { setToken({ token: r.token, kind }); setDeviceName(""); qc.invalidateQueries({ queryKey: ["sessions"] }); },
  });
  return (
    <>
      {!!online.data?.devices.length && (
        <div className="mb-3 space-y-1.5">
          {online.data.devices.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-lg border border-ok/25 bg-ok/5 px-3 py-2 text-xs">
              <Monitor className="size-3.5 text-ok" />
              <span className="text-text">{d.name}</span>
              <span className="text-faint">{d.platform} · в сети</span>
              <span className="ml-auto truncate text-faint">{d.capabilities.join(", ")}</span>
            </div>
          ))}
        </div>
      )}
      <ul className="divide-y divide-line">
        {data?.sessions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2.5">
            {s.kind === "device" ? (s.scopes.includes("computer") ? <Monitor className="size-4 text-violet" /> : <Smartphone className="size-4 text-violet" />) : <Laptop className="size-4 text-muted" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{s.kind === "device" ? s.name : s.user_agent?.split(" ").slice(-2).join(" ") || "Браузер"} {s.current && <Badge tone="accent">текущая</Badge>}</p>
              <p className="text-[11px] text-faint">{s.ip ?? "—"} · активность {ago(s.last_seen_at)}{s.scopes.length ? ` · ${s.scopes.join(", ")}` : ""}</p>
            </div>
            {!s.current && <Button size="icon" variant="ghost" onClick={() => revoke.mutate(s.id)} aria-label="Отозвать"><Trash2 className="size-3.5" /></Button>}
          </li>
        ))}
      </ul>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); device.mutate(); }}>
        <Select value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)} aria-label="Тип устройства">
          {Object.entries(DEVICE_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Input className="min-w-40 flex-1" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder={`Название: «${DEVICE_KINDS[kind].placeholder}»`} />
        <Button type="submit" disabled={!deviceName} loading={device.isPending}>Выдать токен</Button>
      </form>
      <ErrorNote error={device.error} />
      <Modal open={!!token} onClose={() => setToken(null)} title="Токен устройства">
        <p className="text-sm text-muted">Показывается один раз. Куда вставить: {token && DEVICE_KINDS[token.kind].file}. Отозвать можно в этом же списке.</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <code className="flex-1 font-mono text-xs break-all">{token?.token}</code>
          <Button size="icon" variant="ghost" onClick={() => token && navigator.clipboard.writeText(token.token)} aria-label="Копировать"><Copy className="size-3.5" /></Button>
        </div>
      </Modal>
    </>
  );
}

function Appearance() {
  const [mode, setMode] = useState<ThemeMode>(themeMode());
  const [accent, setAccent] = useState(accentName());
  const apply = (m: ThemeMode, a: string) => { setMode(m); setAccent(a); setAppearance(m, a); };
  const modes: { v: ThemeMode; label: string; icon: ReactNode }[] = [
    { v: "dark", label: "Тёмная", icon: <Moon className="size-3.5" /> },
    { v: "light", label: "Светлая", icon: <Sun className="size-3.5" /> },
    { v: "system", label: "Как в системе", icon: <SunMoon className="size-3.5" /> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 text-xs text-muted">Тема</span>
        {modes.map((m) => <Button key={m.v} size="sm" variant={mode === m.v ? "primary" : "secondary"} icon={m.icon} onClick={() => apply(m.v, accent)}>{m.label}</Button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 text-xs text-muted">Акцент</span>
        {Object.entries(ACCENTS).map(([k, v]) => (
          <button key={k} onClick={() => apply(mode, k)} title={v.label} aria-label={v.label} aria-pressed={accent === k}
            className={`size-7 rounded-full border-2 transition ${accent === k ? "border-text" : "border-transparent"}`}
            style={{ background: v.dark[0] }} />
        ))}
      </div>
      <p className="text-xs text-faint">
        Сохраняется в этом браузере. Компактный режим ассистента — <Link to="/mini" className="text-accent">/mini</Link> (удобно как отдельное маленькое окно).
        Прозрачность окна и «поверх всех окон» браузер не поддерживает — для этого нужна нативная оболочка (не реализовано).
      </p>
    </div>
  );
}

function LinkCard({ to, title, text }: { to: string; title: string; text: string }) {
  return (
    <Link to={to} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 transition hover:border-line-strong">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-muted">{text}</p>
      </div>
      <ExternalLink className="size-4 text-faint" />
    </Link>
  );
}

const SECTIONS = [
  { id: "general", label: "Общие" },
  { id: "voice", label: "Голос" },
  { id: "ai", label: "ИИ" },
  { id: "appearance", label: "Внешний вид" },
  { id: "devices", label: "Устройства" },
  { id: "keys", label: "Ключи" },
  { id: "security", label: "Безопасность" },
  { id: "more", label: "Команды и автоматизация" },
  { id: "about", label: "О системе" },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

export function SettingsPage() {
  const qc = useQueryClient();
  const me = useMe();
  const loc = useLocation();
  const nav = useNavigate();
  const hash = loc.hash.slice(1) as Section;
  const section: Section = SECTIONS.some((x) => x.id === hash) ? hash : "general";
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => get<{ secrets: Record<string, { configured: boolean; source: string }>; providers: Record<string, string> }>("/api/settings") });
  const sys = useQuery({ queryKey: ["system"], queryFn: () => get<SystemStatus>("/api/system/status") });
  const user = me.data?.user;
  const [profile, setProfile] = useState<{ display_name?: string; timezone?: string }>({});
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const saveProfile = useMutation({ mutationFn: (body: object) => patch("/api/settings/profile", body), onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }) });
  const changePw = useMutation({ mutationFn: () => post("/api/auth/password", pw), onSuccess: () => setPw({ current_password: "", new_password: "" }) });
  useEffect(() => { window.scrollTo({ top: 0 }); }, [section]);
  if (!user || settings.isLoading) return <div className="flex justify-center p-10"><Spinner /></div>;
  const channels = user.settings.notify_channels ?? ["web", "telegram", "whatsapp"];
  return (
    <>
      <PageHeader title="Настройки" description="Всё в одном месте: профиль, голос, ИИ, внешний вид, устройства, ключи и безопасность." />
      <nav className="-mx-1 mb-5 flex gap-1 overflow-x-auto pb-1" aria-label="Разделы настроек">
        {SECTIONS.map((x) => (
          <button key={x.id} onClick={() => nav({ hash: x.id }, { replace: true })}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${section === x.id ? "bg-elevated text-text shadow-sm" : "text-muted hover:text-text"}`}>
            {x.label}
          </button>
        ))}
      </nav>

      {section === "general" && (
        <div className="grid gap-6 xl:grid-cols-2">
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
          <Card title="Уведомления">
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
          </Card>
        </div>
      )}

      {section === "voice" && (
        <Card title="Голос и голосовой ассистент" subtitle="Голос, скорость, стиль, режим без рук. Действует во всех голосовых окнах.">
          <VoiceSettings />
        </Card>
      )}

      {section === "ai" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card title="Мозг" subtitle="Провайдер задаётся в .env (JARVIS_LLM_PROVIDER), модели — в config/models.yaml">
            <p className="mb-3 text-sm">
              Провайдер: <span className="font-mono">{sys.data?.brain.provider}</span>{" "}
              {sys.data?.brain.configured ? <Badge tone="ok" dot>ключ задан</Badge> : <Badge tone="warn" dot>нет ключа {sys.data?.brain.key_name}</Badge>}
            </p>
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
          <div className="space-y-3">
            <LinkCard to="/memory" title="Память" text="Что JARVIS помнит о вас: просмотр, правка, удаление." />
            <LinkCard to="/skills" title="Навыки" text="Включение и настройка навыков (Компьютер, Spotify, Почта…)." />
            <LinkCard to="/tools" title="Инструменты" text="Все инструменты, их риск и доступность." />
          </div>
        </div>
      )}

      {section === "appearance" && <Card title="Внешний вид"><Appearance /></Card>}

      {section === "devices" && (
        <Card title="Устройства и сессии" subtitle="Компьютеры с desktop-агентом, голосовые сателлиты, скрипты и браузерные сессии">
          <Sessions />
        </Card>
      )}

      {section === "keys" && (
        <Card title="Ключи API" subtitle="Хранятся зашифрованными (Fernet). Значения из .env имеют приоритет. Изменение требует повторного входа.">
          <ul className="divide-y divide-line">
            {Object.entries(settings.data?.secrets ?? {})
              .sort(([a], [b]) => Number(b === sys.data?.brain.key_name) - Number(a === sys.data?.brain.key_name))
              .map(([k, v]) => <SecretRow key={k} k={k} status={v} brainKey={sys.data?.brain.key_name} />)}
          </ul>
        </Card>
      )}

      {section === "security" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card title="Вход и 2FA">
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
          <div className="space-y-3">
            <LinkCard to="/permissions" title="Разрешения" text="Что JARVIS делает сам, а что — только с подтверждения. Уровни: авто / подтверждение / запрещено." />
            <LinkCard to="/logs" title="Журнал аудита" text="Все действия с цепочкой хешей: кто, что и когда." />
          </div>
        </div>
      )}

      {section === "more" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <LinkCard to="/commands" title="Свои команды" text="«Игровой режим», «Доброе утро»: фраза → цепочка действий без ИИ." />
          <LinkCard to="/automations" title="Автоматизации" text="Расписания и напоминания." />
          <LinkCard to="/integrations" title="Интеграции" text="Google, Spotify, Telegram, WhatsApp, компьютер." />
          <LinkCard to="/tasks" title="Фоновые задачи" text="Очередь задач и их результаты." />
        </div>
      )}

      {section === "about" && (
        <Card title="О системе">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt className="text-muted">Версия</dt><dd className="font-mono">{sys.data?.version}</dd>
            <dt className="text-muted">Схема БД</dt><dd className="font-mono">{sys.data?.schema ?? "—"}</dd>
            <dt className="text-muted">Окружение</dt><dd className="font-mono">{sys.data?.env}</dd>
            <dt className="text-muted">Публичный URL</dt><dd className="truncate font-mono">{sys.data?.public_url}</dd>
            <dt className="text-muted">Воркеры</dt><dd className="font-mono">{sys.data?.embedded_worker ? "встроенный" : sys.data?.workers.map((w) => `${w.id} (${w.running}/${w.concurrency})`).join(", ") || "нет"}</dd>
          </dl>
        </Card>
      )}
    </>
  );
}
