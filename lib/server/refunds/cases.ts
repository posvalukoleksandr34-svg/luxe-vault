import 'server-only'

import type { CaseState, ClaimType, InspectionOutcome, InvestigationStatus, Resolution, RiskLevel } from '@/lib/refunds/types'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Reading refund cases (public.return_requests and its satellites).
 *
 * Two audiences, two shapes. Staff read everything below. A CUSTOMER never
 * receives a CaseRecord: lib/server/refunds/customer-view.ts projects one into
 * what they may see — no risk level or score, no internal notes, no staff
 * names, no assignee, no findings.
 */

export type PendingApproval = {
  by: string | null
  byLabel: string
  at: number
  resolution: Resolution
  amountMinor: number
  lines: { itemId: string; qty: number }[]
  approval: ApprovalBreakdown
  note?: string
  justification?: string
}

export type ApprovalBreakdown = {
  itemsMinor: number
  shippingMinor: number
  returnPostageMinor: number
  deductionMinor: number
  deductionReason?: string
  computedMinor: number
  includesShipping: boolean
  warnings: string[]
  policyOverride?: string
}

export type CaseRecord = {
  id: string
  caseNumber: string
  orderId: string
  orderNumber: string
  userId?: string
  claimType: ClaimType
  state: CaseState
  stateChangedAt: number
  requestedResolution: Resolution
  approvedResolution?: Resolution
  currency: string
  requestedAmountMinor?: number
  approvedAmountMinor?: number
  refundedAmountMinor: number
  assignedTo?: string
  assignedLabel?: string
  escalatedAt?: number
  escalationReason?: string
  customerDeadlineAt?: number
  waitUntil?: number
  investigationStatus: InvestigationStatus
  carrierClaimRef?: string
  policyVersion?: number
  eligibility?: Record<string, unknown>
  decisionNote?: string
  pendingApproval?: PendingApproval
  approval?: ApprovalBreakdown
  appealCount: number
  source: 'customer' | 'staff'
  createdByStaff?: string
  version: number
  closedAt?: number
  returnTrackingNumber?: string
  returnCarrier?: string
  returnShippedAt?: number
  returnReceivedAt?: number
  disputeRef?: string
  resolutionRef?: string
  riskLevel?: RiskLevel
  riskScore?: number
  finding?: 'legitimate' | 'not_substantiated' | 'abuse_confirmed'
  findingNote?: string
  comment: string
  images: string[]
  createdAt: number
  updatedAt: number
  decidedAt?: number
  evidencePurgedAt?: number
  /** From the joined order: who the customer is, for staff screens. */
  customerName?: string
  customerEmail?: string
}

export type CaseItem = {
  id: string
  orderItemId: string
  productSlug: string
  name: string
  image?: string
  size: string
  color: string
  orderedQty: number
  qtyRequested: number
  qtyApproved?: number
  qtyReceived: number
  unitPriceMinor: number
  inspectionOutcome?: InspectionOutcome
  inspectionNote?: string
  inspectedAt?: number
  restockedQty: number
  restockedAt?: number
}

const ms = (v: unknown): number | undefined => (typeof v === 'string' && v ? Date.parse(v) : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

export const CASE_SELECT =
  '*, orders!inner(order_number, customer_name, customer_email), assignee:admin_staff!return_requests_assigned_to_fkey(display_name)'

function one<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined)
}

