import 'server-only'

import { assessRisk, type HistoryCase, type RiskAssessment, type RiskFacts } from '@/lib/refunds/risk'
import type { PolicyConfig } from '@/lib/refunds/policy'
import type { ClaimType } from '@/lib/refunds/types'
import type { CaseItem, CaseRecord } from '@/lib/server/refunds/cases'
import { duplicateEvidenceCount } from '@/lib/server/refunds/evidence'
import type { RefundOrderFacts } from '@/lib/server/refunds/order-facts'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Gathers the facts lib/refunds/risk.ts scores — and ONLY those: the claim,
 * the order, the shop's fulfilment record, and this customer's history of
 * orders and claims with the shop. Name, address, country, language and every
 * other personal characteristic are deliberately not read here.
 *
 * "This customer" is the account when there is one, else the order's email
 * address (a guest). Two accounts behind one person are not linked — the
 * engine works on what the shop can attribute without profiling anybody.
 */

const DAY = 86_400_000

type CaseRow = {
  id: string
  order_id: string
  claim_type: ClaimType
  state: string
  created_at: string
  requested_amount_minor: number | null
  approved_amount_minor: number | null
  finding: string | null
  investigation_status: string
  return_tracking_number: string | null
}

async function historyFor(c: CaseRecord, order: RefundOrderFacts, lookbackDays: number): Promise<HistoryCase[]> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - lookbackDays * DAY).toISOString()
  const cols =
    'id, order_id, claim_type, state, created_at, requested_amount_minor, approved_amount_minor, finding, investigation_status, return_tracking_number'
  const rows = new Map<string, CaseRow>()

  if (c.userId) {
    const { data, error } = await admin.from('return_requests').select(cols).eq('user_id', c.userId).gte('created_at', since).limit(200)
    if (error) throw new Error(`Failed to read claim history: ${error.message}`)
    for (const r of (data ?? []) as CaseRow[]) rows.set(r.id, r)
  }
  if (order.email) {
    const { data, error } = await admin
      .from('return_requests')
      .select(`${cols}, orders!inner(customer_email)`)
      .eq('orders.customer_email', order.email)
      .gte('created_at', since)
      .limit(200)
    if (error) throw new Error(`Failed to read claim history: ${error.message}`)
    for (const r of (data ?? []) as unknown as CaseRow[]) rows.set(r.id, r)
  }
  rows.delete(c.id)
  return Array.from(rows.values()).map((r) => ({
    id: r.id,
    orderId: r.order_id,
    claimType: r.claim_type,
    state: r.state,
    createdAt: Date.parse(r.created_at),
    amountMinor: Number(r.approved_amount_minor ?? r.requested_amount_minor ?? 0),
    finding: (r.finding as HistoryCase['finding']) ?? undefined,
    deliveryConfirmed: r.investigation_status === 'delivered_confirmed',
    returnTrackingNumber: r.return_tracking_number ?? undefined,
  }))
}

/** Units of the same PRODUCTS refunded to this customer on other orders. */
async function priorRefundedUnits(history: HistoryCase[], items: CaseItem[]): Promise<number> {
  const settled = history.filter((h) => ['refunded', 'partially_refunded'].includes(h.state)).map((h) => h.id)
  if (settled.length === 0 || items.length === 0) return 0
  const slugs = Array.from(new Set(items.map((i) => i.productSlug)))
  const { data, error } = await createAdminClient()
    .from('return_request_items')
    .select('qty_approved, qty_requested, order_items!inner(product_id)')
    .in('case_id', settled)
    .in('order_items.product_id', slugs)
  if (error) throw new Error(`Failed to read prior refunds: ${error.message}`)
  return (data ?? []).reduce((sum, r) => sum + Number(r.qty_approved ?? r.qty_requested ?? 0), 0)
}

