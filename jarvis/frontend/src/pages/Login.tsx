import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { Orb } from "../components/Orb";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { ApiError, get, post } from "../lib/api";
import { useMe } from "../lib/auth";

export function LoginPage() {
  const me = useMe();
  const setup = useQuery({ queryKey: ["setup"], queryFn: () => get<{ needs_setup: boolean }>("/api/auth/setup") });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({
    email: "",
    password: "",
    totp: "",
    name: "",
    setup_code: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (me.data) return <Navigate to={(loc.state as { from?: string })?.from ?? "/"} replace />;
  const isSetup = setup.data?.needs_setup;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isSetup) {
        await post("/api/auth/setup", {
          setup_code: form.setup_code,
          email: form.email,
          password: form.password,
          name: form.name || "Owner",
          timezone: form.timezone,
        });
      } else {
        await post("/api/auth/login", { email: form.email, password: form.password, totp: form.totp || undefined });
      }
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.message === "totp_required") setNeedTotp(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Orb state="idle" size={72} />
          <h1 className="mt-5 text-lg font-semibold tracking-[0.3em]">JARVIS</h1>
          <p className="mt-1 text-sm text-muted">{isSetup ? "Первый запуск — создайте аккаунт владельца" : "Персональный AI-оператор"}</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface/90 p-6 shadow-2xl backdrop-blur">
          {isSetup && (
            <>
              <Field label="Код установки" hint={<>Показан в логах: <code className="font-mono">docker compose logs api | grep SETUP</code></>}>
                <Input value={form.setup_code} onChange={set("setup_code")} autoFocus required className="font-mono uppercase tracking-widest" />
              </Field>
              <Field label="Как к вам обращаться">
                <Input value={form.name} onChange={set("name")} placeholder="Имя" />
              </Field>
            </>
          )}
          <Field label="Email">
            <Input type="email" autoComplete="username" value={form.email} onChange={set("email")} required autoFocus={!isSetup} />
          </Field>
          <Field label="Пароль" hint={isSetup ? "Минимум 10 символов" : undefined}>
            <Input type="password" autoComplete={isSetup ? "new-password" : "current-password"} value={form.password} onChange={set("password")} required minLength={isSetup ? 10 : 1} />
          </Field>
          {needTotp && (
            <Field label="Код 2FA">
              <Input inputMode="numeric" autoComplete="one-time-code" value={form.totp} onChange={set("totp")} autoFocus />
            </Field>
          )}
          {isSetup && (
            <Field label="Часовой пояс" hint="Определён автоматически; используется для напоминаний и календаря">
              <Input value={form.timezone} onChange={set("timezone")} />
            </Field>
          )}
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            {isSetup ? "Создать и войти" : "Войти"}
          </Button>
        </form>
      </div>
    </div>
  );
}
