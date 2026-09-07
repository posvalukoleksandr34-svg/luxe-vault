'use client'

import { ArrowLeft, Loader2, SearchX } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { OrderTracker } from '@/components/order-tracker'
import { fetchMyOrders } from '@/lib/order-registry'
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

  /** Re-reads the order. Called after a payment resolves so the tracker and
   *  the payment CTA both reflect the new state without a full reload. */
  const load = useCallback(async () => {
    const orders = await fetchMyOrders()
    setOrder(orders.find((o) => o.id === orderId) ?? null)
    setLoading(false)
  }, [orderId])

  useEffect(() => {
    let active = true
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

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-16">
      <Link
        href="/"
        className="mb-10 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('crypto.back')}
      </Link>

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="h-5 w-5 animate-spin text-gold" />
        </div>
      ) : order ? (
        <>
          {/* Read-only. Payment is completed on /checkout; an unpaid order is
              settled from "My Orders" in the account drawer, not from here —
              a tracking page that demands money is a dark pattern. */}
          <OrderTracker order={order} />
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 py-24 text-center">
          <SearchX className="h-8 w-8 text-muted-foreground/40" strokeWidth={1.25} />
          <p className="text-sm font-light text-muted-foreground">{t('track.notFound')}</p>
          <p className="max-w-sm text-[12px] font-light leading-relaxed text-muted-foreground/70">
            {/* The order may exist but belong to someone else, or to a browser
                that no longer holds its token — both look identical here, on
                purpose. */}
            <span className="font-mono text-foreground">{orderId}</span>
          </p>
        </div>
      )}
    </main>
  )
}
