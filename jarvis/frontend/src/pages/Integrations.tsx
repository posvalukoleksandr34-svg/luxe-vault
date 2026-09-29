import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, Bot, Cloud, Globe, Copy, Link2, MessageCircle, Monitor, Music, Send, Terminal, Unlink } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router";

import { Badge, Button, Card, ErrorNote, PageHeader, Spinner } from "../components/ui";
import { del, get, post } from "../lib/api";
import { ago } from "../lib/format";
import type { DeviceInfo } from "../lib/types";

interface Link {
  id: string;
  channel: string;
  external_id: string;
  display: string;
  verified_at: string | null;
}

interface Overview {
  google: { configured: boolean; connected: boolean; status: string; account: string | null; scopes: string[]; redirect_uri: string };
  spotify: { configured: boolean; connected: boolean; status: string; account: string | null; premium: boolean; redirect_uri: string };
  computer: { devices: DeviceInfo[] };
  telegram: { configured: boolean; mode: string; links: Link[] };
  whatsapp: { configured: boolean; webhook_url: string; links: Link[] };
  voice: { stt: string; tts: string };
  browser: { available: boolean };
  sandbox: { available: boolean };
  search: { provider: string };
  mcp: Record<string, { ok: boolean; tools?: number; error?: string }>;
  not_implemented: string[];
}

function Row({ icon, title, status, children }: { icon: ReactNode; title: string; status: ReactNode; children?: ReactNode }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-elevated p-2 text-muted">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{title}</p>
            {status}
          </div>
          <div className="mt-2 space-y-3 text-sm text-muted">{children}</div>
        </div>
      </div>
    </Card>
  );
}

