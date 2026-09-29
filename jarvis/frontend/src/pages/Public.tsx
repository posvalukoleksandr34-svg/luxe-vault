import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { Orb } from "../components/Orb";
import { Badge, Button, ErrorNote, Field, Input, Spinner } from "../components/ui";
import { get, post } from "../lib/api";

export interface PublicPlan {
  id: string;
  title: string;
  description: string;
  price_month: number;
  currency: string;
  limits: Record<string, number>;
  features: string[];
  purchasable: boolean;
}

export interface PublicConfig {
  product_name: string;
  signup_mode: "closed" | "invite" | "open";
  support_email: string | null;
  legal_entity: string | null;
  public_url: string;
  maintenance: { enabled: boolean; message: string };
  version: { app: string; api: string; schema: string | null };
  plans: PublicPlan[];
}

export const usePublicConfig = () =>
  useQuery({ queryKey: ["public-config"], queryFn: () => get<PublicConfig>("/api/public/config"), staleTime: 60_000 });

export const LIMIT_LABELS: Record<string, string> = {
  messages_month: "сообщений в месяц",
  messages_per_minute: "сообщений в минуту",
  llm_usd_month: "бюджет модели, $/мес",
  custom_commands: "своих команд",
  automations: "автоматизаций",
  devices: "компьютеров одновременно",
};

export const FEATURE_LABELS: Record<string, string> = {
  computer: "Управление компьютером",
  spotify: "Spotify",
  google: "Gmail, Calendar, Drive",
  browser: "Серверный браузер",
  sandbox: "Песочница для кода",
  voice_premium: "Премиум-голос (серверные STT/TTS)",
  custom_commands: "Свои команды",
  automations: "Автоматизации и напоминания",
  api: "Личный API",
};

function Shell({ title, subtitle, children, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  const cfg = usePublicConfig();
  return (
    <div className="relative flex min-h-full flex-col items-center overflow-hidden px-4 py-10">
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <div className={`relative w-full ${wide ? "max-w-5xl" : "max-w-sm"}`}>
        <Link to="/login" className="mb-8 flex flex-col items-center text-center">
          <Orb state="idle" size={56} />
          <p className="mt-4 text-sm font-semibold tracking-[0.3em]">{cfg.data?.product_name ?? "JARVIS"}</p>
        </Link>
        <h1 className="text-center text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-center text-sm text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        <PublicFooter />
      </div>
    </div>
  );
}

export function PublicFooter() {
  const cfg = usePublicConfig();
  return (
    <p className="mt-8 flex flex-wrap justify-center gap-x-4 gap-y-1 text-center text-[11px] text-faint">
      <Link to="/pricing" className="hover:text-text">Тарифы</Link>
      <Link to="/legal/terms" className="hover:text-text">Условия</Link>
      <Link to="/legal/privacy" className="hover:text-text">Конфиденциальность</Link>
      {cfg.data?.support_email && <a href={`mailto:${cfg.data.support_email}`} className="hover:text-text">Поддержка</a>}
      {cfg.data && <span>v{cfg.data.version.app}</span>}
    </p>
  );
}

const card = "space-y-4 rounded-2xl border border-line bg-surface/90 p-6 shadow-2xl backdrop-blur";

export function SignupPage() {
  const cfg = usePublicConfig();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", name: "", invite: params.get("invite") ?? "", accept_terms: false });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"verify_email" | null>(null);
  if (cfg.isLoading) return <div className="flex justify-center p-10"><Spinner /></div>;
  const mode = cfg.data?.signup_mode ?? "closed";
  if (mode === "closed")
    return (
      <Shell title="Регистрация закрыта" subtitle="Это персональная установка. Аккаунт может выдать только её владелец.">
        <p className="text-center text-sm"><Link to="/login" className="text-accent">Войти</Link></p>
      </Shell>
    );
  if (done)
    return (
      <Shell title="Проверьте почту" subtitle="Мы отправили ссылку для подтверждения адреса. После подтверждения можно войти.">
        <p className="text-center text-sm"><Link to="/login" className="text-accent">Ко входу</Link></p>
      </Shell>
    );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ next: string }>("/api/auth/signup", {
        ...form, invite: form.invite || undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (r.next === "verify_email") setDone("verify_email");
      else if (r.next === "app") {
        await qc.invalidateQueries({ queryKey: ["me"] });
        navigate("/", { replace: true });
      } else navigate("/login", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: "email" | "password" | "name" | "invite") => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Shell title="Создать аккаунт" subtitle={mode === "invite" ? "Регистрация по приглашению" : undefined}>
      <form onSubmit={submit} className={card}>
        <Field label="Как к вам обращаться"><Input value={form.name} onChange={set("name")} autoFocus /></Field>
        <Field label="Email"><Input type="email" autoComplete="username" value={form.email} onChange={set("email")} required /></Field>
        <Field label="Пароль" hint="Минимум 10 символов"><Input type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={set("password")} required /></Field>
        {mode === "invite" && <Field label="Код приглашения"><Input value={form.invite} onChange={set("invite")} required className="font-mono text-xs" /></Field>}
        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" className="mt-0.5" checked={form.accept_terms} onChange={(e) => setForm({ ...form, accept_terms: e.target.checked })} />
          <span>Я принимаю <Link to="/legal/terms" className="text-accent">условия</Link> и <Link to="/legal/privacy" className="text-accent">политику конфиденциальности</Link>.</span>
        </label>
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!form.accept_terms}>Зарегистрироваться</Button>
        <p className="text-center text-xs text-muted">Уже есть аккаунт? <Link to="/login" className="text-accent">Войти</Link></p>
      </form>
    </Shell>
  );
}

