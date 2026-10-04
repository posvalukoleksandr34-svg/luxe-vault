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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={handleSubmit}
        className="animate-fade-in w-full max-w-sm border border-border/60 p-10"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex size-12 items-center justify-center border border-gold/40 text-gold">
            <Lock className="size-5" />
          </div>
          <div className="flex items-baseline gap-0.5">
            <span className="font-serif text-lg font-semibold tracking-[0.2em] text-foreground">
              LUXE
            </span>
            <span className="font-serif text-lg font-semibold tracking-[0.2em] text-gold">
              VAULT
            </span>
          </div>
          <p className="mt-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground/85">
            Private Access
          </p>
        </div>

        <PasswordInput
          label="Пароль"
          value={password}
          onChange={setPassword}
          required
          autoFocus
          autoComplete="current-password"
          labelClassName="mb-2 text-[11px] tracking-[0.15em] normal-case"
          inputClassName="rounded-none border-border px-3 py-3 text-[13px] font-light focus:border-gold/40"
        />

        {mfa && (
          <label className="mt-5 block">
            <span className="mb-2 block text-[11px] tracking-[0.15em] text-foreground">Код из приложения</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              placeholder="000000"
              className="w-full rounded-none border border-border bg-transparent px-3 py-3 text-center text-[18px] tracking-[0.5em] tabular-nums text-foreground outline-none focus:border-gold/40"
            />
          </label>
        )}

        {error && (
          <p className="mt-3 text-[12px] text-destructive">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !password || (mfa && code.length !== 6)}
          className="mt-6 w-full border border-gold/30 bg-gold/5 py-3.5 text-[12px] uppercase tracking-[0.2em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/85"
        >
          {loading ? '...' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
