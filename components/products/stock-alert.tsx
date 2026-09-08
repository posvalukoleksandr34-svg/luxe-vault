'use client'

import { BellRing, Check, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'

/**
 * "Tell me when this is back."
 *
 * Rendered in place of the add-to-cart button when the chosen size and colour
 * are sold out — the exact moment the customer is disappointed, which is the
 * only moment this is worth offering. A permanent "notify me" link elsewhere
 * on the page would be noise.
 *
 * A signed-in customer never sees the email field: their address comes from
 * the session, and the server ignores anything the body claims for them.
 */
export function StockAlert({
  productId,
  size,
  color,
}: {
  productId: string
  size: string
  color: string
}) {
  const { t, currentUser } = useStore()

  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Changing size or colour is a different variant, so a previous
  // confirmation must not carry over and imply this one is subscribed too.
  useEffect(() => {
    setDone(false)
    setError(null)
  }, [size, color])

  async function subscribe() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/stock-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, size, color, email }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(
          data.error === 'INVALID_EMAIL'
            ? t('stockAlert.badEmail')
            : data.error === 'IN_STOCK'
              ? t('stockAlert.available')
              : t('stockAlert.failed'),
        )
        return
      }
      setDone(true)
    } catch {
      setError(t('stockAlert.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <p className="mt-4 flex items-center gap-2 border border-gold/40 bg-gold/5 px-4 py-3.5 text-[12px] font-light text-gold">
        <Check className="size-4 shrink-0" />
        {t('stockAlert.confirmed')}
      </p>
    )
  }

  return (
    <div className="mt-4 border border-border/60 p-4">
      <p className="flex items-center gap-2 text-[12px] uppercase tracking-[0.12em] text-foreground">
        <BellRing className="size-3.5 text-gold" />
        {t('stockAlert.title')}
      </p>
      <p className="mt-1.5 text-[12px] font-light leading-relaxed text-muted-foreground">
        {t('stockAlert.body')}
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {!currentUser && (
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('checkout.email')}
            aria-label={t('checkout.email')}
            autoComplete="email"
            className="flex-1 border border-border bg-background px-3 py-2.5 text-[13px] text-foreground outline-none transition focus:border-gold"
          />
        )}
        <button
          type="button"
          onClick={subscribe}
          disabled={submitting}
          className="flex items-center justify-center gap-2 border border-gold/40 bg-gold/5 px-5 py-2.5 text-[11px] uppercase tracking-[0.12em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:opacity-50"
        >
          {submitting && <Loader2 className="size-3.5 animate-spin" />}
          {t('stockAlert.notify')}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
