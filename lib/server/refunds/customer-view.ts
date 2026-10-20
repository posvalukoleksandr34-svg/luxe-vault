import 'server-only'

import { availableCustomerCommands } from '@/lib/refunds/state-machine'
import type { CaseState, ClaimType, InspectionOutcome, Resolution } from '@/lib/refunds/types'
import { caseEvents, caseMessages, getCaseItems, type CaseRecord } from '@/lib/server/refunds/cases'
import { listEvidence } from '@/lib/server/refunds/evidence'
import { activePolicy, policyVersion } from '@/lib/server/refunds/policy-store'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * What a CUSTOMER sees of their own case — a projection, never the row.
 *
 * Left out on purpose: risk level and score, the rules that fired, internal
 * notes, staff names (a staff message is signed by the shop), the assignee,
 * escalation, findings, the ledger's internals. Anything added to CaseRecord
 * later is invisible here until someone decides a customer should see it.
 */

export type CustomerCaseSummary = {
  caseNumber: string
  orderNumber: string
  claimType: ClaimType
  state: CaseState
  requestedResolution: Resolution
  approvedResolution?: Resolution
  requestedAmountMinor?: number
  approvedAmountMinor?: number
  refundedAmountMinor: number
  createdAt: number
  updatedAt: number
}

export type CustomerCaseDetail = CustomerCaseSummary & {
  description: string
  decisionNote?: string
  customerDeadlineAt?: number
  returnInstructions?: string
  returnTrackingNumber?: string
  canAppealUntil?: number
  actions: string[]
  items: {
    name: string
    size: string
    color: string
    image?: string
    qtyRequested: number
    qtyApproved?: number
    qtyReceived: number
    inspectionOutcome?: InspectionOutcome
  }[]
  messages: { from: 'you' | 'shop'; body: string; at: number }[]
  timeline: { state: CaseState; at: number }[]
  refunds: { amountMinor: number; status: 'processing' | 'completed'; at: number }[]
  photos: number
}

export function summarise(c: CaseRecord): CustomerCaseSummary {
  return {
    caseNumber: c.caseNumber,
    orderNumber: c.orderNumber,
    claimType: c.claimType,
    state: c.state,
    requestedResolution: c.requestedResolution,
    approvedResolution: c.approvedResolution,
    requestedAmountMinor: c.requestedAmountMinor,
    approvedAmountMinor: c.approvedAmountMinor,
    refundedAmountMinor: c.refundedAmountMinor,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

export async function customerCases(userId: string): Promise<CustomerCaseSummary[]> {
  const { data, error } = await createAdminClient()
    .from('return_requests')
    .select(
      'case_number, claim_type, state, requested_resolution, approved_resolution, requested_amount_minor, approved_amount_minor, refunded_amount_minor, created_at, updated_at, orders!inner(order_number)',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`Failed to list the customer's cases: ${error.message}`)
  return (data ?? []).map((r) => {
    const order = (Array.isArray(r.orders) ? r.orders[0] : r.orders) as { order_number: string } | undefined
    return {
      caseNumber: r.case_number as string,
      orderNumber: order?.order_number ?? '',
      claimType: r.claim_type as ClaimType,
      state: r.state as CaseState,
      requestedResolution: r.requested_resolution as Resolution,
      approvedResolution: (r.approved_resolution as Resolution | null) ?? undefined,
      requestedAmountMinor: r.requested_amount_minor === null ? undefined : Number(r.requested_amount_minor),
      approvedAmountMinor: r.approved_amount_minor === null ? undefined : Number(r.approved_amount_minor),
      refundedAmountMinor: Number(r.refunded_amount_minor) || 0,
      createdAt: Date.parse(r.created_at as string),
      updatedAt: Date.parse(r.updated_at as string),
    }
  })
}

const DAY = 86_400_000

export async function customerCaseDetail(c: CaseRecord): Promise<CustomerCaseDetail> {
  const [items, messages, events, evidence, ledger, policy] = await Promise.all([
    getCaseItems(c.id),
    caseMessages(c.id, 'customer'),
    caseEvents(c.id),
    listEvidence(c.id, { customerVisibleOnly: true }),
    createAdminClient().from('refund_transactions').select('amount_minor, status, created_at, settled_at').eq('case_id', c.id).order('created_at'),
    c.policyVersion !== undefined ? policyVersion(c.policyVersion) : activePolicy(),
  ])
  if (ledger.error) throw new Error(`Failed to read the case's refunds: ${ledger.error.message}`)

  const timeline: CustomerCaseDetail['timeline'] = []
  for (const e of events) {
    if (e.toState && e.toState !== e.fromState) timeline.push({ state: e.toState as CaseState, at: e.createdAt })
  }

  const actions = availableCustomerCommands(c.state).filter((a) => {
    if (a !== 'appeal') return true
    const decided = c.decidedAt ?? c.stateChangedAt
    return c.appealCount < 1 && Date.now() <= decided + policy.config.windows.appealDays * DAY
  })

  return {
    ...summarise(c),
    description: c.comment,
    decisionNote: c.decisionNote,
    customerDeadlineAt: c.customerDeadlineAt,
    returnInstructions: c.state === 'awaiting_return_shipment' ? policy.config.returnInstructions : undefined,
    returnTrackingNumber: c.returnTrackingNumber,
    canAppealUntil: c.state === 'rejected' && c.appealCount < 1 ? (c.decidedAt ?? c.stateChangedAt) + policy.config.windows.appealDays * DAY : undefined,
    actions,
    items: items.map((i) => ({
      name: i.name,
      size: i.size,
      color: i.color,
      image: i.image,
      qtyRequested: i.qtyRequested,
      qtyApproved: i.qtyApproved,
      qtyReceived: i.qtyReceived,
      inspectionOutcome: i.inspectionOutcome,
    })),
    messages: messages.map((m) => ({ from: m.authorType === 'customer' ? 'you' : 'shop', body: m.body, at: m.createdAt })),
    timeline,
    // A failed or cancelled ATTEMPT is the shop's to retry, not an outcome:
    // the case shows as approved again until the money actually moves.
    refunds: (ledger.data ?? [])
      .filter((t) => t.status !== 'canceled' && t.status !== 'failed')
      .map((t) => ({
        amountMinor: Number(t.amount_minor),
        status: t.status === 'succeeded' ? ('completed' as const) : ('processing' as const),
        at: Date.parse((t.settled_at ?? t.created_at) as string),
      })),
    photos: evidence.filter((e) => e.kind === 'customer_photo' && !e.purgedAt).length,
  }
}
