'use client'

import { SearchX } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { LoadError } from '@/components/load-error'
import { OrderTracker } from '@/components/order-tracker'
import { OrderDetailSkeleton } from '@/components/skeletons'
import { loadMyOrders } from '@/lib/order-registry'
import { useStore } from '@/lib/store'
import type { Order } from '@/lib/types'

/**
 * Customer-facing order tracking.
 *
 * Authorisation is deliberately delegated to /api/orders/lookup rather than
 * re-implemented here: that endpoint returns an order only when the caller
 * either holds its lookup token or is the signed-in owner. Fetching the whole
 * authorised set and then selecting by id means this page cannot accidentally
 * become a way to read someone else's order by guessing its number.
 */
export default function OrderTrackingPage() {
  const params = useParams<{ id: string }>()
  const orderId = decodeURIComponent(params.id)
  const { t } = useStore()

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  /**
   * The lookup failed, as opposed to returning an order that is not ours.
   *
   * This page had the worst version of the empty-vs-error confusion in the
   * app: any failed request rendered "order not found" over the customer's
   * own order number. Someone arriving from a confirmation email during a
   * blip was told their order did not exist.
   */
  const [failed, setFailed] = useState(false)

  /** Re-reads the order. Called after a payment resolves so the tracker and
   *  the payment CTA both reflect the new state without a full reload. */
  const load = useCallback(async () => {
    setLoading(true)
    const result = await loadMyOrders()
    if (result.ok) setOrder(result.orders.find((o) => o.id === orderId) ?? null)
    setFailed(!result.ok)
    setLoading(false)
  }, [orderId])

  useEffect(() => {
    let active = true
    loadMyOrders()
      .then((result) => {
        if (!active) return
        if (result.ok) setOrder(result.orders.find((o) => o.id === orderId) ?? null)
        setFailed(!result.ok)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [orderId])

  return (
    <>
      {/* The page had NO header and NO footer — a customer arriving from a
          confirmation email landed on an island whose only exit was one small
          "back" link. It is a page of the shop, so it gets the shop's frame,
          its search, its cart and its account. */}
      <Header />

      <main id="main" className="mx-auto min-h-[60vh] w-full max-w-2xl px-6 py-12 sm:py-16">
        <Breadcrumbs
          trail={[
            { name: t('common.home'), url: '/' },
            { name: t('track.title'), url: `/order/${encodeURIComponent(orderId)}` },
          ]}
        />

        {loading ? (
          <OrderDetailSkeleton label={t('common.loading')} />
        ) : failed ? (
          <LoadError onRetry={load} />
        ) : order ? (
          /* Read-only. Payment is completed on /checkout; an unpaid order is
             settled from "My Orders" in the account drawer, not from here —
             a tracking page that demands money is a dark pattern. */
          <OrderTracker order={order} />
        ) : (
          <div className="flex flex-col items-center gap-4 py-24 text-center">
            <SearchX className="h-8 w-8 text-muted-foreground/40" strokeWidth={1.25} />
            <p className="text-sm font-light text-muted-foreground">{t('track.notFound')}</p>
            <p className="max-w-sm text-[12px] font-light leading-relaxed text-muted-foreground/70">
              {/* The order may exist but belong to someone else, or to a
                  browser that no longer holds its token — both look identical
                  here, on purpose. */}
              <span className="font-mono text-foreground">{orderId}</span>
            </p>
          </div>
        )}
      </main>

      <Footer />
    </>
  )
}
