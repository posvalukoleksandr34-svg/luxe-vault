'use client'

import {
  Check,
  Clock,
  Copy,
  Home,
  MapPin,
  PackageCheck,
  PackageSearch,
  Receipt,
  Truck,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { ORDER_STATUS_KEYS, type UIKey } from '@/lib/i18n'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Order, OrderStatus } from '@/lib/types'

/**
 * The happy path a parcel walks. `cancelled` and `refunded` are deliberately
 * absent: they are exits from this line, not points along it, so they get
 * their own banner rather than a fifth node implying cancellation follows
 * delivery.
 */
const STEPS: {
  status: OrderStatus
  Icon: typeof Clock
  subtitle: UIKey
}[] = [
  { status: 'pending', Icon: Clock, subtitle: 'track.step.pending.sub' },
  { status: 'processing', Icon: PackageSearch, subtitle: 'track.step.processing.sub' },
  { status: 'shipped', Icon: Truck, subtitle: 'track.step.shipped.sub' },
  { status: 'delivered', Icon: Home, subtitle: 'track.step.delivered.sub' },
]

function stepTimestamp(order: Order, status: OrderStatus): number | undefined {
  switch (status) {
    case 'pending':
      return order.createdAt
    case 'processing':
      return order.processingAt
    case 'shipped':
      return order.shippedAt
    case 'delivered':
      return order.deliveredAt
    default:
      return undefined
  }
}

