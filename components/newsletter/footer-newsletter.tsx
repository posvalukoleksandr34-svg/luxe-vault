'use client'

import { Check, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { isValidEmail } from '@/lib/validation'

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done'; already: boolean } | { kind: 'error'; message: string }

/**
 * The footer's newsletter sign-up: on every page with a footer.
 *
 * Posts to /api/newsletter — the same route, rate limit and duplicate handling
 * as the /contact block. An address already on the list is told so rather than
 * being shown an error, and the consent wording sits under the button it
 * applies to (the request sends `consent: true` only from here).
 */
export function FooterNewsletter() {
  const { t, locale, currentUser } = useStore()
  const [email, setEmail] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => {
    if (currentUser?.email) setEmail((v) => v || currentUser.email)
  }, [currentUser])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (state.kind === 'sending') return
    const value = email.trim()
    if (!isValidEmail(value)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setState({ kind: 'sending' })
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, locale, consent: true, source: 'footer' }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok) return setState({ kind: 'done', already: Boolean(data?.already) })
      if (data?.error === 'INVALID_EMAIL') {
        setInvalid(true)
        return setState({ kind: 'idle' })
      }
      setState({ kind: 'error', message: res.status === 503 ? t('footer.newsUnavailable') : t('footer.newsError') })
    } catch {
      setState({ kind: 'error', message: t('footer.newsError') })
    }
  }

  const sending = state.kind === 'sending'

  return (
    <section
      aria-labelledby="footer-newsletter-title"
      className="mb-14 grid gap-6 border-b border-border/40 pb-12 md:grid-cols-2 md:items-end md:gap-12"
    >
      <div>
        <h2 id="footer-newsletter-title" className="font-serif text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
          {t('footer.newsTitle')}
        </h2>
        <p className="mt-2 max-w-sm text-[13px] font-light leading-relaxed text-muted-foreground/80">{t('footer.newsBody')}</p>
      </div>

      <form onSubmit={submit} noValidate>
        {state.kind === 'done' ? (
          <p role="status" className="flex min-h-[46px] items-center gap-3 border border-border/60 px-4 text-[13px] font-light text-foreground">
            <Check className="size-4 shrink-0 text-gold" strokeWidth={1.75} aria-hidden />
            {state.already ? t('footer.newsAlready') : t('footer.newsDone')}
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-0">
            <label htmlFor="footer-newsletter-email" className="sr-only">
              {t('footer.newsPlaceholder')}
            </label>
            <input
              id="footer-newsletter-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (invalid) setInvalid(false)
                if (state.kind === 'error') setState({ kind: 'idle' })
              }}
              placeholder={t('footer.newsPlaceholder')}
              aria-invalid={invalid}
              aria-describedby={invalid ? 'footer-newsletter-error' : undefined}
              className={cn(
                'min-h-[46px] w-full min-w-0 border bg-transparent px-4 text-base font-light text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-foreground/40 sm:border-r-0 sm:text-[13px]',
                invalid ? 'border-destructive/70' : 'border-border/60',
              )}
            />
            <button
              type="submit"
              disabled={sending}
              className="inline-flex min-h-[46px] shrink-0 items-center justify-center gap-2 border border-gold bg-gold px-6 text-[11px] font-medium uppercase tracking-[0.2em] text-gold-foreground transition-colors hover:bg-gold/90 disabled:opacity-60"
            >
              {sending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t('footer.newsCta')}
            </button>
          </div>
        )}

        {invalid && (
          <p id="footer-newsletter-error" className="mt-2 text-[12px] text-destructive">
            {t('footer.newsInvalid')}
          </p>
        )}
        {state.kind === 'error' && (
          <p role="alert" className="mt-2 text-[12px] text-destructive">
            {state.message}
          </p>
        )}

        <p className="mt-3 text-[11px] font-light leading-relaxed text-muted-foreground/60">
          {t('footer.newsConsent')}{' '}
          <Link href="/legal/privacy" className="underline underline-offset-2 transition hover:text-foreground">
            {t('footer.newsPrivacy')}
          </Link>
          . {t('footer.newsOptOut')}
        </p>
      </form>
    </section>
  )
}
