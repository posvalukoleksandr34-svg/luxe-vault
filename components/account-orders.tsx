'use client'

import { AlertCircle, AlertTriangle, ArrowLeft, Ban, ChevronDown, RotateCcw, Loader2, Package, RefreshCw, Truck, Wallet } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { CryptoPayment } from '@/components/crypto-payment'
import { StripePayment } from '@/components/stripe-payment'
import { TrackingDetails } from '@/components/tracking-details'
import { CARD_PAYMENT_METHOD } from '@/lib/data'
import { ORDER_STATUS_KEYS } from '@/lib/i18n'
import { tokenFor } from '@/lib/order-registry'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Order, OrderStatus, PaymentStatus } from '@/lib/types'

const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'text-muted-foreground bg-muted/40 border-border',
  processing: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  shipped: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  delivered: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  cancelled: 'text-red-400 bg-red-400/10 border-red-400/30',
  refunded: 'text-violet-300 bg-violet-400/10 border-violet-400/30',
}

/** Terminal states. An order here is finished — nothing about it is actionable
 *  and it must never appear among orders awaiting payment. */
export function isCancelled(order: Order): boolean {
  return order.status === 'cancelled' || order.status === 'refunded'
}

/**
 * An order still owes money.
 *
 * The `isCancelled` guard is load-bearing, not defensive. Cancelling writes
 * payment_status 'expired', which is "not paid" — so without it a cancelled
 * order stayed in the unpaid list showing a live "Pay now" button, letting the
 * customer pay for an order that no longer exists.
 *
 * Orders with no payment status at all predate prepayment and never appear.
 */
export function isUnpaid(order: Order): boolean {
  if (isCancelled(order)) return false
  return Boolean(order.paymentStatus) && order.paymentStatus !== 'paid'
}