function Pairing({ channel, links }: { channel: "telegram" | "whatsapp"; links: Link[] }) {
  const qc = useQueryClient();
  const [code, setCode] = useState<{ code: string; instructions: string } | null>(null);
  const pair = useMutation({ mutationFn: () => post<{ code: string; instructions: string }>(`/api/integrations/${channel}/pair`), onSuccess: setCode });
  const unlink = useMutation({ mutationFn: (id: string) => del(`/api/integrations/links/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }) });
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ["integrations"] }), 3000);
    return () => clearInterval(t);
  }, [code, qc]);
  return (
    <div className="space-y-2">
      {links.map((l) => (
        <div key={l.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">
          <Link2 className="size-3.5 text-ok" />
          <span className="text-text">{l.display || l.external_id}</span>
          <span className="text-faint">· {ago(l.verified_at)}</span>
          <Button size="sm" variant="ghost" className="ml-auto" icon={<Unlink className="size-3.5" />} onClick={() => unlink.mutate(l.id)}>Отвязать</Button>
        </div>
      ))}
      {code ? (
        <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2.5">
          <p className="font-mono text-2xl tracking-[0.3em] text-text">{code.code}</p>
          <p className="mt-1 text-xs">{code.instructions} Код действует 10 минут.</p>
        </div>
      ) : (
        <Button size="sm" icon={<Link2 className="size-3.5" />} loading={pair.isPending} onClick={() => pair.mutate()}>
          {links.length ? "Привязать ещё аккаунт" : "Привязать аккаунт"}
        </Button>
      )}
      <ErrorNote error={pair.error} />
    </div>
  );
}

export function IntegrationsPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const { data, isLoading } = useQuery({ queryKey: ["integrations"], queryFn: () => get<Overview>("/api/integrations") });
  const connect = useMutation({ mutationFn: () => get<{ url: string }>("/api/integrations/google/connect"), onSuccess: (r) => (location.href = r.url) });
  const disconnect = useMutation({ mutationFn: () => del("/api/integrations/google"), onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }) });
  const spConnect = useMutation({ mutationFn: () => get<{ url: string }>("/api/integrations/spotify/connect"), onSuccess: (r) => (location.href = r.url) });
  const spDisconnect = useMutation({ mutationFn: () => del("/api/integrations/spotify"), onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }) });
  const webhook = useMutation({ mutationFn: () => post("/api/integrations/telegram/webhook") });
  if (isLoading || !data) return <div className="flex justify-center p-10"><Spinner /></div>;
  const g = data.google;
  const sp = data.spotify;
  return (
    <>
      <PageHeader title="Интеграции" description="Каналы связи и сервисы. Все каналы — это двери в один и тот же JARVIS: общая память, задачи и разрешения." />
      {params.get("google") === "connected" && <p className="mb-4 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">Google подключён.</p>}
      {params.get("google") === "error" && <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">Не удалось подключить Google — попробуйте ещё раз.</p>}
      {params.get("spotify") === "connected" && <p className="mb-4 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">Spotify подключён.</p>}
      {params.get("spotify") === "error" && <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">Не удалось подключить Spotify — попробуйте ещё раз.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Row icon={<Cloud className="size-4" />} title="Google — Gmail, Calendar, Drive"
          status={g.connected ? <Badge tone="ok" dot>подключён</Badge> : g.status === "error" ? <Badge tone="danger" dot>нужно переподключить</Badge> : <Badge dot>не подключён</Badge>}>
          {g.connected ? (
            <>
              <p>Аккаунт: <span className="text-text">{g.account}</span>. Календарь и почта работают через Google; токены хранятся зашифрованными.</p>
              <Button size="sm" variant="danger" loading={disconnect.isPending} onClick={() => confirm("Отключить Google и отозвать доступ?") && disconnect.mutate()}>Отключить</Button>
            </>
          ) : g.configured ? (
            <>
              <p>Без Google JARVIS использует встроенный календарь и локальные черновики писем.</p>
              <Button size="sm" variant="primary" loading={connect.isPending} onClick={() => connect.mutate()}>Подключить Google</Button>
            </>
          ) : (
            <p>
              Нужен OAuth-клиент Google (тип «Web application»): задайте <code className="font-mono text-text">GOOGLE_CLIENT_ID</code> и{" "}
              <code className="font-mono text-text">GOOGLE_CLIENT_SECRET</code>, redirect URI: <code className="font-mono text-xs break-all text-text">{g.redirect_uri}</code>. Инструкция: docs/INTEGRATIONS.md.
            </p>
          )}
          <ErrorNote error={connect.error} />
        </Row>

        <Row icon={<Monitor className="size-4" />} title="Компьютер (desktop-агент)"
          status={data.computer.devices.length ? <Badge tone="ok" dot>подключено: {data.computer.devices.length}</Badge> : <Badge dot>нет подключённых</Badge>}>
          {data.computer.devices.map((d) => (
            <div key={d.id} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">
              <span className="text-text">{d.name}</span> · {d.platform} · {d.capabilities.join(", ")}
            </div>
          ))}
          <p>
            Приложения, музыка, громкость, сайты, окна — на вашем ПК. Агент запускается на компьютере и подключается к JARVIS по токену
            с правом <code className="font-mono text-text">computer</code>: <RouterLink to="/settings#devices" className="text-accent">Настройки → Устройства</RouterLink>, инструкция: desktop/README.md.
          </p>
        </Row>

        <Row icon={<Music className="size-4" />} title="Spotify"
          status={sp.connected ? <Badge tone="ok" dot>подключён{sp.premium ? " · Premium" : ""}</Badge> : sp.status === "error" ? <Badge tone="danger" dot>нужно переподключить</Badge> : <Badge dot>не подключён</Badge>}>
          {sp.connected ? (
            <>
              <p>Аккаунт: <span className="text-text">{sp.account}</span>. {sp.premium ? "Управление воспроизведением доступно." : "Без Premium Spotify не разрешает управлять воспроизведением через API — JARVIS будет открывать поиск в приложении и использовать медиа-клавиши ПК."}</p>
              <Button size="sm" variant="danger" loading={spDisconnect.isPending} onClick={() => confirm("Отключить Spotify?") && spDisconnect.mutate()}>Отключить</Button>
            </>
          ) : sp.configured ? (
            <Button size="sm" variant="primary" loading={spConnect.isPending} onClick={() => spConnect.mutate()}>Подключить Spotify</Button>
          ) : (
            <p>
              Создайте приложение на developer.spotify.com и задайте <code className="font-mono text-text">SPOTIFY_CLIENT_ID</code> и{" "}
              <code className="font-mono text-text">SPOTIFY_CLIENT_SECRET</code>; redirect URI: <code className="font-mono text-xs break-all text-text">{sp.redirect_uri}</code>.
              Без Spotify музыка управляется медиа-клавишами через desktop-агент.
            </p>
          )}
          <ErrorNote error={spConnect.error} />
        </Row>

        <Row icon={<Send className="size-4" />} title="Telegram"
          status={data.telegram.configured ? <Badge tone="ok" dot>бот настроен · {data.telegram.mode}</Badge> : <Badge dot>нет токена</Badge>}>
          {data.telegram.configured ? (
            <>
              <p>Пишите боту текстом или голосом; подтверждения приходят кнопками. Привязка — одноразовым кодом.</p>
              <Pairing channel="telegram" links={data.telegram.links} />
              {data.telegram.mode === "webhook" && (
                <Button size="sm" variant="ghost" loading={webhook.isPending} onClick={() => webhook.mutate()}>Перерегистрировать webhook</Button>
              )}
              <ErrorNote error={webhook.error} />
            </>
          ) : (
            <p>Создайте бота у @BotFather и задайте <code className="font-mono text-text">TELEGRAM_BOT_TOKEN</code> (или в Настройках → Ключи).</p>
          )}
        </Row>

        <Row icon={<MessageCircle className="size-4" />} title="WhatsApp (Cloud API)"
          status={data.whatsapp.configured ? <Badge tone="ok" dot>настроен</Badge> : <Badge dot>не настроен</Badge>}>
          <p>
            Официальный WhatsApp Business Cloud API. Webhook:{" "}
            <button className="inline-flex items-center gap-1 font-mono text-xs text-text" onClick={() => navigator.clipboard.writeText(data.whatsapp.webhook_url)}>
              {data.whatsapp.webhook_url} <Copy className="size-3" />
            </button>
          </p>
          {data.whatsapp.configured ? <Pairing channel="whatsapp" links={data.whatsapp.links} /> : (
            <p>Нужны WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN — см. docs/INTEGRATIONS.md.</p>
          )}
        </Row>

        <Row icon={<AudioLines className="size-4" />} title="Голос" status={<Badge tone="accent">STT {data.voice.stt} · TTS {data.voice.tts}</Badge>}>
          <p>
            {data.voice.stt === "browser" ? "Распознавание речи — встроенное в браузер (Chrome). " : "Распознавание речи на сервере. "}
            {data.voice.tts === "browser" ? "Синтез — голосом браузера. " : "Синтез — потоковый, по предложениям. "}
            Для качества задайте DEEPGRAM_API_KEY и ELEVENLABS_API_KEY.
          </p>
        </Row>

        <Row icon={<Globe className="size-4" />} title="Браузер (Playwright)" status={data.browser.available ? <Badge tone="ok" dot>работает</Badge> : <Badge dot>выключен</Badge>}>
          <p>Изолированный Chromium в отдельном контейнере без доступа к базе и внутренней сети. Профиль compose: <code className="font-mono">browser</code>.</p>
        </Row>

        <Row icon={<Terminal className="size-4" />} title="Песочница для кода" status={data.sandbox.available ? <Badge tone="ok" dot>работает</Badge> : <Badge dot>выключена</Badge>}>
          <p>Команды выполняются в отдельном контейнере: без root, без доступа к данным JARVIS, с лимитами CPU/RAM. Профиль compose: <code className="font-mono">sandbox</code>.</p>
        </Row>

        <Row icon={<Bot className="size-4" />} title="MCP-серверы" status={<Badge>{Object.keys(data.mcp).length}</Badge>}>
          {Object.keys(data.mcp).length ? (
            <ul className="space-y-1">
              {Object.entries(data.mcp).map(([k, v]) => (
                <li key={k} className="flex items-center gap-2 text-xs"><Badge tone={v.ok ? "ok" : "danger"} dot>{k}</Badge>{v.ok ? `${v.tools} инструментов` : v.error}</li>
              ))}
            </ul>
          ) : (
            <p>Подключите любые MCP-серверы в <code className="font-mono">config/mcp.yaml</code> — их инструменты пройдут через те же разрешения и журнал.</p>
          )}
        </Row>

        <Row icon={<Cloud className="size-4" />} title="Ещё не реализовано" status={<Badge tone="warn">roadmap</Badge>}>
          <ul className="list-disc pl-5 text-xs">{data.not_implemented.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="text-xs">До нативной поддержки их можно подключить через MCP-серверы или навык «Внешние API».</p>
        </Row>
      </div>
    </>
  );
}
