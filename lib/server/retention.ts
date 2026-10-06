import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Enforces the retention periods the Privacy Policy states
 * (app/legal/_content/privacy.ts, section "Retention"). Run daily by
 * /api/cron/sweep. Each rule deletes in bounded batches and reports a count;
 * a failure in one does not stop the others.
 *
 * The periods live here AND in the policy text. Change one, change both.
 */

const DAY = 86_400_000
const BATCH = 200

/** Support requests: 24 months after they were resolved or closed. */
export const SUPPORT_RETENTION_DAYS = 730
/** Orders (and their items and return requests): 5 years from the sale. */
export const ORDER_RETENTION_DAYS = 5 * 365 + 1
/** Unconfirmed newsletter sign-ups: 30 days (double opt-in, 0051). */
export const NEWSLETTER_PENDING_DAYS = 30
/** Cart-reminder records once finished (recovered / expired): 30 days.
 *  Opt-outs are kept — they are what stops any later reminder. */
export const CART_RECORD_DAYS = 30

const MISSING = new Set(['42P01', 'PGRST205', '42703'])

function before(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString()
}

export type RetentionResult = {
  supportTickets: number
  orders: number
  newsletterPending: number
  cartRecords: number
  paymentBlocks: number
  errors: string[]
}

export async function enforceRetention(): Promise<RetentionResult> {
  const supabase = createAdminClient()
  const result: RetentionResult = { supportTickets: 0, orders: 0, newsletterPending: 0, cartRecords: 0, paymentBlocks: 0, errors: [] }

  // ---------------------------------------------------- support requests --
  try {
    const { data: tickets, error } = await supabase
      .from('support_tickets')
      .select('id')
      .in('status', ['resolved', 'closed'])
      .lt('updated_at', before(SUPPORT_RETENTION_DAYS))
      .limit(BATCH)
    if (error) throw error
    const ids = (tickets ?? []).map((t) => t.id as string)
    if (ids.length > 0) {
      // Attachments first: they are files in a private bucket, which the
      // database cascade does not reach.
      const { data: messages, error: msgError } = await supabase
        .from('support_messages')
        .select('attachments')
        .in('ticket_id', ids)
      if (msgError && !MISSING.has(msgError.code)) throw msgError
      const paths = (messages ?? []).flatMap((m) =>
        Array.isArray(m.attachments) ? (m.attachments as { path?: unknown }[]).map((a) => a?.path).filter((p): p is string => typeof p === 'string') : [],
      )
      if (paths.length > 0) {
        const { error: rmError } = await supabase.storage.from('support-attachments').remove(paths)
        if (rmError) throw rmError
      }
      const { error: delError } = await supabase.from('support_tickets').delete().in('id', ids)
      if (delError) throw delError
      result.supportTickets = ids.length
    }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (!MISSING.has(err.code ?? '')) result.errors.push(`retention/support: ${err.message}`)
  }

  // -------------------------------------------------------------- orders --
  // Items and return requests cascade; referrals keep their row with the
  // order number cleared. Return photos left without a request are removed by
  // the orphaned-photo sweep that runs after this.
  try {
    const { data: due, error } = await supabase
      .from('orders')
      .select('id')
      .lt('created_at', before(ORDER_RETENTION_DAYS))
      .limit(BATCH)
    if (error) throw error
    const ids = (due ?? []).map((o) => o.id as string)
    if (ids.length > 0) {
      const { error: delError } = await supabase.from('orders').delete().in('id', ids)
      if (delError) throw delError
      result.orders = ids.length
    }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (!MISSING.has(err.code ?? '')) result.errors.push(`retention/orders: ${err.message}`)
  }

  // ---------------------------------------------- newsletter, unconfirmed --
  try {
    const { data, error } = await supabase
      .from('newsletter_subscribers')
      .delete()
      .eq('status', 'pending')
      .lt('confirmation_sent_at', before(NEWSLETTER_PENDING_DAYS))
      .select('id')
    if (error) throw error
    result.newsletterPending = data?.length ?? 0
  } catch (e) {
    const err = e as { code?: string; message?: string }
    // 23514/42703: migration 0051 not applied yet — nothing can be pending.
    if (!MISSING.has(err.code ?? '') && err.code !== '23514' && err.code !== '22P02') {
      result.errors.push(`retention/newsletter: ${err.message}`)
    }
  }

  // ------------------------------------------------ cart-reminder records --
  try {
    const { data, error } = await supabase
      .from('abandoned_carts')
      .delete()
      .in('status', ['recovered', 'expired'])
      .is('opted_out_at', null)
      .lt('updated_at', before(CART_RECORD_DAYS))
      .select('id')
    if (error) throw error
    result.cartRecords = data?.length ?? 0
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (!MISSING.has(err.code ?? '')) result.errors.push(`retention/carts: ${err.message}`)
  }

  // ------------------------------------------ expired card-payment blocks --
  // Email / hashed-IP blocks from the fraud guard (0053) are only useful
  // until they expire; nothing is kept after that.
  try {
    const { data, error } = await supabase
      .from('payment_blocks')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('kind')
    if (error) throw error
    result.paymentBlocks = data?.length ?? 0
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (!MISSING.has(err.code ?? '')) result.errors.push(`retention/payment-blocks: ${err.message}`)
  }

  return result
}
