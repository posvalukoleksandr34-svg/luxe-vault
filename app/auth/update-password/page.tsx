'use client'

import { CheckCircle2, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PasswordInput } from '@/components/password-input'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store'

const MIN_PASSWORD_LENGTH = 8

export default function UpdatePasswordPage() {
  const { t, tf } = useStore()
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
      setError(tf('pw.tooShort', { n: MIN_PASSWORD_LENGTH }))
      return
    }
    // Checked here rather than only on the server: a typo'd new password would
    // otherwise lock the customer out of the account they are trying to recover.
    if (password !== confirm) {
      setError(t('account.passwordMismatch'))
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
          {t('pw.linkInvalid')}
        </h1>
        <p className="max-w-sm text-sm font-light leading-relaxed text-muted-foreground">
          {t('pw.linkExpiredHint')}
          
        </p>
        <Link
          href="/auth/forgot-password"
          className="mt-2 border border-gold/30 bg-gold/5 px-6 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
        >
          {t('pw.requestLink')}
        </Link>
      </main>
    )
  }

  if (done) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-400" strokeWidth={1.25} />
        <h1 className="font-serif text-2xl font-bold text-foreground">{t('account.passwordChanged')}</h1>
        <p className="text-sm font-light text-muted-foreground">
          {t('pw.returningToShop')}
        </p>
      </main>
    )
  }

  const mismatch = confirm.length > 0 && confirm !== password
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">
          {t('pw.newPassword')}
        </h1>
        <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">
          {tf('pw.newPasswordHint', { n: MIN_PASSWORD_LENGTH })}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <PasswordInput
            label={t('pw.newPassword')}
            value={password}
            onChange={setPassword}
            required
            autoFocus
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            error={tooShort}
          />

          <PasswordInput
            label={t('pw.repeat')}
            value={confirm}
            onChange={setConfirm}
            required
            autoComplete="new-password"
            // Turns red as soon as the two diverge, rather than waiting for a
            // submit to tell them something they can already see.
            error={mismatch}
          />

          {tooShort && !error && (
            <p className="text-[12px] text-destructive">
              {tf('pw.minChars', { n: MIN_PASSWORD_LENGTH })}
            </p>
          )}
          {mismatch && !tooShort && !error && (
            <p className="text-[12px] text-destructive">{t('account.passwordMismatch')}</p>
          )}
          {error && <p className="text-[12px] text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={busy || !password || !confirm || mismatch || tooShort}
            className="flex w-full items-center justify-center gap-2 border border-gold/30 bg-gold/5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('pw.save')}
          </button>
        </form>
      </div>
    </main>
  )
}