export function AccountOrders({
  orders,
  loading,
  onReload,
  unpaidOnly = false,
}: {
  orders: Order[]
  loading: boolean
  onReload: () => void
  unpaidOnly?: boolean
}) {
  const { t, locale, pushToast } = useStore()
  const [paying, setPaying] = useState<{ order: Order; token: string } | null>(null)
  // Client secret for a card retry. Minted on demand: a PaymentIntent created
  // eagerly for every unpaid order would leave abandoned intents in Stripe.
  const [retrySecret, setRetrySecret] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [startingPayment, setStartingPayment] = useState<string | null>(null)
  // Keyed by order id rather than a single boolean, so two cards cannot both
  // show a spinner when only one request is in flight.
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<{ id: string; message: string } | null>(null)
  const [refunding, setRefunding] = useState<string | null>(null)
  // The order awaiting confirmation. window.confirm() was replaced because it
  // is unstyled, unlocalisable beyond its button labels, and on mobile Safari
  // renders as a jarring system sheet over a dark luxury UI.
  const [confirmOrder, setConfirmOrder] = useState<Order | null>(null)
  const [cancelledOpen, setCancelledOpen] = useState(false)

  const load = onReload

  async function cancel(order: Order) {
    if (cancelling) return
    setConfirmOrder(null)
    setCancelling(order.id)
    setCancelError(null)
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        // Surface the server's own message — a 409 explains *why* (already
        // paid, payment in flight), which a generic string would throw away.
        setCancelError({ id: order.id, message: data.error || t('orders.cancelFailed') })
        return
      }

      pushToast({ title: t('orders.cancelled'), description: order.id, variant: 'success' })
      // Refetch rather than patching local state: the server may also have
      // changed the payment status, and guessing at it here would drift.
      load()
    } catch {
      setCancelError({ id: order.id, message: t('orders.cancelFailed') })
    } finally {
      setCancelling(null)
    }
  }
  // Three buckets, in order of how much attention each deserves: something to
  // act on, the record of what happened, and the closed-off remainder.
  const unpaid = orders.filter(isUnpaid)
  const cancelled = orders.filter(isCancelled)
  const history = orders.filter((o) => !isUnpaid(o) && !isCancelled(o))

  /**
   * Resume payment on an unpaid order, using the method chosen at checkout.
   *
   * This used to hand every retry to CryptoPayment regardless of
   * `order.payment`, so a customer who picked a card and came back later was
   * silently pushed into a crypto flow. The method was already stored on the
   * order — nothing needed persisting, the retry just ignored it.
   */
  async function startPayment(order: Order) {
    const token = order.lookupToken ?? tokenFor(order.id)
    if (!token || startingPayment) return

    setRetryError(null)
    setRetrySecret(null)

    if (order.payment === CARD_PAYMENT_METHOD) {
      // A PaymentIntent is per-attempt, so a retry needs a fresh one; the
      // route rebuilds the amount from the stored order, never from here.
      setStartingPayment(order.id)
      try {
        const res = await fetch('/api/payments/stripe/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: order.id, token }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.clientSecret) {
          setRetryError(data.error ?? t('checkout.paymentUnavailable'))
          return
        }
        setRetrySecret(data.clientSecret)
        setPaying({ order, token })
      } catch {
        setRetryError(t('checkout.paymentUnavailable'))
      } finally {
        setStartingPayment(null)
      }
      return
    }

    setPaying({ order, token })
  }

  async function askRefund(order: Order) {
    if (refunding) return
    setRefunding(order.id)
    setCancelError(null)
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}/refund-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCancelError({ id: order.id, message: data.error || t('orders.cancelFailed') })
        return
      }
      pushToast({ title: t('orders.refundRequested'), description: order.id, variant: 'success' })
      load()
    } catch {
      setCancelError({ id: order.id, message: t('orders.cancelFailed') })
    } finally {
      setRefunding(null)
    }
  }

  if (paying) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setPaying(null)}
          className="mb-5 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t('crypto.back')}
        </button>
        <p className="mb-4 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          {t('orders.payingFor')} <span className="text-foreground">{paying.order.id}</span>
          <span className="ml-2 text-muted-foreground/50">· {paying.order.payment}</span>
        </p>

        {/* Branches on the method stored with the order, so a card order
            resumes as a card and a crypto order as crypto. */}
        {paying.order.payment === CARD_PAYMENT_METHOD && retrySecret ? (
          <StripePayment
            order={paying.order}
            clientSecret={retrySecret}
            onPaid={() => {
              setPaying(null)
              setRetrySecret(null)
              load()
            }}
            onBack={() => {
              setPaying(null)
              setRetrySecret(null)
            }}
          />
        ) : (
          <CryptoPayment
            orderId={paying.order.id}
            token={paying.token}
            onPaid={() => {
              setPaying(null)
              load()
            }}
            onBack={() => setPaying(null)}
          />
        )}
      </div>
    )
  }

  // The guest-facing block stays silent unless there is actually something
  // unpaid to act on.
  if (unpaidOnly && (loading || unpaid.length === 0)) return null

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12">
        <Loader2 className="size-4 animate-spin text-gold" />
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground">
          {t('crypto.loading')}
        </span>
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Package className="size-9 text-muted-foreground/30" strokeWidth={1} />
        <p className="text-sm font-light text-muted-foreground">{t('user.noOrders')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {unpaid.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-gold/30 pb-2">
            <h3 className="text-[11px] uppercase tracking-[0.2em] text-gold">
              {t('orders.unpaidTitle')} · {unpaid.length}
            </h3>
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground transition hover:text-foreground"
            >
              <RefreshCw className="size-3" />
              {t('orders.refresh')}
            </button>
          </div>
          <p className="mb-4 text-[11px] font-light leading-relaxed text-muted-foreground/70">
            {t('orders.unpaidHint')}
          </p>
          <div className="space-y-3">
            {unpaid.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                locale={locale}
                highlight
                action={
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmOrder(order)}
                        disabled={cancelling === order.id}
                        className="flex items-center justify-center gap-1.5 border border-border px-4 py-2.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition-all duration-300 hover:border-destructive/50 hover:text-destructive disabled:opacity-40"
                      >
                        {cancelling === order.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Ban className="size-3.5" />
                        )}
                        {t('orders.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void startPayment(order)}
                        disabled={cancelling === order.id || startingPayment === order.id}
                        className="flex items-center justify-center gap-2 border border-gold/40 bg-gold/10 px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:opacity-40"
                      >
                        <Wallet className="size-3.5" />
                        {t('orders.payNow')}
                      </button>
                    </div>
                    {retryError && startingPayment === null && paying === null && (
                      <p className="text-right text-[11px] font-light text-destructive">
                        {retryError}
                      </p>
                    )}
                    {cancelError?.id === order.id && (
                      <p className="flex items-start gap-1.5 text-right text-[11px] font-light leading-snug text-destructive">
                        <AlertCircle className="mt-px size-3 shrink-0" />
                        {cancelError.message}
                      </p>
                    )}
                  </div>
                }
              />
            ))}
          </div>
        </section>
      )}

      {!unpaidOnly && history.length > 0 && (
        <section>
          <h3 className="mb-3 border-b border-border pb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {t('orders.historyTitle')} · {history.length}
          </h3>
          <div className="space-y-3">
            {history.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                locale={locale}
                action={
                  // Refunds are requested here and executed by an admin — a
                  // one-click self-refund would let a customer keep the goods
                  // and take the money back before anyone reviewed it.
                  order.paymentStatus === 'paid' &&
                  (!order.returnStatus || order.returnStatus === 'none') ? (
                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={() => void askRefund(order)}
                        disabled={refunding === order.id}
                        className="flex items-center justify-center gap-1.5 border border-border px-4 py-2.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition-all duration-300 hover:border-gold/40 hover:text-gold disabled:opacity-40"
                      >
                        {refunding === order.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="size-3.5" />
                        )}
                        {t('orders.requestRefund')}
                      </button>
                      {cancelError?.id === order.id && (
                        <p className="flex items-start gap-1.5 text-right text-[11px] font-light leading-snug text-destructive">
                          <AlertCircle className="mt-px size-3 shrink-0" />
                          {cancelError.message}
                        </p>
                      )}
                    </div>
                  ) : order.returnStatus === 'requested' ? (
                    <span className="border border-gold/30 bg-gold/5 px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-gold/80">
                      {t('orders.refundPending')}
                    </span>
                  ) : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Cancelled orders are collapsed by default and muted. They are kept —
          a customer needs to see that a cancellation actually happened — but
          they are visually inert so they never compete with a live order. */}
      {!unpaidOnly && cancelled.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setCancelledOpen((v) => !v)}
            className="flex w-full items-center justify-between border-b border-border/60 pb-2 text-left"
          >
            <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/50">
              {t('orders.cancelledTitle')} · {cancelled.length}
            </span>
            <ChevronDown
              className={cn(
                'size-3.5 text-muted-foreground/50 transition-transform duration-300',
                cancelledOpen && 'rotate-180',
              )}
            />
          </button>
          {cancelledOpen && (
            <div className="mt-3 space-y-3">
              {cancelled.map((order) => (
                <OrderCard key={order.id} order={order} locale={locale} muted />
              ))}
            </div>
          )}
        </section>
      )}

      {confirmOrder && (
        <CancelDialog
          order={confirmOrder}
          onDismiss={() => setConfirmOrder(null)}
          onConfirm={() => void cancel(confirmOrder)}
        />
      )}
    </div>
  )
}