async function returnTrackingElsewhere(c: CaseRecord): Promise<boolean> {
  if (!c.returnTrackingNumber) return false
  const { count, error } = await createAdminClient()
    .from('return_requests')
    .select('id', { count: 'exact', head: true })
    .eq('return_tracking_number', c.returnTrackingNumber)
    .neq('id', c.id)
  if (error) throw new Error(`Failed to compare return tracking numbers: ${error.message}`)
  return (count ?? 0) > 0
}

/** Things in the claim the shop's own records contradict. */
export function contradictions(c: CaseRecord, order: RefundOrderFacts, items: CaseItem[]): string[] {
  const out: string[] = []
  const units = order.lines.reduce((a, l) => a + l.qty, 0)
  if (c.claimType === 'missing_item' && units === 1) out.push('missing_item_on_single_unit_order')
  if (c.claimType === 'missing_item' && items.reduce((a, i) => a + i.qtyRequested, 0) >= units) {
    out.push('every_unit_reported_missing')
  }
  if (c.claimType === 'cancel_before_dispatch' && order.shippedAt) out.push('cancellation_after_dispatch')
  return out
}

export async function gatherRiskFacts(
  c: CaseRecord,
  items: CaseItem[],
  order: RefundOrderFacts,
  policy: PolicyConfig,
): Promise<RiskFacts> {
  const history = await historyFor(c, order, policy.risk.lookbackDays)
  const [prior, dupTracking, dupEvidence] = await Promise.all([
    priorRefundedUnits(history, items),
    returnTrackingElsewhere(c),
    duplicateEvidenceCount(c.id),
  ])
  const dispatched = order.status === 'shipped' || order.status === 'delivered' || Boolean(order.shippedAt)
  return {
    now: Date.now(),
    claimType: c.claimType,
    orderId: c.orderId,
    claimMinor: c.approvedAmountMinor ?? c.requestedAmountMinor ?? 0,
    orderItemIds: items.map((i) => i.orderItemId),
    history,
    priorRefundedUnitsSameItems: prior,
    contradictions: contradictions(c, order, items),
    duplicateReturnTracking: dupTracking,
    duplicateEvidence: dupEvidence,
    fulfilmentRecordsMissing: c.claimType === 'non_delivery' && dispatched && (!order.trackingNumber || !order.shippedAt),
    hoursSinceDelivery: order.deliveredAt ? (c.createdAt - order.deliveredAt) / 3_600_000 : undefined,
  }
}

/**
 * Assesses and STORES: the assessment row (rules, facts, engine and policy
 * versions) is what a person later reads to see why a case was flagged.
 */
export async function assessAndStore(
  c: CaseRecord,
  items: CaseItem[],
  order: RefundOrderFacts,
  policy: { version: number; config: PolicyConfig },
  by: string,
): Promise<RiskAssessment> {
  const facts = await gatherRiskFacts(c, items, order, policy.config)
  const result = assessRisk(facts, policy.config)
  // History is stored as counts, not as copies of other customers' cases.
  const storedFacts = {
    claimType: facts.claimType,
    claimMinor: facts.claimMinor,
    historyCases: facts.history.length,
    priorRefundedUnitsSameItems: facts.priorRefundedUnitsSameItems,
    contradictions: facts.contradictions,
    duplicateReturnTracking: facts.duplicateReturnTracking,
    duplicateEvidence: facts.duplicateEvidence,
    fulfilmentRecordsMissing: facts.fulfilmentRecordsMissing,
    hoursSinceDelivery: facts.hoursSinceDelivery === undefined ? null : Math.round(facts.hoursSinceDelivery),
    heldAtMedium: result.heldAtMedium,
  }
  const { error } = await createAdminClient().from('refund_risk_assessments').insert({
    case_id: c.id,
    score: result.score,
    level: result.level,
    rules: result.hits,
    facts: storedFacts,
    engine_version: result.engineVersion,
    policy_version: policy.version,
    evaluated_by_label: by,
  })
  if (error) throw new Error(`Failed to store the risk assessment: ${error.message}`)
  return result
}
