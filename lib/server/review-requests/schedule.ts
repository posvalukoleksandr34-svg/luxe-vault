import 'server-only'

import { scheduledAtFor, type ReviewRequestSettings } from '@/lib/review-requests'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Creating review requests from confirmed deliveries.
 *
 * Two ways in, both idempotent through the unique index on order_id:
 *
 *  - EVENT: setOrderStatus() calls scheduleForOrder() when an order becomes
 *    'delivered' (lib/server/orders-store.ts). Fire-and-forget: the status
 *    save never waits on it or fails because of it.
 *  - RECONCILIATION: the hourly job (reconcile) creates any request a missed
 *    event left out, moves scheduled_at when a delivery date was corrected,
 *    and applies a changed delay to requests not yet attempted.
 *
 * The clock is orders.delivered_at, set by the orders_stamp_status trigger
 * when the order first became 'delivered'. Nothing else counts.
 */

const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42883'])

export class ReviewRequestsUnavailable extends Error {
  constructor() {
    super('Migration 0060 (review requests) is not applied')
  }
}

export function unavailable(error: { code?: string } | null): boolean {
  return Boolean(error && MISSING.has(error.code ?? ''))
}

type DeliveredOrder = { id: string; order_number: string; user_id: string | null; status: string; delivered_at: string | null }

/** Schedules the request for one order, by its LV- number. Never throws. */
export async function scheduleForOrder(orderNumber: string, settings: ReviewRequestSettings): Promise<'scheduled' | 'exists' | 'not_delivered' | 'unavailable' | 'error'> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('orders')
      .select('id, order_number, user_id, status, delivered_at')
      .eq('order_number', orderNumber)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const order = data as DeliveredOrder | null
    if (!order || order.status !== 'delivered') return 'not_delivered'
    if (!order.delivered_at) {
      // The trigger stamps it on every move to 'delivered'; a delivered
      // order without it is a data problem worth seeing, not guessing over.
      console.warn(`[review-requests] ${orderNumber} is delivered but has no delivered_at; not scheduled`)
      return 'not_delivered'
    }
    return await insertRequests([order], settings)
  } catch (e) {
    console.error(`[review-requests] could not schedule ${orderNumber}:`, (e as Error).message)
    return 'error'
  }
}

async function insertRequests(orders: DeliveredOrder[], settings: ReviewRequestSettings): Promise<'scheduled' | 'exists' | 'unavailable'> {
  if (!orders.length) return 'exists'
  const rows = orders.map((o) => {
    const delivered = Date.parse(o.delivered_at as string)
    return {
      order_id: o.id,
      user_id: o.user_id,
      delivered_at: new Date(delivered).toISOString(),
      scheduled_at: new Date(scheduledAtFor(delivered, settings)).toISOString(),
    }
  })
  const { data, error } = await createAdminClient()
    .from('review_requests')
    .upsert(rows, { onConflict: 'order_id', ignoreDuplicates: true })
    .select('id')
  if (error) {
    if (unavailable(error)) throw new ReviewRequestsUnavailable()
    throw new Error(`Could not create review requests: ${error.message}`)
  }
  return (data ?? []).length > 0 ? 'scheduled' : 'exists'
}

export type ReconcileResult = { created: number; rescheduled: number }

const PAGE = 500

/**
 * Brings the queue in line with the orders. Safe to run any number of times
 * and from several places at once (inserts ignore duplicates; updates set
 * values computed from the order, so two runs write the same thing).
 */
