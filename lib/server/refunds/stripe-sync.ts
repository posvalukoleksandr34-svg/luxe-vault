import 'server-only'

import type Stripe from 'stripe'

import type { Actor } from '@/lib/refunds/types'
import {
  ledgerForOrder,
  ledgerRow,
  ledgerRowByProviderId,
  recordExternal,
  settle,
  type LedgerRow,
} from '@/lib/server/refunds/ledger'
import { loadOrderFacts } from '@/lib/server/refunds/order-facts'
import { fromProviderMinor, mapStripeStatus, unexplainedStripeRefunds } from '@/lib/server/refunds/payments'
import { applyLedgerOutcome, markOrderDisputed } from '@/lib/server/refunds/workflow'
import { getStripe } from '@/lib/server/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Stripe's word on refunds, from the webhook (app/api/payments/stripe/webhook).
 *
 *   refund.created / refund.updated / refund.failed / charge.refund.updated
 *     — one Refund object. Ours (found by its id, or by the refund_tx_id we
 *       put in its metadata) is settled with Stripe's status. One we did not
 *       make — the Stripe dashboard, a dispute — is RECORDED in the ledger as
 *       'external', so the ledger stays the whole truth.
 *   charge.refunded — the charge with its refunds; each is handled as above.
 *
 * Replays are harmless: settling a row with the status it already has changes
 * nothing, and an external refund is keyed on Stripe's refund id.
 */

const STRIPE: Actor = { type: 'provider', label: 'Stripe' }

export type SyncOutcome = { matched: boolean; transactionId?: string; external?: boolean; status?: string }

async function orderIdForPayment(paymentIntentId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().from('orders').select('id').eq('payment_id', paymentIntentId).maybeSingle()
  if (error) throw new Error(`Failed to find the order for ${paymentIntentId}: ${error.message}`)
  return (data?.id as string | undefined) ?? null
}

export async function syncStripeRefund(refund: Stripe.Refund, correlationId?: string): Promise<SyncOutcome> {
  const status = mapStripeStatus(refund.status)
  let row: LedgerRow | null = await ledgerRowByProviderId(refund.id)
  const txId = refund.metadata?.refund_tx_id
  if (!row && typeof txId === 'string' && /^[0-9a-f-]{36}$/i.test(txId)) {
    const candidate = await ledgerRow(txId)
    const pi = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id
    // Metadata is ours, but only trusted when it points at a row for the
    // same payment.
    if (candidate && candidate.paymentReference === pi) row = candidate
  }

  if (row) {
    if (row.status === status && row.providerRefundId) return { matched: true, transactionId: row.id, status }
    // A status Stripe has moved past cannot go backwards (the ledger refuses
    // it); an out-of-order older event is simply ignored.
    try {
      const settled = await settle({
        transactionId: row.id,
        status: row.status === status ? undefined : status,
        providerRefundId: refund.id,
        providerAmountMinor: refund.amount,
        providerCurrency: refund.currency?.toUpperCase(),
        failureCode: refund.failure_reason ?? undefined,
        actorType: 'provider',
        actorLabel: 'Stripe',
        correlationId,
      })
      await applyLedgerOutcome(settled.row, STRIPE, correlationId)
      return { matched: true, transactionId: row.id, status: settled.row.status }
    } catch (e) {
      if ((e as Error).message.includes('not a valid refund state change')) {
        return { matched: true, transactionId: row.id, status: row.status }
      }
      throw e
    }
  }

  // Not ours: made in the dashboard or by Stripe itself.
  if (status !== 'succeeded' && status !== 'pending') return { matched: false }
  const pi = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id
  if (!pi) return { matched: false }
  const orderId = await orderIdForPayment(pi)
  if (!orderId) return { matched: false }
  const order = await loadOrderFacts({ id: orderId })
  if (!order) return { matched: false }

  // Is it already accounted for — by a backfilled total from before the
  // ledger, say? Compare Stripe's refunded total with the ledger's.
  const charge = typeof refund.charge === 'string' ? await getStripe().charges.retrieve(refund.charge) : refund.charge
  const ledger = await ledgerForOrder(orderId)
  const { unexplained, tolerance } = unexplainedStripeRefunds(order, ledger, charge?.amount_refunded ?? refund.amount)
  if (unexplained <= tolerance) return { matched: true, external: true, status: 'already_accounted' }

  const providerMinor = Math.min(refund.amount, unexplained)
  const row2 = await recordExternal({
    orderId,
    providerRefundId: refund.id,
    paymentReference: pi,
    amountMinor: fromProviderMinor(order, providerMinor),
    providerAmountMinor: providerMinor,
    providerCurrency: refund.currency?.toUpperCase(),
    status,
    reason: refund.reason ? `Stripe: ${refund.reason}` : 'Refund made in Stripe',
    correlationId,
  })
  if (row2) await applyLedgerOutcome(row2, STRIPE, correlationId)
  return { matched: true, external: true, transactionId: row2?.id, status }
}

/** charge.refunded: every refund on the charge, through syncStripeRefund. */
export async function syncChargeRefunds(charge: Stripe.Charge, correlationId?: string): Promise<SyncOutcome[]> {
  const refunds: Stripe.Refund[] = []
  if (charge.refunds?.data && !charge.refunds.has_more) {
    refunds.push(...charge.refunds.data)
  } else {
    for await (const r of getStripe().refunds.list({ charge: charge.id, limit: 100 })) refunds.push(r)
  }
  const out: SyncOutcome[] = []
  // Oldest first, so an external refund is measured against the ledger as it
  // stood when it happened.
  for (const r of refunds.sort((a, b) => a.created - b.created)) {
    out.push(await syncStripeRefund({ ...r, charge: r.charge ?? charge }, correlationId))
  }
  return out
}

/** charge.dispute.created: the order's open cases are marked disputed. */
export async function syncDispute(dispute: Stripe.Dispute): Promise<number> {
  const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id
  if (!pi) return 0
  const orderId = await orderIdForPayment(pi)
  if (!orderId) return 0
  return markOrderDisputed(orderId, dispute.id, `Chargeback: ${dispute.reason}`)
}
