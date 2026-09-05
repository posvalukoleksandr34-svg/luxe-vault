'use client'

import { ArrowLeft, Loader2, MailCheck } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { useStore } from '@/lib/store'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function ForgotPasswordForm() {
  const searchParams = useSearchParams()
  const { t, requestRecoveryCode } = useStore()

  // Set by /auth/callback when an emailed link is stale or already spent.
  const linkErrorCode = searchParams.get('error')
  const linkError =
    linkErrorCode === 'invalid_link' || linkErrorCode === 'missing_code'
      ? t('otp.err.codeInvalid')
      : null

  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return

    if (!EMAIL_RE.test(email.trim())) {
      setError(t('otp.err.email'))
      return
    }

    setBusy(true)
    setError(null)

    // Routed through the store rather than calling Supabase here directly.
    // This page previously had its own resetPasswordForEmail with its own
    // redirect built from window.location.origin — a second implementation
    // that could drift from the one the modal uses (and did: it ignored
    // NEXT_PUBLIC_SITE_URL). One call site, one behaviour.
    const { ok, message } = await requestRecoveryCode(email)
    setBusy(false)

    if (!ok) {
      // Supabase error text is English-only, so it is mapped rather than shown.
      setError(
        message && /sending|unexpected_failure|smtp/i.test(message)
          ? t('otp.err.sendFailed')
          : message && /rate limit|too many|429/i.test(message)
            ? t('otp.err.rateLimit')
            : t('otp.err.generic'),
      )
      return
    }

    // Shown regardless of whether the address exists. Confirming which emails
    // are registered would turn this form into an account-enumeration oracle.
    setSent(true)
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <MailCheck className="h-8 w-8 text-gold" strokeWidth={1.25} />
        <h1 className="font-serif text-2xl font-bold text-foreground">
          {t('otp.step2.title')}
        </h1>
        <p className="max-w-sm text-sm font-light leading-relaxed text-muted-foreground">
          {t('otp.step2.body').replace('{email}', email)}
        </p>
        <Link
          href="/"
          className="mt-2 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('otp.back')}
        </Link>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">
        {t('otp.step1.title')}
      </h1>
      <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">
        {t('otp.step1.body')}
      </p>

      {linkError && (
        <p className="mt-4 border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-[12px] text-destructive">
          {linkError}
        </p>
      )}

      {/* noValidate: the browser renders its native validation bubble in the
          BROWSER's language, which would break the strict-localization rule. */}
      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="recovery-email"
            className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground"
          >
            {t('otp.step1.emailLabel')}
          </label>
          <input
            id="recovery-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold"
          />
        </div>

        {error && <p className="text-[12px] text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="flex w-full items-center justify-center gap-2 border border-gold/30 bg-gold/5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('otp.step1.submit')}
        </button>
      </form>

      <Link
        href="/"
        className="mt-6 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('otp.back')}
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