export function toCase(row: Record<string, unknown>): CaseRecord {
  const order = one(row.orders as { order_number: string; customer_name?: string; customer_email?: string } | null)
  const assignee = one(row.assignee as { display_name: string } | null)
  return {
    id: row.id as string,
    caseNumber: row.case_number as string,
    orderId: row.order_id as string,
    orderNumber: order?.order_number ?? '',
    userId: str(row.user_id),
    claimType: row.claim_type as ClaimType,
    state: row.state as CaseState,
    stateChangedAt: Date.parse(row.state_changed_at as string),
    requestedResolution: row.requested_resolution as Resolution,
    approvedResolution: str(row.approved_resolution) as Resolution | undefined,
    currency: row.currency as string,
    requestedAmountMinor: row.requested_amount_minor === null ? undefined : Number(row.requested_amount_minor),
    approvedAmountMinor: row.approved_amount_minor === null ? undefined : Number(row.approved_amount_minor),
    refundedAmountMinor: Number(row.refunded_amount_minor) || 0,
    assignedTo: str(row.assigned_to),
    assignedLabel: assignee?.display_name,
    escalatedAt: ms(row.escalated_at),
    escalationReason: str(row.escalation_reason),
    customerDeadlineAt: ms(row.customer_deadline_at),
    waitUntil: ms(row.wait_until),
    investigationStatus: (row.investigation_status as InvestigationStatus) ?? 'none',
    carrierClaimRef: str(row.carrier_claim_ref),
    policyVersion: row.policy_version === null ? undefined : Number(row.policy_version),
    eligibility: (row.eligibility as Record<string, unknown> | null) ?? undefined,
    decisionNote: str(row.decision_note),
    pendingApproval: (row.pending_approval as PendingApproval | null) ?? undefined,
    approval: (row.approval as ApprovalBreakdown | null) ?? undefined,
    appealCount: Number(row.appeal_count) || 0,
    source: row.source as 'customer' | 'staff',
    createdByStaff: str(row.created_by_staff),
    version: Number(row.version),
    closedAt: ms(row.closed_at),
    returnTrackingNumber: str(row.return_tracking_number),
    returnCarrier: str(row.return_carrier),
    returnShippedAt: ms(row.return_shipped_at),
    returnReceivedAt: ms(row.return_received_at),
    disputeRef: str(row.dispute_ref),
    resolutionRef: str(row.resolution_ref),
    riskLevel: str(row.risk_level) as RiskLevel | undefined,
    riskScore: row.risk_score === null || row.risk_score === undefined ? undefined : Number(row.risk_score),
    finding: str(row.finding) as CaseRecord['finding'],
    findingNote: str(row.finding_note),
    comment: (row.comment as string) ?? '',
    images: Array.isArray(row.images) ? (row.images as string[]) : [],
    createdAt: Date.parse(row.created_at as string),
    updatedAt: Date.parse(row.updated_at as string),
    decidedAt: ms(row.decided_at),
    evidencePurgedAt: ms(row.evidence_purged_at),
    customerName: order?.customer_name,
    customerEmail: order?.customer_email ?? undefined,
  }
}

export async function getCase(id: string): Promise<CaseRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data, error } = await createAdminClient().from('return_requests').select(CASE_SELECT).eq('id', id).maybeSingle()
  if (error) throw new Error(`Failed to read case ${id}: ${error.message}`)
  return data ? toCase(data as Record<string, unknown>) : null
}

export async function getCaseByNumber(caseNumber: string): Promise<CaseRecord | null> {
  if (!/^RC-[A-Z0-9]{6,12}$/.test(caseNumber)) return null
  const { data, error } = await createAdminClient()
    .from('return_requests')
    .select(CASE_SELECT)
    .eq('case_number', caseNumber)
    .maybeSingle()
  if (error) throw new Error(`Failed to read case ${caseNumber}: ${error.message}`)
  return data ? toCase(data as Record<string, unknown>) : null
}

export async function getCaseItems(caseId: string): Promise<CaseItem[]> {
  const { data, error } = await createAdminClient()
    .from('return_request_items')
    .select('*, order_items!inner(product_id, name, image, size, color, qty)')
    .eq('case_id', caseId)
    .order('id')
  if (error) throw new Error(`Failed to read case lines: ${error.message}`)
  return (data ?? []).map((r) => {
    const oi = one(r.order_items as { product_id: string; name: string; image?: string; size: string; color: string; qty: number })!
    return {
      id: r.id as string,
      orderItemId: r.order_item_id as string,
      productSlug: oi.product_id,
      name: oi.name,
      image: oi.image ?? undefined,
      size: oi.size,
      color: oi.color,
      orderedQty: Number(oi.qty),
      qtyRequested: Number(r.qty_requested),
      qtyApproved: r.qty_approved === null ? undefined : Number(r.qty_approved),
      qtyReceived: Number(r.qty_received) || 0,
      unitPriceMinor: Number(r.unit_price_minor),
      inspectionOutcome: (r.inspection_outcome as InspectionOutcome | null) ?? undefined,
      inspectionNote: (r.inspection_note as string | null) ?? undefined,
      inspectedAt: ms(r.inspected_at),
      restockedQty: Number(r.restocked_qty) || 0,
      restockedAt: ms(r.restocked_at),
    }
  })
}

