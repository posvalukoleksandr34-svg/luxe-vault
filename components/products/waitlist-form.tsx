'use client'

import { BellRing, Check, Loader2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { joinWaitlist, type JoinWaitlistResult } from '@/actions/waitlist'
import type { UIKey } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

type Failure = Extract<JoinWaitlistResult, { ok: false }>['error']

/** What to tell the customer for each way a sign-up can fail. */
export function waitlistErrorMessage(error: Failure, t: (key: UIKey) => string): string {
  switch (error) {
    case 'INVALID_EMAIL':
      return t('stockAlert.badEmail')
    case 'IN_STOCK':
      return t('stockAlert.available')
    case 'RATE_LIMITED':
      return t('stockAlert.rateLimited')
    default:
      return t('stockAlert.failed')
  }
}

/**
 * The waitlist, inline, in place of the add-to-cart button when the chosen
 * size + colour is sold out: an email field and "Notify me", posting to the
 * joinWaitlist Server Action (actions/waitlist.ts → public.waitlist, the
 * table the restock sweep emails from).
 *
 * A signed-in customer's address is filled in and read-only — the action
 * uses the account's address regardless, and showing it says where the email
 * will go.
 */
export function WaitlistForm({
  productId,
  variantId,
  size,
  color,
  className,
}: {
  productId: string
  variantId?: string
  size: string
  color: string
  className?: string
}) {
  const { t, tf, currentUser, pushToast } = useStore()
  const inputId = useId()
  const [email, setEmail] = useState(currentUser?.email ?? '')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState<null | 'new' | 'already'>(null)
  const [error, setError] = useState<string | null>(null)
  const signedIn = Boolean(currentUser)

  // A different size or colour is a different sign-up: a confirmation for the
  // previous one must not carry over and imply this one is set.
  useEffect(() => {
    setDone(null)
    setError(null)
  }, [productId, size, color])

  useEffect(() => {
    if (currentUser?.email) setEmail(currentUser.email)
  }, [currentUser?.email])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    let result: JoinWaitlistResult
    try {
      result = await joinWaitlist({ productId, variantId, size, color, email })
    } catch {
      // Network failure, or the action threw on the server.
      result = { ok: false, error: 'FAILED' }
    } finally {
      setPending(false)
    }
    if (result.ok) {
      setDone(result.already ? 'already' : 'new')
      pushToast({ title: t(result.already ? 'stockAlert.already' : 'stockAlert.confirmed'), variant: 'gold' })
      return
    }
    const message = waitlistErrorMessage(result.error, t)
    setError(message)
    pushToast({ title: message, variant: 'default' })
  }

  return (
    <div className={cn('border border-border/70 p-4 sm:p-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('sold.out')} · {tf('stockAlert.forSize', { size, color })}
        </p>
        <BellRing className="size-3.5 shrink-0 text-gold/70" aria-hidden />
      </div>
      <p className="mt-2 text-[12px] font-light leading-relaxed text-muted-foreground">{t('stockAlert.body')}</p>

      {done ? (
        <p
          role="status"
          className="mt-4 flex items-center gap-2 border border-gold/40 bg-gold/5 px-4 py-3 text-[13px] font-light text-gold"
        >
          <Check className="size-4 shrink-0" />
          {t(done === 'already' ? 'stockAlert.already' : 'stockAlert.confirmed')}
        </p>
      ) : (
        <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label htmlFor={inputId} className="sr-only">
            {t('checkout.email')}
          </label>
          <input
            id={inputId}
            type="email"
            required
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={signedIn}
            placeholder={t('checkout.email')}
            aria-invalid={Boolean(error)}
            className={cn(
              'min-w-0 flex-1 border border-border bg-background px-3.5 py-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/50 focus:border-gold',
              signedIn && 'text-muted-foreground',
              error && 'border-destructive/60',
            )}
          />
          <button
            type="submit"
            disabled={pending || !email.trim()}
            className="flex shrink-0 items-center justify-center gap-2 border border-gold/40 bg-gold/5 px-6 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />}
            {t('stockAlert.notify')}
          </button>
        </form>
      )}

      {signedIn && !done && (
        <p className="mt-1.5 text-[11px] font-light text-muted-foreground/70">{t('stockAlert.accountEmail')}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
