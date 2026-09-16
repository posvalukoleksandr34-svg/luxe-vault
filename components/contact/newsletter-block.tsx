'use client'

import { Check, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ERROR_TEXT, FIELD, LABEL, PRIMARY_BUTTON } from '@/components/contact/fields'
import type { ContactCopy } from '@/lib/contact-copy'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { isValidEmail } from '@/lib/validation'

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; already: boolean }
  | { kind: 'error'; message: string }

/**
 * "Ничего не пропустите": the headline and a line of copy on the left, the
 * sign-up on the right. The consent wording sits directly under the button it
 * applies to, and the request says so (`consent: true`) — the server refuses
 * a sign-up without it.
 */
export function NewsletterBlock({ c }: { c: ContactCopy }) {
  const { locale, currentUser } = useStore()
  const [email, setEmail] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [state, setState] = useState<State>({ kind: 'idle' })

  // A signed-in customer's own address, as a starting point they can change.
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
        body: JSON.stringify({ email: value, locale, consent: true, source: 'contact' }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok) return setState({ kind: 'done', already: Boolean(data?.already) })
      if (data?.error === 'INVALID_EMAIL') {
        setInvalid(true)
        return setState({ kind: 'idle' })
      }
      setState({ kind: 'error', message: res.status === 503 ? c.newsUnavailable : c.newsError })
    } catch {
      setState({ kind: 'error', message: c.newsError })
    }
  }

  const sending = state.kind === 'sending'

  return (
    <section aria-labelledby="newsletter-title" className="border-t border-white/10 py-12 lg:py-16">
      <div className="grid gap-8 md:grid-cols-2 md:gap-16">
        <div>
          <h2
            id="newsletter-title"
            className="text-balance font-serif text-[32px] font-normal leading-[1.1] tracking-tight text-foreground sm:text-[40px]"
          >
            {c.newsTitle}
          </h2>
          <p className="mt-3 max-w-sm text-[14px] font-light leading-relaxed text-foreground/70">{c.newsBody}</p>
        </div>

        <form onSubmit={submit} noValidate className="md:pt-2">
          <label htmlFor="newsletter-email" className={LABEL}>
            {c.newsLabel}
          </label>

          {state.kind === 'done' ? (
            <p role="status" className="flex min-h-[48px] items-center gap-3 border border-white/10 px-4 text-[14px] font-light text-foreground">
              <Check className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              {state.already ? c.newsAlready : c.newsDone}
            </p>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-0">
              <input
                id="newsletter-email"
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
                placeholder={c.newsPlaceholder}
                aria-invalid={invalid}
                aria-describedby={invalid ? 'newsletter-error' : undefined}
                className={cn(FIELD, 'min-h-[48px] sm:border-r-0')}
              />
              <button type="submit" disabled={sending} className={cn(PRIMARY_BUTTON, 'shrink-0')}>
                {sending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {sending ? c.newsSending : c.newsCta}
              </button>
            </div>
          )}

          {invalid && (
            <p id="newsletter-error" className={ERROR_TEXT}>
              {c.newsInvalid}
            </p>
          )}
          {state.kind === 'error' && (
            <p role="alert" className={ERROR_TEXT}>
              {state.message}
            </p>
          )}

          <p className="mt-4 max-w-md text-[11px] font-light leading-relaxed text-foreground/50">
            {c.newsConsentBefore}
            <Link href="/legal/privacy" className="text-foreground/70 underline underline-offset-2 hover:text-foreground">
              {c.newsConsentLink}
            </Link>
            {c.newsConsentAfter}
          </p>
        </form>
      </div>
    </section>
  )
}