export function VerifyPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    post("/api/auth/verify", { token }).then(() => setState("ok"), (e) => { setError(e); setState("error"); });
  }, [token]);
  return (
    <Shell title={state === "ok" ? "Адрес подтверждён" : state === "error" ? "Не получилось" : "Подтверждаю…"}>
      {state === "working" && <div className="flex justify-center"><Spinner /></div>}
      <ErrorNote error={error} />
      {state !== "working" && <p className="text-center text-sm"><Link to="/login" className="text-accent">Войти</Link></p>}
    </Shell>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="Восстановление пароля">
      {result ? (
        <div className={card}>
          <p className="text-sm">
            {result.ok
              ? "Если такой аккаунт есть, мы отправили на него ссылку для сброса пароля (действует 1 час)."
              : "На этом сервере не настроена отправка почты — восстановить пароль по e-mail нельзя. Обратитесь к владельцу установки."}
          </p>
          <Link to="/login" className="text-sm text-accent">Ко входу</Link>
        </div>
      ) : (
        <form className={card} onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try { setResult(await post<{ ok: boolean; reason?: string }>("/api/auth/password/forgot", { email })); } catch (err) { setError(err); } finally { setBusy(false); }
        }}>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={busy}>Отправить ссылку</Button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPage() {
  const [params] = useSearchParams();
  const [pw, setPw] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="Новый пароль">
      {done ? (
        <p className="text-center text-sm">Пароль изменён, все сессии завершены. <Link to="/login" className="text-accent">Войти</Link></p>
      ) : (
        <form className={card} onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try { await post("/api/auth/password/reset", { token: params.get("token") ?? "", new_password: pw }); setDone(true); } catch (err) { setError(err); } finally { setBusy(false); }
        }}>
          <Field label="Новый пароль" hint="Минимум 10 символов"><Input type="password" autoComplete="new-password" minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={busy}>Сохранить</Button>
        </form>
      )}
    </Shell>
  );
}

