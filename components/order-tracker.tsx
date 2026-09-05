'use client'

import { Check, Copy, PackageCheck, Truck, XCircle } from 'lucide-react'
import { useState } from 'react'
import { ORDER_STATUS_KEYS } from '@/lib/i18n'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Order, OrderStatus } from '@/lib/types'

/**
 * The happy path a parcel walks. `cancelled` is deliberately absent: it is not
 * a step along this line but an exit from it, so it gets its own banner rather
 * than a fifth dot that would imply cancellation follows delivery.
 */
const STEPS: OrderStatus[] = ['pending', 'processing', 'shipped', 'delivered']

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

  const cancelled = order.status === 'cancelled'
  const currentIndex = cancelled ? -1 : STEPS.indexOf(order.status)
  // Guard against an unknown status leaving the bar at a nonsensical width.
  const progress =
    currentIndex <= 0 ? 0 : (currentIndex / (STEPS.length - 1)) * 100

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
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {t('track.title')}
          </p>
          <h1 className="mt-2 font-mono text-2xl font-medium text-foreground">
            {order.id}
          </h1>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {t('track.placed')} · {new Date(order.createdAt).toLocaleDateString(locale)}
          </p>
        </div>
        <span className="font-serif text-2xl text-gold">{formatPrice(order.total)}</span>
      </header>

      {cancelled ? (
        <div className="flex items-center gap-3 border border-destructive/40 bg-destructive/5 px-4 py-3.5">
          <XCircle className="h-4 w-4 shrink-0 text-destructive" strokeWidth={1.5} />
          <p className="text-[13px] text-destructive">{t('track.cancelled')}</p>
        </div>
      ) : (
        <section>
          <div className="relative">
            {/* Rail */}
            <div className="absolute left-0 right-0 top-[11px] h-px bg-border" />
            {/* Fill, sized to the furthest step reached */}
            <div
              className="absolute left-0 top-[11px] h-px bg-gold transition-[width] duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />

            <ol className="relative flex justify-between">
              {STEPS.map((step, i) => {
                const reached = i <= currentIndex
                const at = stepTimestamp(order, step)
                return (
                  <li key={step} className="flex flex-1 flex-col items-center gap-2 last:flex-none">
                    <span
                      className={cn(
                        'flex h-[23px] w-[23px] items-center justify-center rounded-full border bg-background transition-colors duration-500',
                        reached
                          ? 'border-gold text-gold'
                          : 'border-border text-muted-foreground/40',
                      )}
                    >
                      {reached ? (
                        <Check className="h-3 w-3" strokeWidth={2.5} />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      )}
                    </span>
                    <span
                      className={cn(
                        'text-center text-[10px] uppercase tracking-[0.12em]',
                        reached ? 'text-foreground' : 'text-muted-foreground/50',
                      )}
                    >
                      {t(ORDER_STATUS_KEYS[step])}
                    </span>
                    {at && (
                      <span className="text-[10px] tabular-nums text-muted-foreground/60">
                        {new Date(at).toLocaleDateString(locale)}
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          </div>
        </section>
      )}

      {order.trackingNumber && (
        <section className="border border-gold/30 bg-gold/[0.03] p-5">
          <div className="flex items-center gap-2">
            <Truck className="h-3.5 w-3.5 text-gold" strokeWidth={1.5} />
            <span className="text-[11px] uppercase tracking-[0.15em] text-gold">
              {t('track.trackingNumber')}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="select-all font-mono text-base text-foreground">
              {order.trackingNumber}
            </code>
            <button
              type="button"
              onClick={copyTracking}
              className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition hover:border-gold/50 hover:text-gold"
            >
              {copied ? (
                <Check className="h-3 w-3" strokeWidth={2} />
              ) : (
                <Copy className="h-3 w-3" strokeWidth={1.5} />
              )}
              {copied ? t('track.copied') : t('track.copy')}
            </button>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 flex items-center gap-2 border-b border-border pb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          <PackageCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t('track.items')}
        </h2>
        <ul className="space-y-3">
          {order.items.map((item) => (
            <li key={item.key} className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image}
                alt={item.name}
                className="h-16 w-16 shrink-0 border border-border object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-foreground">{item.name}</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t('product.size')}: <span className="text-foreground">{item.size}</span>
                  {' · '}
                  {item.color}
                  {' · '}×{item.qty}
                </p>
              </div>
              <span className="shrink-0 text-[13px] text-foreground">
                {formatPrice(item.price * item.qty)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-border pt-6">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {t('track.shippingTo')}
        </h2>
        <address className="mt-3 not-italic text-[13px] leading-relaxed text-muted-foreground">
          <span className="block text-foreground">{order.customer.name}</span>
          <span className="block">{order.customer.address}</span>
          {order.customer.phone && <span className="block">{order.customer.phone}</span>}
        </address>
      </section>
    </div>
  )
}
