'use client'

import { ArrowLeft, Loader2, SearchX } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { CryptoPayment } from '@/components/crypto-payment'
import { OrderTracker } from '@/components/order-tracker'
import { StripePayment } from '@/components/stripe-payment'
import { isUnpaid } from '@/components/account-orders'
import { CARD_PAYMENT_METHOD } from '@/lib/data'
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

  /**
   * Payment, on the page the customer lands on after checkout.
   *
   * The checkout form now creates the order and redirects straight here, so
   * this is where the money is actually taken — without it the new flow would
   * produce orders with no reachable way to pay them.
   *
   * Branches on the method stored with the order, exactly as the account
   * page's retry does.
   */
  const [paying, setPaying] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  async function startPayment() {
    if (!order?.lookupToken || starting) return
    setPayError(null)
    if (order.payment === CARD_PAYMENT_METHOD) {
      setStarting(true)
      try {
        const res = await fetch('/api/payments/stripe/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: order.id, token: order.lookupToken }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.clientSecret) {
          setPayError(data.error ?? t('checkout.paymentUnavailable'))
          return
        }
        setClientSecret(data.clientSecret)
        setPaying(true)
      } catch {
        setPayError(t('checkout.paymentUnavailable'))
      } finally {
        setStarting(false)
      }
      return
    }
    setPaying(true)
  }

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
          {/* Unpaid: payment comes first, above the timeline — it is the only
              thing on this page the customer can act on. */}
          {isUnpaid(order) && order.lookupToken && (
            <div className="mb-8">
              {paying ? (
                order.payment === CARD_PAYMENT_METHOD && clientSecret ? (
                  <StripePayment
                    order={order}
                    clientSecret={clientSecret}
                    onPaid={() => { setPaying(false); void load() }}
                    onBack={() => { setPaying(false); setClientSecret(null) }}
                  />
                ) : (
                  <CryptoPayment
                    orderId={order.id}
                    token={order.lookupToken}
                    onPaid={() => { setPaying(false); void load() }}
                    onBack={() => setPaying(false)}
                  />
                )
              ) : (
                <div className="glow-breathe border border-gold/45 bg-gold/[0.05] p-5">
                  <p className="text-[12px] font-light text-muted-foreground">
                    {t('orders.unpaidHint')}
                  </p>
                  <button
                    type="button"
                    onClick={() => void startPayment()}
                    disabled={starting}
                    className="mt-4 w-full border border-gold/40 bg-gold/10 py-3.5 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:opacity-40"
                  >
                    {starting ? t('checkout.paying') : t('orders.payNow')}
                  </button>
                  {payError && (
                    <p className="mt-3 text-[11px] text-destructive">{payError}</p>
                  )}
                </div>
              )}
            </div>
          )}
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