export async function reconcile(settings: ReviewRequestSettings, now = Date.now()): Promise<ReconcileResult> {
  const admin = createAdminClient()
  const out: ReconcileResult = { created: 0, rescheduled: 0 }
  // Deliveries older than the stale limit would only be suppressed.
  const since = new Date(now - settings.staleAfterDays * 24 * 60 * 60 * 1000).toISOString()

  // 1. Delivered orders without a request (an event that never arrived).
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('orders')
      .select('id, order_number, user_id, status, delivered_at')
      .eq('status', 'delivered')
      .gte('delivered_at', since)
      .order('delivered_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Could not read delivered orders: ${error.message}`)
    const orders = (data ?? []) as DeliveredOrder[]
    if (!orders.length) break
    const { data: existing, error: exError } = await admin
      .from('review_requests')
      .select('order_id')
      .in('order_id', orders.map((o) => o.id))
    if (exError) {
      if (unavailable(exError)) throw new ReviewRequestsUnavailable()
      throw new Error(`Could not read review requests: ${exError.message}`)
    }
    const have = new Set((existing ?? []).map((r) => (r as { order_id: string }).order_id))
    const missing = orders.filter((o) => !have.has(o.id) && o.delivered_at)
    if (missing.length) {
      if ((await insertRequests(missing, settings)) === 'scheduled') out.created += missing.length
    }
    if (orders.length < PAGE) break
  }

  // 2. Scheduled requests whose delivery date was corrected, or whose delay
  //    changed since they were created. Only requests never attempted: one
  //    already tried keeps its retry timing.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('review_requests')
      .select('id, delivered_at, scheduled_at, attempts, orders!inner(delivered_at)')
      .eq('status', 'scheduled')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      if (unavailable(error)) throw new ReviewRequestsUnavailable()
      throw new Error(`Could not read scheduled requests: ${error.message}`)
    }
    const rows = (data ?? []) as unknown as {
      id: string
      delivered_at: string
      scheduled_at: string
      attempts: number
      orders: { delivered_at: string | null } | { delivered_at: string | null }[]
    }[]
    for (const r of rows) {
      const order = Array.isArray(r.orders) ? r.orders[0] : r.orders
      if (!order?.delivered_at) continue // no longer delivered: the worker suppresses it
      const delivered = Date.parse(order.delivered_at)
      const want = scheduledAtFor(delivered, settings)
      const deliveredChanged = delivered !== Date.parse(r.delivered_at)
      const delayChanged = r.attempts === 0 && want !== Date.parse(r.scheduled_at)
      if (!deliveredChanged && !delayChanged) continue
      const { error: upError } = await admin
        .from('review_requests')
        .update({ delivered_at: new Date(delivered).toISOString(), scheduled_at: new Date(want).toISOString() })
        .eq('id', r.id)
        .eq('status', 'scheduled')
      if (upError) throw new Error(`Could not reschedule ${r.id}: ${upError.message}`)
      if (deliveredChanged) console.info(`[review-requests] ${r.id}: delivery date corrected, rescheduled`)
      out.rescheduled++
    }
    if (rows.length < PAGE) break
  }
  return out
}

/**
 * The delivery event: called (not awaited) when an order is set to
 * 'delivered'. Never throws; the hourly reconciliation catches anything this
 * misses.
 */
export async function onOrderDelivered(orderNumber: string): Promise<void> {
  try {
    const { readReviewRequestSettings } = await import('./settings')
    const { settings } = await readReviewRequestSettings()
    const outcome = await scheduleForOrder(orderNumber, settings)
    if (outcome === 'scheduled') console.info(`[review-requests] scheduled for ${orderNumber}`)
  } catch (e) {
    console.error(`[review-requests] delivery event for ${orderNumber} not handled:`, (e as Error).message)
  }
}

const RETENTION_MS = 365 * 24 * 60 * 60 * 1000

/**
 * Retention (privacy policy, section 5): a request is deleted 12 months after
 * it was sent — or, if it never was, 12 months after it was created. The
 * opt-out list (email_suppressions) is kept, so that nobody is asked again.
 */
export async function purgeOld(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - RETENTION_MS).toISOString()
  const admin = createAdminClient()
  const [sent, unsent] = await Promise.all([
    admin.from('review_requests').delete().lt('sent_at', cutoff).select('id'),
    admin.from('review_requests').delete().is('sent_at', null).lt('created_at', cutoff).neq('status', 'sending').select('id'),
  ])
  for (const r of [sent, unsent]) {
    if (r.error) {
      if (unavailable(r.error)) throw new ReviewRequestsUnavailable()
      throw new Error(`Could not purge old review requests: ${r.error.message}`)
    }
  }
  return (sent.data ?? []).length + (unsent.data ?? []).length
}
