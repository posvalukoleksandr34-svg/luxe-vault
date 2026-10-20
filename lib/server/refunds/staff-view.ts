import 'server-only'

import { adviseNonDelivery, trackingConflicts, type Advice } from '@/lib/refunds/delivery'
import { can } from '@/lib/refunds/permissions'
import { RULE_EXPLANATION_RU } from '@/lib/refunds/risk'
import type { RiskRule } from '@/lib/refunds/policy'
import { availableStaffCommands } from '@/lib/refunds/state-machine'
import type { Actor } from '@/lib/refunds/types'
import { customerHistory } from '@/lib/server/refunds/admin-queries'
import {
  caseApprovals,
  caseEvents,
  caseMessages,
  caseRisk,
  getCaseItems,
  type CaseRecord,
} from '@/lib/server/refunds/cases'
import { latestTrackingSnapshot, listEvidence } from '@/lib/server/refunds/evidence'
import { ledgerForOrder } from '@/lib/server/refunds/ledger'
import { loadOrderFacts } from '@/lib/server/refunds/order-facts'
import { previewApproval } from '@/lib/server/refunds/workflow'

/**
 * Everything a member of staff sees on one case, in one response: the case,
 * its lines, the order as charged, the ledger, evidence (metadata — files
 * are opened one at a time through a logged, signed link), messages and
 * notes, the audit trail, the risk assessment WITH its reasons, approvals,
 * the customer's history (for roles allowed to see it), the commands the
 * role may issue now, and — for a non-delivery claim — the advice engine's
 * recommendation, with its reasons.
 */
export async function staffCaseDetail(c: CaseRecord, actor: Extract<Actor, { type: 'staff' }>) {
  const [items, order, messages, events, risk, approvals, evidence, snapshot] = await Promise.all([
    getCaseItems(c.id),
    loadOrderFacts({ id: c.orderId }),
    caseMessages(c.id),
    caseEvents(c.id),
    caseRisk(c.id, 5),
    caseApprovals(c.id),
    listEvidence(c.id),
    latestTrackingSnapshot(c.id),
  ])
  const ledger = order ? await ledgerForOrder(order.id) : []
  const history = can(actor.role, 'customer.history') ? await customerHistory(c) : null

  let advice: (Advice & { conflicts: string[] }) | null = null
  if (c.claimType === 'non_delivery') {
    const a = adviseNonDelivery({
      now: Date.now(),
      waitUntil: c.waitUntil,
      latest: snapshot,
      investigation: c.investigationStatus,
      hasTrackingNumber: Boolean(order?.trackingNumber),
    })
    advice = { ...a, conflicts: snapshot ? trackingConflicts(snapshot) : [] }
  }

  const preview = ['requested', 'under_review', 'awaiting_inspection'].includes(c.state) && can(actor.role, 'case.decide')
    ? await previewApproval(c.id, {})
    : null

  const latest = risk[0]
  return {
    case: c,
    items,
    order: order && {
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentProvider: order.paymentProvider,
      paymentCurrency: order.paymentCurrency,
      paymentAmount: order.paymentAmount,
      createdAt: order.createdAt,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      expectedDeliveryBy: order.expectedDeliveryBy,
      trackingNumber: order.trackingNumber,
      courierName: order.courierName,
      customerName: order.customerName,
      customerEmail: order.email,
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      shippingMinor: order.shippingMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      refundedMinor: order.refundedMinor,
      committedMinor: order.committedMinor,
      inFlight: order.inFlight,
      lines: order.lines,
    },
    ledger,
    evidence: evidence.map((e) => ({ ...e, path: undefined, bucket: undefined, hasFile: Boolean(e.path) })),
    trackingSnapshot: snapshot ?? null,
    messages,
    events,
    risk: latest
      ? {
          ...latest,
          explanations: latest.rules.map((r) => ({ ...r, text: RULE_EXPLANATION_RU[r.rule as RiskRule] ?? r.rule })),
          history: risk.slice(1).map((r) => ({ score: r.score, level: r.level, evaluatedAt: r.evaluatedAt })),
        }
      : null,
    approvals,
    history,
    commands: availableStaffCommands(c.state, (p) => can(actor.role, p)),
    advice,
    preview: preview && preview.ok ? preview : null,
  }
}
