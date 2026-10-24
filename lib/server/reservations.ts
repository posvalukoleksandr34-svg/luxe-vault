import 'server-only'

import { cancelOrder } from '@/lib/server/orders-store'
import { cancelPaymentIntent, isStripeConfigured } from '@/lib/server/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * How long an unpaid order may hold its units (migration 0056).
 *
 * Every order is paid up front, and place_order() takes the units when the
 * order is created — before payment — so an order nobody pays used to keep
 * its pieces off sale forever. The policy:
 *
 *   HOLD     48 h after the order was placed. Long enough for the one
 *            "your order is waiting" reminder (sent 2 h–~26 h after the
 *            order, migration 0019) to be acted on the next day; short
 *            enough that an abandoned basket, or a script placing orders it
 *            never pays, returns the pieces within two days instead of never.
 *            A card payment itself takes minutes, so the hold is about the
 *            customer coming back, not about the card network.
 *   GRACE    not while a payment was started in the last 60 minutes: a
 *            customer on the payment sheet is never interrupted.
 *   CEILING  72 h after the order, the grace no longer applies: restarting a
 *            payment every hour must not hold stock forever.
 *
 * Never released, whatever the clock says: an order whose money arrived
 * (paid, partly or fully refunded), one whose payment is settling
 * ('confirming' — a bank debit, a crypto payment seen on chain; settled or
 * failed by its webhook), or one already shipped.
 *
 * Card orders: the PaymentIntent is cancelled at Stripe FIRST. If Stripe says
 * it succeeded or is processing, the order is left for the webhook. If Stripe
 * cannot be reached, nothing is released and the next run tries again —
 * releasing units for a payment that might still complete would sell them
 * twice. If Stripe answers that the intent does not exist in this account
 * (an order placed with test keys on a shop now live), nothing can be
 * charged through it: the order is released and reported as such, instead
 * of holding its stock and alerting forever.
 *
 * Crypto orders: NOWPayments has no cancel. A payment that arrives after the
 * release is still marked paid by the webhook, which re-takes the units or
 * alerts when they are gone (reclaim_order_stock, 0030).
 *
 * Environment (all optional): RESERVATION_HOLD_HOURS (1–168, default 48),
 * RESERVATION_GRACE_MINUTES (5–240, default 60), RESERVATION_CEILING_HOURS
 * (≥ hold, ≤ 336, default 72), RESERVATION_EXPIRY=off to switch it off.
 */
export type ReservationPolicy = { holdHours: number; graceMinutes: number; ceilingHours: number }

