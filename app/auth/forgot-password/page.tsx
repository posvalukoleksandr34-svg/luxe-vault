'use client'

import { ArrowLeft, Loader2, MailCheck } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_link: 'Ссылка устарела или уже была использована. Запросите новую.',
  missing_code: 'Ссылка неполная. Запросите новое письмо.',
}

function ForgotPasswordForm() {
  const searchParams = useSearchParams()
  const linkError = ERROR_MESSAGES[searchParams.get('error') ?? '']

  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        {
          // Supabase appends the one-time code; /auth/callback trades it for a
          // session and then forwards to the update-password screen.
          redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
        },
      )
      if (error) throw error
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
      return
    }

    // Shown regardless of whether the address exists. Confirming which emails
    // are registered would turn this form into an account-enumeration oracle.
    setSent(true)
    setBusy(false)
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <MailCheck className="h-8 w-8 text-gold" strokeWidth={1.25} />
        <h1 className="font-serif text-2xl font-bold text-foreground">
          Проверьте почту
        </h1>
        <p className="max-w-sm text-sm font-light leading-relaxed text-muted-foreground">
          Если аккаунт с адресом <span className="text-foreground">{email}</span> существует,
          мы отправили на него ссылку для сброса пароля. Она действует один час.
        </p>
        <Link
          href="/"
          className="mt-2 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          На главную
        </Link>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">
        Восстановление пароля
      </h1>
      <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">
        Введите email, указанный при регистрации. Мы пришлём ссылку для смены пароля.
      </p>

      {linkError && (
        <p className="mt-4 border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-[12px] text-destructive">
          {linkError}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-foreground"
          />
        </div>

        {error && <p className="text-[12px] text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="flex w-full items-center justify-center gap-2 border border-gold/30 bg-gold/5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Отправить ссылку
        </button>
      </form>

      <Link
        href="/"
        className="mt-6 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Вернуться в магазин
      </Link>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      {/* useSearchParams needs a Suspense boundary or the whole route opts out
          of static rendering with a build-time warning. */}
      <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin text-gold" />}>
        <ForgotPasswordForm />
      </Suspense>
    </main>
  )
}
