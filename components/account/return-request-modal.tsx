'use client'

import { AlertCircle, Loader2, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useStore } from '@/lib/store'
import { RETURN_REASONS, type ReturnReason } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { UIKey } from '@/lib/i18n'

/**
 * "Request a return" — the form a customer fills in before anything happens.
 *
 * WHY THIS EXISTS. The button used to file a request in one click, with no
 * reason and no confirmation. Nothing unsafe happened — no money has ever
 * moved from here, and the refund is still an admin's to execute — but a
 * manager was handed "someone wants to return LV-ABC123" and nothing they
 * could act on, so every request became an email exchange to find out what
 * was actually wrong.
 *
 * The three fields are the three things that decision needs: WHY, in the
 * customer's own words if the category is not enough, and their confirmation
 * that the piece is in a state that can be accepted. The checkbox is a
 * condition of the return rather than a formality, which is why the schema
 * (lib/returns/schema.ts) refuses a request without it rather than trusting
 * this component to have disabled the button.
 */

const REASON_LABEL: Record<ReturnReason, UIKey> = {
  wrong_size: 'rma.reason.wrong_size',
  defective: 'rma.reason.defective',
  not_as_described: 'rma.reason.not_as_described',
  changed_mind: 'rma.reason.changed_mind',
  other: 'rma.reason.other',
}

/** The order of the list a customer reads, which is not the order the enum
 *  happens to be declared in: the two that are the shop's fault come first. */
const REASON_ORDER: ReturnReason[] = [
  'wrong_size',
  'defective',
  'not_as_described',
  'changed_mind',
  'other',
]

export function ReturnRequestModal({
  orderId,
  open,
  onOpenChange,
  onSubmitted,
}: {
  orderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a request is filed, so the list can refresh and show the
   *  pending badge without this component knowing how orders are loaded. */
  onSubmitted: () => void
}) {
  const { t, pushToast } = useStore()

  const [reason, setReason] = useState<ReturnReason>('wrong_size')
  const [comment, setComment] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !agreed) return
    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/refund-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, comment: comment.trim(), agreed, images: [] }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        // An order that already has an open request is not a failure worth a
        // red message — the list is about to show the pending badge anyway.
        if (data?.error === 'ALREADY_OPEN') {
          onOpenChange(false)
          onSubmitted()
          pushToast({ title: t('rma.alreadyOpen'), variant: 'default' })
          return
        }
        setError(typeof data?.error === 'string' ? data.error : t('orders.cancelFailed'))
        return
      }

      onOpenChange(false)
      onSubmitted()
      pushToast({ title: t('rma.submitted'), description: orderId, variant: 'gold' })
    } catch {
      setError(t('orders.cancelFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('rma.title')}</DialogTitle>
          <DialogDescription>{t('rma.intro')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-6">
          <fieldset>
            <legend className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {t('rma.reason')}
            </legend>
            {/* Radios, not a <select>: five short options are faster to choose
                from when they are all visible, and on a phone a native select
                opens a wheel for what is a one-tap decision. */}
            <div className="mt-3 space-y-1">
              {REASON_ORDER.map((value) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 border px-4 py-3 text-[13px] font-light transition-colors duration-200',
                    reason === value
                      ? 'border-gold/50 bg-gold/5 text-foreground'
                      : 'border-border/60 text-foreground/70 hover:border-gold/30',
                  )}
                >
                  <input
                    type="radio"
                    name="return-reason"
                    value={value}
                    checked={reason === value}
                    onChange={() => setReason(value)}
                    className="size-3.5 accent-gold"
                  />
                  {t(REASON_LABEL[value])}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="rma-comment"
              className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              {t('rma.comment')}
            </label>
            <textarea
              id="rma-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t('rma.commentHint')}
              className="mt-3 w-full resize-none border border-border bg-background px-3.5 py-3 text-[13px] font-light text-foreground outline-none transition placeholder:text-muted-foreground/50 focus:border-gold"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-3 text-[13px] font-light leading-relaxed text-foreground/80">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-gold"
            />
            {t('rma.confirm')}
          </label>

          {error && (
            <p className="flex items-start gap-2 text-[12px] font-light leading-snug text-destructive">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="tap-safe min-h-[44px] border border-border px-6 text-[11px] uppercase tracking-[0.2em] text-muted-foreground transition-colors duration-300 hover:text-foreground"
            >
              {t('rma.cancel')}
            </button>
            {/* Disabled until the box is ticked: the schema refuses it anyway,
                but a customer should see the condition rather than be told
                about it by a validation error after they press submit. */}
            <button
              type="submit"
              disabled={saving || !agreed}
              className="tap-safe no-juice inline-flex min-h-[44px] items-center justify-center gap-2 border border-gold bg-gold px-8 text-[11px] uppercase tracking-[0.2em] text-gold-foreground transition-colors duration-300 enabled:hover:bg-transparent enabled:hover:text-gold disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
              ) : (
                <RotateCcw aria-hidden className="size-3.5" />
              )}
              {t('rma.submit')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