/**
 * Cancellation confirmation.
 *
 * Destructive and irreversible, so the affirmative action is the one styled as
 * dangerous and "keep the order" is the visually calm default — the reverse
 * would make the destructive path the one a distracted thumb finds first.
 */
function CancelDialog({
  order,
  onDismiss,
  onConfirm,
}: {
  order: Order
  onDismiss: () => void
  onConfirm: () => void
}) {
  const { t } = useStore()

  // Escape closes, matching every other dismissible surface in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return (
    <>
      <div
        className="animate-fade-in fixed inset-0 z-[120] bg-background/80 backdrop-blur-sm"
        onClick={onDismiss}
        aria-hidden
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cancel-dialog-title"
        className="animate-fade-up fixed left-1/2 top-1/2 z-[121] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 border border-border bg-popover p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <h3
              id="cancel-dialog-title"
              className="font-serif text-base font-semibold text-foreground"
            >
              {t('orders.cancelConfirmTitle')}
            </h3>
            <p className="mt-2 text-[13px] font-light leading-relaxed text-muted-foreground">
              {t('orders.cancelConfirm')}
            </p>
            <p className="mt-2 font-mono text-[12px] text-muted-foreground/70">{order.id}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onDismiss}
            autoFocus
            className="border border-border px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition-all duration-300 hover:text-foreground"
          >
            {t('orders.cancelKeep')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="border border-destructive/40 bg-destructive/10 px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-destructive transition-all duration-300 hover:bg-destructive hover:text-destructive-foreground"
          >
            {t('orders.cancelConfirmCta')}
          </button>
        </div>
      </div>
    </>
  )
}

