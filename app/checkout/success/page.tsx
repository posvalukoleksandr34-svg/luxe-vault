'use client'

import { ArrowRight, CheckCircle2, Loader2, MapPin, Package, SearchX, Truck } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { Header } from '@/components/header'
import { estimateDelivery, formatDeliveryWindow } from '@/lib/fulfilment'
import { fetchMyOrders } from '@/lib/order-registry'
import { formatPrice, useStore } from '@/lib/store'
import type { Order } from '@/lib/types'

/**
 * Thank-you page. Reached only after a payment resolves.
 *
 * It is deliberately READ-ONLY: it looks the order up and renders it. Nothing
 * here creates, charges or mutates anything, which is what makes it safe to
 * refresh or reach with the Back button — the two ways a customer most often
 * duplicates an order on a naive success page.
 *
 * The order is fetched through /api/orders/lookup rather than trusted from the
 * query string, so `?order=LV-XXXXXX` for somebody else's order shows the
 * not-found state instead of their name and address.
 */
/**
 * `useSearchParams` opts its whole subtree out of prerendering. Without this
 * boundary the entire route — header included — deopts to client-side
 * rendering and the customer stares at a blank page after paying. The boundary
 * keeps the shell static and confines the wait to the order card.
 */
export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<SuccessSkeleton />}>
      <SuccessContent />
    </Suspense>
  )
}

function SuccessSkeleton() {
  return (
    <>
      <Header />
      <main className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-gold" />
      </main>
    </>
  )
}

function SuccessContent() {
  const params = useSearchParams()
  const orderId = params.get('order')?.trim().toUpperCase() ?? ''
  const { t, locale } = useStore()

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    if (!orderId) {
      setLoading(false)
      return
    }
    fetchMyOrders()
      .then((orders) => {
        if (!active) return
        setOrder(orders.find((o) => o.id === orderId) ?? null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [orderId])

  // Prefer the window stamped at purchase; fall back for pre-0011 orders.
  const eta = order
    ? order.deliveryEstimateMin && order.deliveryEstimateMax
      ? { earliest: new Date(order.deliveryEstimateMin), latest: new Date(order.deliveryEstimateMax) }
      : estimateDelivery(order)
    : null

  if (loading) return <SuccessSkeleton />

  if (!order) {
    return (
      <>
        <Header />
        <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
          <SearchX className="size-8 text-muted-foreground/40" strokeWidth={1.25} />
          <p className="text-sm font-light text-muted-foreground">{t('track.notFound')}</p>
          <Link
            href="/"
            className="border border-gold/40 bg-gold/5 px-6 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
          >
            {t('cart.continueShopping')}
          </Link>
        </main>
      </>
    )
  }

  return (
    <>
      <Header />

      <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-6 sm:py-16">
        {/* Confirmation */}
        <div className="text-center">
          <CheckCircle2 className="mx-auto size-10 text-gold" strokeWidth={1.25} />
          <h1 className="mt-6 font-serif text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
            {t('success.thankYou')}
            {order.customer.name ? `, ${order.customer.name.split(' ')[0]}` : ''}!
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[14px] font-light leading-relaxed text-muted-foreground">
            {t('success.subtitle')}
          </p>

          {/* The id a customer quotes to support. Monospaced and selectable. */}
          <div className="mt-7 inline-flex flex-col items-center gap-1 border border-gold/40 bg-gold/[0.05] px-6 py-4">
            <span className="text-[10px] uppercase tracking-[0.2em] text-gold/70">
              {t('success.orderNumber')}
            </span>
            <span className="select-all font-mono text-xl font-medium tracking-wide text-foreground">
              {order.id}
            </span>
          </div>
        </div>

        {/* Delivery window, stamped at purchase */}
        {eta && (
          <section className="card-gold mt-8 flex items-start gap-3 p-5">
            <Truck className="mt-0.5 size-4 shrink-0 text-gold/70" strokeWidth={1.5} />
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {t('success.expectedDelivery')}
              </p>
              <p className="mt-1.5 font-serif text-lg text-gold">
                {formatDeliveryWindow(eta, locale)}
              </p>
            </div>
          </section>
        )}

        {/* Itemised summary */}
        <section className="card-gold mt-4 p-5 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 border-b border-border/50 pb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <Package className="size-3.5 text-gold/60" strokeWidth={1.5} />
            {t('track.items')}
          </h2>
          <ul className="divide-y divide-border/40">
            {order.items.map((item) => (
              <li key={item.key} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.image}
                  alt={item.name}
                  className="size-14 shrink-0 border border-border/60 object-cover"
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

          <dl className="mt-4 space-y-2 border-t border-border/50 pt-4 text-[13px] font-light">
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
                {t('success.totalPaid')}
              </dt>
              <dd className="font-serif text-xl text-gold">{formatPrice(order.total)}</dd>
            </div>
          </dl>
        </section>

        {/* Shipping address */}
        <section className="card-gold mt-4 p-5 sm:p-6">
          <h2 className="mb-3 flex items-center gap-2 border-b border-border/50 pb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <MapPin className="size-3.5 text-gold/60" strokeWidth={1.5} />
            {t('track.shippingTo')}
          </h2>
          <address className="not-italic text-[13px] font-light leading-relaxed text-muted-foreground">
            <span className="block text-foreground">{order.customer.name}</span>
            <span className="block">{order.customer.address}</span>
            {order.customer.phone && <span className="mt-1 block tabular-nums">{order.customer.phone}</span>}
          </address>
        </section>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/order/${encodeURIComponent(order.id)}`}
            className="flex flex-1 items-center justify-center gap-2 border border-gold/40 bg-gold/10 py-3.5 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
          >
            <Truck className="size-3.5" />
            {t('success.trackOrder')}
          </Link>
          <Link
            href="/#shop"
            className="flex flex-1 items-center justify-center gap-2 border border-border py-3.5 text-[12px] uppercase tracking-[0.15em] text-muted-foreground transition-all duration-300 hover:text-foreground"
          >
            {t('cart.continueShopping')}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>

        <p className="mt-6 text-center text-[11px] font-light leading-relaxed text-muted-foreground/60">
          {t('success.emailNote')}
        </p>
      </main>
    </>
  )
}