export function OrderTracker({ order }: { order: Order }) {
  const { t, locale } = useStore()
  const [copied, setCopied] = useState(false)

  const terminal = order.status === 'cancelled' || order.status === 'refunded'
  const currentIndex = terminal ? -1 : STEPS.findIndex((s) => s.status === order.status)

  async function copyTracking() {
    if (!order.trackingNumber) return
    try {
      await navigator.clipboard.writeText(order.trackingNumber)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (insecure origin or denied permission) — the number
      // is still on screen to copy by hand, so this is not worth an error.
    }
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ header */}
      <header className="card-gold p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.25em] text-gold/70">
              {t('track.title')}
            </p>
            {/* Monospaced and large: the order number is the one string a
                customer reads aloud to support or pastes into an email. */}
            <h1 className="mt-2.5 break-all font-mono text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
              {order.id}
            </h1>
            <p className="mt-2 text-[12px] font-light text-muted-foreground">
              {t('track.placed')} · {new Date(order.createdAt).toLocaleDateString(locale)}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2.5">
            <span className="font-serif text-3xl font-light text-gold">
              {formatPrice(order.total)}
            </span>
            <span
              className={cn(
                'border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]',
                terminal
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : 'border-gold/40 bg-gold/10 text-gold',
              )}
            >
              {t(ORDER_STATUS_KEYS[order.status])}
            </span>
          </div>
        </div>
      </header>

      {/* ----------------------------------------------------------- tracker */}
      {terminal ? (
        <div className="flex items-center gap-3 border border-destructive/40 bg-destructive/5 px-5 py-4">
          <XCircle className="size-4 shrink-0 text-destructive" strokeWidth={1.5} />
          <p className="text-[13px] font-light text-destructive">{t('track.cancelled')}</p>
        </div>
      ) : (
        <section className="space-y-3">
          <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
            <MapPin className="size-3 text-gold/60" strokeWidth={1.5} />
            {t('track.timeline')}
          </p>

          {/* One card per step rather than dots on a rail. A dot can only say
              "reached"; a card carries the icon, the date and the sentence
              explaining what is actually happening during a 20–35 day wait,
              which is the question this page exists to answer.

              Stacked vertically at every width on purpose: four columns of
              two-line prose is unreadable on a phone, and the vertical rail
              reads as a timeline, which is what it is. */}
          <ol className="space-y-2.5">
            {STEPS.map(({ status, Icon, subtitle }, i) => {
              const reached = i <= currentIndex
              const active = i === currentIndex
              const at = stepTimestamp(order, status)

              return (
                <li key={status} className="relative">
                  {/* Connector to the next node, drawn behind the card. */}
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden
                      className={cn(
                        'absolute left-[30px] top-full z-0 h-2.5 w-px',
                        i < currentIndex ? 'bg-gold/50' : 'bg-border',
                      )}
                    />
                  )}

                  <div
                    className={cn(
                      'relative flex items-start gap-4 border p-4 transition-all duration-500 sm:p-5',
                      active
                        // The active step breathes, so on a page a customer
                        // revisits for weeks the eye lands on "where is it
                        // now" without reading anything.
                        ? 'glow-breathe border-gold/55 bg-gold/[0.06]'
                        : reached
                          ? 'border-gold/25 bg-gold/[0.02]'
                          : 'border-border/50 bg-card/30',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center border transition-colors duration-500',
                        active
                          ? 'border-gold bg-gold/15 text-gold'
                          : reached
                            ? 'border-gold/40 bg-gold/5 text-gold/80'
                            : 'border-border text-muted-foreground/40',
                      )}
                    >
                      {reached && !active ? (
                        <Check className="size-4" strokeWidth={2.5} />
                      ) : (
                        <Icon className="size-4" strokeWidth={1.5} />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p
                          className={cn(
                            'text-[12px] uppercase tracking-[0.14em]',
                            active
                              ? 'text-gold'
                              : reached
                                ? 'text-foreground'
                                : 'text-muted-foreground/50',
                          )}
                        >
                          {t(ORDER_STATUS_KEYS[status])}
                        </p>
                        {at && (
                          <span className="text-[11px] tabular-nums text-muted-foreground/60">
                            {new Date(at).toLocaleDateString(locale)}
                          </span>
                        )}
                      </div>
                      <p
                        className={cn(
                          'mt-1.5 text-[12px] font-light leading-relaxed',
                          reached ? 'text-muted-foreground' : 'text-muted-foreground/45',
                        )}
                      >
                        {t(subtitle)}
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {/* ---------------------------------------------------- tracking number */}
      {order.trackingNumber && (
        <section className="glow-breathe border border-gold/45 bg-gold/[0.05] p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Truck className="size-3.5 text-gold" strokeWidth={1.5} />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gold">
              {t('track.trackingNumber')}
            </span>
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-3">
            <code className="select-all break-all font-mono text-lg tracking-wide text-foreground sm:text-xl">
              {order.trackingNumber}
            </code>
            <button
              type="button"
              onClick={copyTracking}
              className="flex shrink-0 items-center gap-1.5 border border-gold/30 px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-gold/80 transition hover:border-gold/60 hover:text-gold"
            >
              {copied ? (
                <Check className="size-3" strokeWidth={2} />
              ) : (
                <Copy className="size-3" strokeWidth={1.5} />
              )}
              {copied ? t('track.copied') : t('track.copy')}
            </button>
          </div>
        </section>
      )}

      {/* -------------------------------------------------------------- items */}
      <section className="card-gold p-5 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 border-b border-border/50 pb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <PackageCheck className="size-3.5 text-gold/60" strokeWidth={1.5} />
          {t('track.items')}
        </h2>
        <ul className="divide-y divide-border/40">
          {order.items.map((item) => (
            <li key={item.key} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image}
                alt={item.name}
                className="size-16 shrink-0 border border-border/60 object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-light text-foreground">{item.name}</p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
                  {item.size} · {item.color} · ×{item.qty}
                </p>
              </div>
              <span className="shrink-0 text-[13px] font-light tabular-nums text-foreground">
                {formatPrice(item.price * item.qty)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------------ summary */}
      {/* New. The page previously showed line items and a header total with
          nothing connecting them, so a discounted order looked like an
          arithmetic error. */}
      <section className="card-gold p-5 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 border-b border-border/50 pb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <Receipt className="size-3.5 text-gold/60" strokeWidth={1.5} />
          {t('track.summary')}
        </h2>
        <dl className="space-y-2 text-[13px] font-light">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('track.subtotal')}</dt>
            <dd className="tabular-nums text-foreground">{formatPrice(order.subtotal)}</dd>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {t('track.discount')}
                {order.promo && (
                  <span className="ml-1.5 font-mono text-[11px] text-gold/70">{order.promo}</span>
                )}
              </dt>
              <dd className="tabular-nums text-destructive">−{formatPrice(order.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border/50 pt-3">
            <dt className="text-[11px] uppercase tracking-[0.15em] text-foreground">
              {t('track.total')}
            </dt>
            <dd className="font-serif text-xl text-gold">{formatPrice(order.total)}</dd>
          </div>
          <div className="flex justify-between pt-1">
            <dt className="text-[11px] text-muted-foreground/60">{t('track.paymentMethod')}</dt>
            <dd className="text-[11px] text-muted-foreground">{order.payment}</dd>
          </div>
        </dl>
      </section>

      {/* ------------------------------------------------------------ address */}
      <section className="card-gold p-5 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 border-b border-border/50 pb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <MapPin className="size-3.5 text-gold/60" strokeWidth={1.5} />
          {t('track.shippingTo')}
        </h2>
        <address className="not-italic text-[13px] font-light leading-relaxed text-muted-foreground">
          <span className="block text-foreground">{order.customer.name}</span>
          <span className="block">{order.customer.address}</span>
          {order.customer.phone && (
            <span className="mt-1 block tabular-nums">{order.customer.phone}</span>
          )}
        </address>
      </section>
    </div>
  )
}