function PaymentBadge({ status }: { status: PaymentStatus }) {
  const { t } = useStore()
  const map: Record<PaymentStatus, { label: string; className: string }> = {
    pending_payment: { label: t('orders.awaitingPayment'), className: 'text-gold border-gold/40 bg-gold/10' },
    confirming: { label: t('crypto.confirming'), className: 'text-blue-400 border-blue-400/30 bg-blue-400/10' },
    paid: { label: t('crypto.paid'), className: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' },
    failed: { label: t('crypto.failed'), className: 'text-red-400 border-red-400/30 bg-red-400/10' },
    expired: { label: t('crypto.expired'), className: 'text-red-400 border-red-400/30 bg-red-400/10' },
    refunded: { label: t('orders.refunded'), className: 'text-violet-300 border-violet-400/30 bg-violet-400/10' },
    partially_refunded: { label: t('orders.partiallyRefunded'), className: 'text-violet-300 border-violet-400/30 bg-violet-400/10' },
  }
  const c = map[status]
  return (
    <span className={cn('border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em]', c.className)}>
      {c.label}
    </span>
  )
}

function OrderCard({
  order,
  locale,
  action,
  highlight,
  muted,
}: {
  order: Order
  locale: string
  action?: React.ReactNode
  highlight?: boolean
  /** Terminal order: visually inert so it cannot compete with a live one. */
  muted?: boolean
}) {
  const { t } = useStore()

  return (
    <div
      className={cn(
        'border p-4 transition-opacity duration-300',
        highlight && 'border-gold/30 bg-gold/[0.03]',
        !highlight && !muted && 'border-border bg-card',
        // Greyed out rather than hidden: the customer needs to see that the
        // cancellation actually took effect. Opacity lifts on hover so the
        // details stay readable when someone deliberately looks.
        // opacity-50, not opacity-55: Tailwind 3.3's default opacity scale has
        // no 55 step, so that class emitted no CSS at all and the card stayed
        // fully opaque (measured: computed opacity 1).
        muted && 'border-border/40 bg-card/30 opacity-50 hover:opacity-90',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[13px] font-medium text-foreground">{order.id}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {new Date(order.createdAt).toLocaleDateString(locale)} · {order.payment}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={cn('font-serif text-lg', muted ? 'text-muted-foreground/60 line-through' : 'text-gold')}>
            {formatPrice(order.total)}
          </span>
          <div className="flex flex-wrap justify-end gap-1.5">
            <span
              className={cn(
                'border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em]',
                ORDER_STATUS_COLORS[order.status],
              )}
            >
              {t(ORDER_STATUS_KEYS[order.status])}
            </span>
            {/* Suppressed on a cancelled order: "payment expired" beside
                "cancelled" is redundant, and reads as a second, different
                problem rather than a consequence of the first. */}
            {order.paymentStatus && !muted && <PaymentBadge status={order.paymentStatus} />}
          </div>
          {order.refundedAmount != null && order.refundedAmount > 0 && (
            <span className="text-[10px] uppercase tracking-[0.1em] text-violet-300/80">
              {t('orders.refundedAmount')} {formatPrice(order.refundedAmount)}
            </span>
          )}
        </div>
      </div>

      {/* Above the items, not below: on a shipped order "where is it" is the
          only question the customer opened this card to answer, and it should
          not be under a list they have already seen. Renders nothing until the
          admin enters a number. */}
      {order.trackingNumber && (
        <div className="mt-3">
          <TrackingDetails order={order} compact />
        </div>
      )}

      <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
        {order.items.map((item) => (
          <div key={item.key} className="flex items-center gap-3">
            <Image
              src={item.image}
              alt={item.name}
              width={40}
              height={40}
              className={cn('size-10 shrink-0 object-cover', muted && 'grayscale')}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-light text-foreground">{item.name}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                {item.size} · {item.color} · ×{item.qty}
              </p>
            </div>
            <span className="shrink-0 text-[12px] font-light text-foreground">
              {formatPrice(item.price * item.qty)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        <a
          href={`/order/${encodeURIComponent(order.id)}`}
          className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition hover:text-gold"
        >
          <Truck className="size-3.5" />
          {t('track.title')}
        </a>
        {action}
      </div>
    </div>
  )
}
