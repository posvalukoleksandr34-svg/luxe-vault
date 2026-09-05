'use client'

import { CheckCircle2, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const MIN_PASSWORD_LENGTH = 8

export default function UpdatePasswordPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Reaching this page means /auth/callback already exchanged the emailed code
  // for a session. Verify that session actually exists — otherwise someone who
  // simply typed the URL would get a password form that cannot work.
  useEffect(() => {
    let active = true
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!active) return
        setAuthorized(Boolean(data.user))
        setChecking(false)
      })
      .catch(() => {
        if (!active) return
        setChecking(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`)
      return
    }
    // Checked here rather than only on the server: a typo'd new password would
    // otherwise lock the customer out of the account they are trying to recover.
    if (password !== confirm) {
      setError('Пароли не совпадают')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const { error } = await createClient().auth.updateUser({ password })
      if (error) throw error
      setDone(true)
      // Give them a moment to read the confirmation before leaving.
      setTimeout(() => router.push('/'), 2500)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-gold" />
      </main>
    )
  }

  if (!authorized) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-serif text-2xl font-bold text-foreground">
          Ссылка недействительна
        </h1>
        <p className="max-w-sm text-sm font-light leading-relaxed text-muted-foreground">
          Срок действия ссылки истёк или она уже была использована.
          Запросите новую ссылку для смены пароля.
        </p>
        <Link
          href="/auth/forgot-password"
          className="mt-2 border border-gold/30 bg-gold/5 px-6 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
        >
          Запросить ссылку
        </Link>
      </main>
    )
  }

  if (done) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-400" strokeWidth={1.25} />
        <h1 className="font-serif text-2xl font-bold text-foreground">Пароль обновлён</h1>
        <p className="text-sm font-light text-muted-foreground">
          Сейчас вы вернётесь в магазин.
        </p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">
          Новый пароль
        </h1>
        <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">
          Придумайте новый пароль — не короче {MIN_PASSWORD_LENGTH} символов.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
              Новый пароль
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-foreground"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
              Повторите пароль
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-foreground"
            />
          </div>

          {error && <p className="text-[12px] text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={busy || !password || !confirm}
            className="flex w-full items-center justify-center gap-2 border border-gold/30 bg-gold/5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Сохранить пароль
          </button>
        </form>
      </div>
    </main>
  )
}
