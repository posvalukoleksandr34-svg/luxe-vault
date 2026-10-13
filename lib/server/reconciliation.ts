import 'server-only'

import { reconcilePayments, type Discrepancy, type ProviderPayment } from '@/lib/payment-reconciliation'
import { getOrdersByNumbers } from '@/lib/server/orders-store'
import { getStripe } from '@/lib/server/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import type Stripe from 'stripe'

/**
 * Card payments of the last `days` days, compared with the orders
 * (lib/payment-reconciliation.ts). Read-only on both sides: it lists Stripe
 * PaymentIntents and reads orders, and changes neither.
 *
 * Both sides of the window: every order created in it, plus every order a
 * payment in it points at (a customer who paid an older order later).
 * At most MAX_PAYMENTS intents, newest first; `truncated` says when there
 * were more.
 */
const MAX_PAYMENTS = 1000

export type ReconciliationReport = {
  since: string
  payments: number
  orders: number
  truncated: boolean
  discrepancies: Discrepancy[]
}

export async function reconcileStripe(days: number): Promise<ReconciliationReport> {
  const span = Math.min(Math.max(Math.trunc(days) || 7, 1), 90)
  const since = new Date(Date.now() - span * 24 * 60 * 60 * 1000)

  const payments: ProviderPayment[] = []
  let truncated = false
  const list = getStripe().paymentIntents.list({
    created: { gte: Math.floor(since.getTime() / 1000) },
    limit: 100,
    expand: ['data.latest_charge'],
  })
  for await (const pi of list) {
    if (payments.length >= MAX_PAYMENTS) {
      truncated = true
      break
    }
    const charge = pi.latest_charge && typeof pi.latest_charge !== 'string' ? (pi.latest_charge as Stripe.Charge) : null
    payments.push({
      id: pi.id,
      status: pi.status,
      currency: pi.currency ?? '',
      amountReceived: pi.amount_received ?? 0,
      amountRefunded: charge?.amount_refunded ?? 0,
      orderId: typeof pi.metadata?.orderId === 'string' ? pi.metadata.orderId : undefined,
    })
  }

  const supabase = createAdminClient()
  const numbers = new Set<string>()
  const { data: recent, error } = await supabase
    .from('orders')
    .select('order_number')
    .gte('created_at', since.toISOString())
    .limit(5000)
  if (error) throw new Error(`Failed to read orders: ${error.message}`)
  for (const r of (recent ?? []) as { order_number: string }[]) numbers.add(r.order_number)

  const ids = payments.map((p) => p.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: e } = await supabase.from('orders').select('order_number').in('payment_id', ids.slice(i, i + 200))
    if (e) throw new Error(`Failed to read orders: ${e.message}`)
    for (const r of (data ?? []) as { order_number: string }[]) numbers.add(r.order_number)
  }
  for (const p of payments) if (p.orderId) numbers.add(p.orderId)

  const orders = Array.from((await getOrdersByNumbers(Array.from(numbers))).values())
  // Only orders whose payment Stripe could have returned: card orders of the
  // window, or any order a returned payment points at.
  const inScope = orders.filter((o) => o.paymentProvider === 'stripe' || payments.some((p) => p.orderId === o.id))
  return {
    since: since.toISOString(),
    payments: payments.length,
    orders: inScope.length,
    truncated,
    discrepancies: reconcilePayments(inScope, payments),
  }
}