export function PlanCard({ plan, current, action }: { plan: PublicPlan; current?: boolean; action?: ReactNode }) {
  return (
    <div className={`flex flex-col rounded-2xl border p-5 ${current ? "border-accent/50 bg-accent-soft" : "border-line bg-surface"}`}>
      <div className="flex items-center gap-2">
        <p className="text-base font-semibold">{plan.title}</p>
        {current && <Badge tone="accent">ваш тариф</Badge>}
      </div>
      <p className="mt-1 text-xs text-muted">{plan.description}</p>
      <p className="mt-4 text-2xl font-semibold">
        {plan.price_month ? `${plan.price_month} ${plan.currency}` : "Бесплатно"}
        {plan.price_month ? <span className="text-xs font-normal text-muted"> / месяц</span> : null}
      </p>
      <ul className="mt-4 flex-1 space-y-1.5 text-xs">
        {Object.entries(plan.limits).filter(([k]) => k !== "messages_per_minute").map(([k, v]) => (
          <li key={k} className="flex gap-2"><Check className="size-3.5 shrink-0 text-ok" />{k === "llm_usd_month" ? `до $${v} на модель в месяц` : `${v} ${LIMIT_LABELS[k] ?? k}`}</li>
        ))}
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2"><Check className="size-3.5 shrink-0 text-ok" />{FEATURE_LABELS[f] ?? f}</li>
        ))}
      </ul>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PricingPage() {
  const cfg = usePublicConfig();
  if (!cfg.data) return <div className="flex justify-center p-10"><Spinner /></div>;
  return (
    <Shell wide title="Тарифы" subtitle="Лимиты и возможности каждого тарифа. Оплата — ежемесячно, отмена в любой момент в личном кабинете.">
      <div className="grid gap-4 md:grid-cols-3">
        {cfg.data.plans.map((p) => (
          <PlanCard key={p.id} plan={p} action={
            cfg.data.signup_mode !== "closed"
              ? <Link to="/signup"><Button variant={p.price_month ? "primary" : "secondary"} className="w-full">{p.price_month ? "Начать" : "Попробовать"}</Button></Link>
              : undefined
          } />
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-faint">
        Бюджет модели — фактическая стоимость запросов к ИИ по вашему аккаунту. Функции, которым нужны внешние сервисы
        (Spotify Premium, Google, ElevenLabs), работают только после их подключения.
      </p>
    </Shell>
  );
}

export function LegalPage() {
  const { doc } = useParams();
  const cfg = usePublicConfig();
  const name = cfg.data?.product_name ?? "JARVIS";
  const operator = cfg.data?.legal_entity ?? "оператор этой установки";
  const contact = cfg.data?.support_email;
  const privacy = doc === "privacy";
  return (
    <Shell wide title={privacy ? "Политика конфиденциальности" : "Условия использования"}>
      <article className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-line bg-surface p-6 text-sm leading-relaxed text-muted">
        <p className="rounded-lg border border-warn/30 bg-warn/[0.07] px-3 py-2 text-xs text-warn">
          Это шаблон, который поставляется с {name}. Перед публичным запуском {operator} должен проверить и дополнить его вместе с юристом
          для своей юрисдикции.
        </p>
        {privacy ? (
          <>
            <p><b className="text-text">Кто обрабатывает данные.</b> {operator}{contact ? ` (${contact})` : ""}.</p>
            <p><b className="text-text">Какие данные.</b> Адрес e-mail и имя; ваши сообщения, память ассистента, задачи, команды, файлы и
              подключённые интеграции; технические журналы (время, действие, IP при входе). Ключи и токены интеграций хранятся зашифрованными.</p>
            <p><b className="text-text">Зачем.</b> Чтобы ассистент работал: отвечал, помнил контекст, выполнял действия, о которых вы просите.
              Содержимое сообщений передаётся выбранному провайдеру ИИ-модели и подключённым вами сервисам только для выполнения запроса.</p>
            <p><b className="text-text">Аналитика.</b> Считаются только агрегированные счётчики использования (сколько сообщений, запусков команд и т. п.) —
              без содержимого и без сторонних трекеров.</p>
            <p><b className="text-text">Ваши права.</b> В «Настройки → Аккаунт» можно скачать все свои данные (JSON) и удалить аккаунт. После удаления
              данные аккаунта стираются; журнал безопасности хранит обезличенную запись (идентификатор) о событиях входа и удаления.
              Резервные копии перезаписываются по циклу хранения бэкапов.</p>
            <p><b className="text-text">Оплата.</b> Платёжные данные обрабатывает платёжный провайдер (Stripe); {name} их не хранит.</p>
          </>
        ) : (
          <>
            <p><b className="text-text">Сервис.</b> {name} — персональный ИИ-ассистент, предоставляемый {operator}.</p>
            <p><b className="text-text">Ответственность за действия.</b> Ассистент выполняет действия от вашего имени только в рамках выданных разрешений;
              рискованные действия требуют подтверждения. Проверяйте результаты: ИИ может ошибаться.</p>
            <p><b className="text-text">Тарифы и оплата.</b> Лимиты тарифа указаны на странице «Тарифы». Подписка продлевается ежемесячно, отменить её можно
              в любой момент; доступ сохраняется до конца оплаченного периода.</p>
            <p><b className="text-text">Запрещено.</b> Использовать сервис для незаконной деятельности, рассылки спама, обхода ограничений сервиса
              и доступа к чужим данным.</p>
            <p><b className="text-text">Прекращение.</b> Вы можете удалить аккаунт в настройках. Оператор может заблокировать аккаунт при нарушении условий.</p>
            {contact && <p><b className="text-text">Контакт:</b> {contact}</p>}
          </>
        )}
      </article>
    </Shell>
  );
}
