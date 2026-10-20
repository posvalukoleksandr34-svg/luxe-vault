import 'server-only'

import { randomUUID } from 'node:crypto'

import { actorId, type Actor } from '@/lib/refunds/types'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The refund system's audit trail (public.refund_case_events, append-only —
 * the table refuses UPDATE, DELETE and TRUNCATE even from the service role).
 *
 * Most rows are written INSIDE the database functions that make a change
 * (create_refund_case, refund_case_apply, reserve/settle_refund_transaction),
 * in the same transaction, so a change and its record cannot come apart. This
 * module writes the rest: things that are not a change to a case row —
 * viewing evidence, exporting, staff and policy administration.
 *
 * What goes in `data` is facts about the action, never secrets: no
 * passphrases, no tokens, no full card or bank details.
 */

export function newCorrelationId(): string {
  return randomUUID()
}

export function eventActor(actor: Actor): { actor_type: Actor['type']; actor_id: string | null; actor_label: string } {
  return { actor_type: actor.type, actor_id: actorId(actor), actor_label: actor.label.slice(0, 120) }
}

/**
 * Writes one audit row. Throws on failure: an action whose record could not
 * be written must not be reported as done (the callers that may proceed
 * regardless — reading a page, say — catch and log it themselves).
 */
export async function audit(entry: {
  actor: Actor
  action: string
  caseId?: string | null
  orderId?: string | null
  reason?: string | null
  data?: Record<string, unknown>
  correlationId?: string
  providerRef?: string | null
}): Promise<void> {
  const { error } = await createAdminClient()
    .from('refund_case_events')
    .insert({
      ...eventActor(entry.actor),
      case_id: entry.caseId ?? null,
      order_id: entry.orderId ?? null,
      action: entry.action.slice(0, 80),
      reason: entry.reason?.slice(0, 2000) ?? null,
      data: entry.data ?? {},
      correlation_id: entry.correlationId ?? null,
      provider_ref: entry.providerRef ?? null,
    })
  if (error) throw new Error(`audit ${entry.action} failed: ${error.message}`)
}
