'use client'

import { BellRing, Check, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * "Notify when available" — the back-in-stock sign-up, as a dialog.
 *
 * It writes through /api/stock-alerts into public.stock_alerts: the same
 * table the scheduled sweep (app/api/cron/sweep) reads and emails from. That
 * is the whole reason there is no second subscriptions table — a sign-up the
 * sweep never reads is a sign-up that is never answered.
 *
 * The API, not this component, decides whose address the email goes to: for
 * a signed-in customer it uses the session and ignores the body. The field is
 * shown pre-filled and read-only for them so they can see where it will go.
 *
 * Two shapes:
 *  - `full` replaces the add-to-cart button on the product page, at the exact
 *    moment the chosen size turns out to be gone;
 *  - `compact` is a quiet link on stylist and capsule cards, where the piece
 *    is shown but the customer's size is not in stock.
 */
export function NotifyWhenAvailable({
  productId,
  color,
  size,
  sizes,
  variant = 'full',
  className,
}: {
  productId: string
  color: string
  /** The sold-out size the customer already chose, if there is one. */
  size?: string | null
  /** Otherwise, the sold-out sizes to choose from inside the dialog. */
  sizes?: string[]
  variant?: 'full' | 'compact'
  className?: string
}) {
  const { t, tf, currentUser } = useStore()

  const firstSize = size ?? sizes?.[0] ?? null
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string | null>(firstSize)
  const [email, setEmail] = useState(currentUser?.email ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A different size or colour is a different subscription. A confirmation
  // for the previous variant must not carry over and imply this one is set.
  useEffect(() => {
    setChosen(firstSize)
    setDone(false)
    setError(null)
  }, [firstSize, color])

  // Signing in while the page is open should fill the address in.
  useEffect(() => {
    if (currentUser?.email) setEmail(currentUser.email)
  }, [currentUser?.email])

  async function subscribe() {
    if (submitting || !chosen) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/stock-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, size: chosen, color, email }),
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

  const signedIn = Boolean(currentUser)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === 'full' ? (
          <button
            type="button"
            className={cn(
              'flex w-full items-center justify-center gap-2.5 border border-gold/40 bg-gold/5 py-4 text-[13px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground',
              className,
            )}
          >
            <BellRing className="size-4" />
            {t('stockAlert.cta')}
          </button>
        ) : (
          <button
            type="button"
            className={cn(
              'tap-safe inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-gold/80 transition hover:text-gold',
              className,
            )}
          >
            <BellRing className="size-3.5" />
            {t('stockAlert.cta')}
          </button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-md border-gold/20 bg-popover">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl font-bold tracking-tight">
            <BellRing className="size-4 text-gold" />
            {t('stockAlert.title')}
          </DialogTitle>
          <DialogDescription className="text-[13px] font-light leading-relaxed">
            {t('stockAlert.body')}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <p
            role="status"
            className="flex items-center gap-2 border border-gold/40 bg-gold/5 px-4 py-3.5 text-[13px] font-light text-gold"
          >
            <Check className="size-4 shrink-0" />
            {t('stockAlert.confirmed')}
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void subscribe()
            }}
            className="space-y-4"
          >
            {sizes && sizes.length > 1 && (
              <fieldset>
                <legend className="mb-2 text-[11px] uppercase tracking-[0.12em] text-foreground">
                  {t('stockAlert.pickSize')}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {sizes.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setChosen(s)}
                      aria-pressed={chosen === s}
                      className={cn(
                        'min-w-11 border px-3 py-2.5 text-[13px] font-light transition-colors duration-200',
                        chosen === s
                          ? 'border-gold bg-gold/5 text-gold'
                          : 'border-border text-foreground/70 hover:border-foreground/30 hover:text-foreground',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {chosen && (
              <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                {tf('stockAlert.forSize', { size: chosen, color })}
              </p>
            )}

            <label className="block">
              <span className="mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-foreground">
                {t('checkout.email')}
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={signedIn}
                required
                autoComplete="email"
                className={cn(
                  'w-full border border-border bg-background px-3 py-2.5 text-[13px] text-foreground outline-none transition focus:border-gold',
                  signedIn && 'text-muted-foreground',
                )}
              />
              {signedIn && (
                <span className="mt-1.5 block text-[11px] font-light text-muted-foreground/70">
                  {t('stockAlert.accountEmail')}
                </span>
              )}
            </label>

            {error && (
              <p role="alert" className="text-[12px] text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !chosen}
              className="flex w-full items-center justify-center gap-2 border border-gold/40 bg-gold/5 px-5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 className="size-3.5 animate-spin" />}
              {t('stockAlert.notify')}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
