import { KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { post, setElevationHandler } from "../lib/api";
import { useMe } from "../lib/auth";
import { Button, ErrorNote, Field, Input, Modal } from "./ui";

/** Global re-authentication prompt: any API call answered with 428 opens it and retries on success. */
export function ElevateProvider() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const totp = me.data?.user.totp_enabled;

  useEffect(() => {
    setElevationHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setSecret("");
          setError(null);
          setOpen(true);
        }),
    );
    return () => setElevationHandler(null);
  }, []);

  const close = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/elevate", totp ? { totp: secret } : { password: secret });
      close(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => close(false)}
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-4 text-warn" /> Подтвердите личность
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Отмена
          </Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={!secret}>
            Подтвердить
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-3"
      >
        <p className="text-sm text-muted">
          Это действие затрагивает безопасность (ключи, права, действия с высоким риском). На 10 минут JARVIS запомнит, что это вы.
        </p>
        <Field label={totp ? "Код из приложения-аутентификатора" : "Пароль"}>
          <Input
            autoFocus
            type={totp ? "text" : "password"}
            inputMode={totp ? "numeric" : undefined}
            autoComplete={totp ? "one-time-code" : "current-password"}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
