'use client'

import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { PasswordInput } from '@/components/password-input'

export default function AdminLoginPage() {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  /** Whether the console asks for the authenticator code (ADMIN_TOTP_SECRET). */
  const [mfa, setMfa] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/admin/login', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { mfa: false }))
      .then((d: { mfa?: boolean }) => setMfa(Boolean(d.mfa)))
      .catch(() => setMfa(false))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mfa ? { password, code } : { password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Неверный пароль')
        setLoading(false)
        return
      }
      // Full navigation so the fresh session cookie is present for the
      // middleware check on the very next request.
      window.location.href = '/admin'
    } catch {
      setError('Не удалось выполнить вход')
      setLoading(false)
    }
  }

  return (
    // data-admin-shell: the console's neutral palette (app/globals.css), so
    // the way in looks like the console it opens rather than the shop.
    <div data-admin-shell className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <form
        onSubmit={handleSubmit}
        className="animate-fade-in w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm"
      >
        <div className="mb-7">
          <div className="mb-5 flex size-10 items-center justify-center rounded-lg bg-foreground text-background">
            <Lock className="size-4" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Luxe Vault <span className="font-normal text-muted-foreground">· админ</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Вход в админ-панель магазина.</p>
        </div>

        <PasswordInput
          label="Пароль"
          value={password}
          onChange={setPassword}
          required
          autoFocus
          autoComplete="current-password"
          showLabel="Показать пароль"
          hideLabel="Скрыть пароль"
          labelClassName="mb-1.5 text-xs font-medium normal-case tracking-normal text-muted-foreground"
          inputClassName="rounded-lg border-border bg-background px-3 py-2.5 text-sm focus:border-foreground"
        />

        {mfa && (
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Код из приложения</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              placeholder="000000"
              data-field="lg"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-center text-[18px] tracking-[0.5em] tabular-nums text-foreground outline-none focus:border-foreground"
            />
          </label>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !password || (mfa && code.length !== 6)}
          className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-foreground text-sm font-medium text-background transition hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