function bounded(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** The policy in force, or null when switched off. */
export function reservationPolicy(env: Record<string, string | undefined> = process.env): ReservationPolicy | null {
  if (env.RESERVATION_EXPIRY?.trim().toLowerCase() === 'off') return null
  const holdHours = bounded(env.RESERVATION_HOLD_HOURS, 48, 1, 168)
  const graceMinutes = bounded(env.RESERVATION_GRACE_MINUTES, 60, 5, 240)
  const ceilingHours = Math.max(holdHours, bounded(env.RESERVATION_CEILING_HOURS, Math.max(72, holdHours + 24), 1, 336))
  return { holdHours, graceMinutes, ceilingHours }
}

export type ReservationRun =
  | { status: 'off' }
  | { status: 'unmigrated' }
  | {
      status: 'ok'
      policy: ReservationPolicy
      dryRun: boolean
      /** Orders whose reservation had lapsed when the run started. */
      candidates: string[]
      /** Cancelled and restocked by this run. */
      released: string[]
      /** Stripe says the payment succeeded or is processing: left for the webhook. */
      paymentInFlight: string[]
      /** Stripe's status for each paymentInFlight order ('succeeded' or 'processing'). */
      paymentInFlightStatus: Record<string, string>
      /** Stripe could not confirm the cancellation (or is not configured): retried next run. */
      providerError: string[]
      /** Stripe's answer for each providerError order, so an alert says why. */
      providerMessages: Record<string, string>
      /** Released: Stripe has no such payment in this account, so it can never be charged here. */
      releasedMissingIntent: string[]
      /** The order changed while the run looked at it (paid, cancelled by hand): left alone. */
      changed: string[]
      /** The database refused or failed the cancellation: nothing changed, retried next run. */
      failed: string[]
      /** Cancelled earlier by this sweep, but its units never went back (the
       *  restock failed): put back by this run. */
      restockRepaired: string[]
      /** Units still not back on the shelf after this run: retried next run. */
      restockFailed: string[]
    }

/** A lapsed order, as expirable_unpaid_orders (0056) returns it. */
export type LapsedOrder = { order_number: string; payment_provider: string | null; payment_id: string | null }

/** What a run touches, injectable so the failure paths can be tested
 *  without a database or Stripe (tests/security/reservations-reconciliation.test.ts). */
export type ReservationDeps = {
  /** Lapsed orders, oldest first; 'unmigrated' when 0056 is not applied. Throws on any other error. */
  listLapsed(policy: ReservationPolicy, limit: number): Promise<LapsedOrder[] | 'unmigrated'>
  stripeConfigured(): boolean
  cancelPaymentIntent: typeof cancelPaymentIntent
  /** cancelOrder() without the customer email. Throws when the database fails. */
  cancel(orderNumber: string, reason: string): Promise<{ conflict: boolean; restockFailed: boolean }>
  /** Orders this sweep cancelled whose units never went back (restocked_at null). */
  listUnrestocked(limit: number): Promise<string[]>
  /** restore_order_stock(): true when it put units back, false when already done. Throws on failure. */
  restock(orderNumber: string): Promise<boolean>
}

const MISSING = new Set(['42883', 'PGRST202'])

/** Every order this sweep cancels carries this reason, which is how a failed
 *  restock of one of them is found again (and only of them: an order
 *  cancelled before restocked_at existed must never be restocked twice). */
const REASON_PREFIX = 'Reservation expired:'

const defaultDeps: ReservationDeps = {
  async listLapsed(policy, limit) {
    const { data, error } = await createAdminClient().rpc('expirable_unpaid_orders', {
      p_hold: `${policy.holdHours} hours`,
      p_grace: `${policy.graceMinutes} minutes`,
      p_ceiling: `${policy.ceilingHours} hours`,
      p_limit: limit,
    })
    if (error) {
      if (MISSING.has(error.code)) return 'unmigrated'
      throw new Error(`Could not list lapsed reservations: ${error.message}`)
    }
    return (data ?? []) as LapsedOrder[]
  },
  stripeConfigured: isStripeConfigured,
  cancelPaymentIntent,
  async cancel(orderNumber, reason) {
    const result = await cancelOrder(orderNumber, reason, { notify: false })
    return { conflict: result.conflict, restockFailed: result.restockFailed }
  },
  async listUnrestocked(limit) {
    const { data, error } = await createAdminClient()
      .from('orders')
      .select('order_number')
      .eq('status', 'cancelled')
      .eq('payment_status', 'expired')
      .is('restocked_at', null)
      .like('cancelled_reason', `${REASON_PREFIX}%`)
      .order('created_at', { ascending: true })
      .limit(limit)
    if (error) throw new Error(`Could not list unrestocked orders: ${error.message}`)
    return (data ?? []).map((r) => String((r as { order_number: string }).order_number))
  },
  async restock(orderNumber) {
    const { data, error } = await createAdminClient().rpc('restore_order_stock', { p_order_number: orderNumber })
    if (error) throw new Error(`restore_order_stock failed: ${error.message}`)
    return data === true
  },
}

/**
 * The alert for orders whose reservation lapsed while Stripe holds a payment
 * for them. Every such order is older than the hold (48 h), so the webhook
 * should long since have settled it:
 *
 *   succeeded   the money was taken but the order still reads unpaid — the
 *               webhook never arrived, failed, or refused the payment (wrong
 *               amount or currency). The customer is waiting for goods.
 *   processing  a bank payment still settling; worth a look if it lasts
 *               more than a few days.
 *
 * Until 2026-10-24 these orders were only counted in the log, so six of
 * them sat for days without anyone being told. Null when there is nothing
 * to say.
 */
export function paymentInFlightAlert(orders: string[], statuses: Record<string, string>): string | null {
  if (orders.length === 0) return null
  const paid = orders.filter((n) => statuses[n] === 'succeeded')
  const other = orders.filter((n) => statuses[n] !== 'succeeded')
  const lines: string[] = []
  if (paid.length > 0) {
    lines.push(
      `Stripe shows ${paid.length} payment(s) as SUCCEEDED, but the order is still unpaid here: ${paid.join(', ')}. ` +
        'Check Stripe → Developers → Webhooks (event deliveries) and /api/admin/reconciliation; do not ship or refund before the order and Stripe agree.',
    )
  }
  if (other.length > 0) {
    lines.push(
      `Stripe shows ${other.length} payment(s) as still processing past the reservation hold: ` +
        other.map((n) => `${n} (${statuses[n] ?? 'unknown'})`).join(', ') +
        '. Their stock stays held until Stripe settles them.',
    )
  }
  return lines.join('\n')
}

/**
 * Releases lapsed reservations. Safe to run concurrently and repeatedly:
 * cancelOrder() only succeeds once per order (its UPDATE re-checks the state)
 * and restore_order_stock() only restocks once (restocked_at). Order numbers
 * only in the result — no names, addresses or emails.
 *
 * One order's failure never stops the others: each is tried on its own and
 * lands in exactly one list. A database failure leaves that order as it was
 * (`failed`); a cancellation whose restock failed (`restockFailed`) is found
 * again by the next run and its units put back then (`restockRepaired`).
 */
export async function releaseExpiredReservations(
  options: { dryRun?: boolean; limit?: number; policy?: ReservationPolicy | null; deps?: Partial<ReservationDeps> } = {},
): Promise<ReservationRun> {
  const policy = options.policy === undefined ? reservationPolicy() : options.policy
  if (!policy) return { status: 'off' }
  const deps: ReservationDeps = { ...defaultDeps, ...options.deps }
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)

  const rows = await deps.listLapsed(policy, limit)
  if (rows === 'unmigrated') return { status: 'unmigrated' }

  const run = {
    status: 'ok' as const,
    policy,
    dryRun: Boolean(options.dryRun),
    candidates: rows.map((r) => r.order_number),
    released: [] as string[],
    paymentInFlight: [] as string[],
    paymentInFlightStatus: {} as Record<string, string>,
    providerError: [] as string[],
    providerMessages: {} as Record<string, string>,
    releasedMissingIntent: [] as string[],
    changed: [] as string[],
    failed: [] as string[],
    restockRepaired: [] as string[],
    restockFailed: [] as string[],
  }
  if (options.dryRun) return run

  // Earlier runs' leftovers first: units that should already be on the shelf.
  let unrestocked: string[] = []
  try {
    unrestocked = await deps.listUnrestocked(limit)
  } catch (e) {
    console.error('[reservations] could not look for unrestocked orders:', (e as Error).message)
  }
  for (const orderNumber of unrestocked) {
    try {
      // false: another run put them back in the meantime — nothing to report.
      if (await deps.restock(orderNumber)) run.restockRepaired.push(orderNumber)
    } catch (e) {
      console.error(`[reservations] restock of ${orderNumber} failed again:`, (e as Error).message)
      run.restockFailed.push(orderNumber)
    }
  }

  for (const row of rows) {
    let missingIntent = false
    try {
      if (row.payment_provider === 'stripe' && row.payment_id) {
        if (!deps.stripeConfigured()) {
          run.providerError.push(row.order_number)
          run.providerMessages[row.order_number] = 'Stripe is not configured'
          continue
        }
        const cancelled = await deps.cancelPaymentIntent(row.payment_id)
        if (!cancelled.ok && cancelled.reason !== 'missing') {
          if (cancelled.reason === 'captured') {
            run.paymentInFlight.push(row.order_number)
            run.paymentInFlightStatus[row.order_number] = cancelled.intentStatus ?? 'unknown'
          } else {
            run.providerError.push(row.order_number)
            run.providerMessages[row.order_number] = cancelled.message.slice(0, 200)
          }
          continue
        }
        if (!cancelled.ok) missingIntent = true
      }

      // No "your order was cancelled" email for a basket the customer walked
      // away from; the order shows as cancelled in their account.
      const result = await deps.cancel(row.order_number, `${REASON_PREFIX} not paid within ${policy.holdHours} hours`)
      if (result.conflict) run.changed.push(row.order_number)
      else if (result.restockFailed) run.restockFailed.push(row.order_number)
      else (missingIntent ? run.releasedMissingIntent : run.released).push(row.order_number)
    } catch (e) {
      // The order is unchanged (the cancelling UPDATE did not commit) or, if
      // it did, the restock pass above finds it next run.
      console.error(`[reservations] ${row.order_number} could not be released:`, (e as Error).message)
      run.failed.push(row.order_number)
    }
  }
  return run
}