export async function casesForOrder(orderId: string): Promise<CaseRecord[]> {
  const { data, error } = await createAdminClient()
    .from('return_requests')
    .select(CASE_SELECT)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Failed to read cases for the order: ${error.message}`)
  return (data ?? []).map((r) => toCase(r as Record<string, unknown>))
}

// ------------------------------------------------------------- satellites

export type CaseMessage = {
  id: string
  authorType: 'customer' | 'staff' | 'system'
  authorLabel: string
  visibility: 'customer' | 'internal'
  body: string
  attachments: string[]
  createdAt: number
}

export async function caseMessages(caseId: string, visibility?: 'customer'): Promise<CaseMessage[]> {
  let q = createAdminClient()
    .from('refund_case_messages')
    .select('id, author_type, author_label, visibility, body, attachments, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true })
    .limit(500)
  if (visibility) q = q.eq('visibility', visibility)
  const { data, error } = await q
  if (error) throw new Error(`Failed to read case messages: ${error.message}`)
  return (data ?? []).map((m) => ({
    id: m.id as string,
    authorType: m.author_type as CaseMessage['authorType'],
    authorLabel: m.author_label as string,
    visibility: m.visibility as CaseMessage['visibility'],
    body: m.body as string,
    attachments: (m.attachments as string[]) ?? [],
    createdAt: Date.parse(m.created_at as string),
  }))
}

export type CaseEvent = {
  id: number
  actorType: string
  actorLabel: string
  action: string
  fromState?: string
  toState?: string
  reason?: string
  data: Record<string, unknown>
  correlationId?: string
  providerRef?: string
  createdAt: number
}

export async function caseEvents(caseId: string, limit = 500): Promise<CaseEvent[]> {
  const { data, error } = await createAdminClient()
    .from('refund_case_events')
    .select('id, actor_type, actor_label, action, from_state, to_state, reason, data, correlation_id, provider_ref, created_at')
    .eq('case_id', caseId)
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`Failed to read the case history: ${error.message}`)
  return (data ?? []).map((e) => ({
    id: Number(e.id),
    actorType: e.actor_type as string,
    actorLabel: e.actor_label as string,
    action: e.action as string,
    fromState: str(e.from_state),
    toState: str(e.to_state),
    reason: str(e.reason),
    data: (e.data as Record<string, unknown>) ?? {},
    correlationId: str(e.correlation_id),
    providerRef: str(e.provider_ref),
    createdAt: Date.parse(e.created_at as string),
  }))
}

export type RiskRecord = {
  id: string
  score: number
  level: RiskLevel
  rules: { rule: string; weight: number; facts: Record<string, unknown>; basis: string }[]
  engineVersion: string
  policyVersion: number
  evaluatedAt: number
  evaluatedBy: string
  heldAtMedium?: boolean
}

export async function caseRisk(caseId: string, limit = 10): Promise<RiskRecord[]> {
  const { data, error } = await createAdminClient()
    .from('refund_risk_assessments')
    .select('id, score, level, rules, facts, engine_version, policy_version, evaluated_at, evaluated_by_label')
    .eq('case_id', caseId)
    .order('evaluated_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Failed to read risk assessments: ${error.message}`)
  return (data ?? []).map((r) => ({
    id: r.id as string,
    score: Number(r.score),
    level: r.level as RiskLevel,
    rules: (r.rules as RiskRecord['rules']) ?? [],
    engineVersion: r.engine_version as string,
    policyVersion: Number(r.policy_version),
    evaluatedAt: Date.parse(r.evaluated_at as string),
    evaluatedBy: r.evaluated_by_label as string,
    heldAtMedium: Boolean((r.facts as { heldAtMedium?: boolean } | null)?.heldAtMedium),
  }))
}

export type ApprovalRecord = {
  kind: 'approve' | 'second_approval'
  staffId?: string
  staffLabel: string
  amountMinor: number
  resolution: string
  note?: string
  createdAt: number
}

export async function caseApprovals(caseId: string): Promise<ApprovalRecord[]> {
  const { data, error } = await createAdminClient()
    .from('refund_approvals')
    .select('kind, staff_id, staff_label, amount_minor, resolution, note, created_at')
    .eq('case_id', caseId)
    .order('created_at')
  if (error) throw new Error(`Failed to read approvals: ${error.message}`)
  return (data ?? []).map((a) => ({
    kind: a.kind as ApprovalRecord['kind'],
    staffId: str(a.staff_id),
    staffLabel: a.staff_label as string,
    amountMinor: Number(a.amount_minor),
    resolution: a.resolution as string,
    note: str(a.note),
    createdAt: Date.parse(a.created_at as string),
  }))
}
