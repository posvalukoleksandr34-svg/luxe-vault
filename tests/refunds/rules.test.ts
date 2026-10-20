import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { adviseNonDelivery, trackingConflicts, type TrackingSnapshot } from '@/lib/refunds/delivery'
import { evaluateEligibility, type EligibilityOrder } from '@/lib/refunds/eligibility'
import { ROLE_PERMISSIONS, can } from '@/lib/refunds/permissions'
import { DEFAULT_POLICY, parsePolicyConfig, policyConfigSchema } from '@/lib/refunds/policy'
import { MIN_RULES_FOR_HIGH, assessRisk, type HistoryCase, type RiskFacts } from '@/lib/refunds/risk'
import { COMMANDS, availableCustomerCommands, checkTransition } from '@/lib/refunds/state-machine'
import { CASE_STATES, TERMINAL_STATES, type CaseState } from '@/lib/refunds/types'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 19, 12)

// ------------------------------------------------------------------ policy --
describe('refund policy', () => {
  it('the defaults are valid and match the published policy', () => {
    assert.doesNotThrow(() => policyConfigSchema.parse(DEFAULT_POLICY))
    assert.equal(DEFAULT_POLICY.windows.withdrawalDays, 14)
    assert.equal(DEFAULT_POLICY.windows.returnShipmentDays, 14)
    assert.equal(DEFAULT_POLICY.claims.changed_mind.requireReturn, true)
    assert.deepEqual([...DEFAULT_POLICY.claims.defective.allowedResolutions].sort(), ['refund', 'replacement', 'return_and_refund'])
  })

  it('a stored version missing newer fields reads with their defaults', () => {
    const parsed = parsePolicyConfig({ windows: { withdrawalDays: 30 } })
    assert.equal(parsed.windows.withdrawalDays, 30)
    assert.equal(parsed.windows.faultReportDays, 14)
    assert.equal(parsed.risk.rules.high_value.weight, DEFAULT_POLICY.risk.rules.high_value.weight)
  })

  it('refuses incoherent thresholds and missing rules', () => {
    assert.throws(() => parsePolicyConfig({ risk: { mediumThreshold: 60, highThreshold: 30 } }))
    assert.throws(() => parsePolicyConfig({ windows: { withdrawalDays: -1 } }))
    assert.throws(() => parsePolicyConfig({ claims: { changed_mind: { allowedResolutions: [] } } }))
  })
})

// --------------------------------------------------------------- eligibility --
const baseOrder = (over: Partial<EligibilityOrder> = {}): EligibilityOrder => ({
  paymentStatus: 'paid',
  status: 'delivered',
  createdAt: NOW - 30 * DAY,
  shippedAt: NOW - 10 * DAY,
  deliveredAt: NOW - 5 * DAY,
  trackingNumber: '99.00.123456.78901234',
  totalMinor: 30000,
  committedRefundMinor: 0,
  lines: [{ orderItemId: 'a', productSlug: 'coat', name: 'Coat', qty: 1, claimedQty: 0 }],
  ...over,
})

describe('eligibility', () => {
  it('an unpaid, cancelled or fully refunded order cannot be claimed', () => {
    assert.equal(evaluateEligibility(baseOrder({ paymentStatus: 'pending_payment' }), DEFAULT_POLICY, NOW).refused, 'not_paid')
    assert.equal(evaluateEligibility(baseOrder({ status: 'cancelled' }), DEFAULT_POLICY, NOW).refused, 'cancelled')
    assert.equal(evaluateEligibility(baseOrder({ paymentStatus: 'refunded' }), DEFAULT_POLICY, NOW).refused, 'fully_refunded')
    assert.equal(evaluateEligibility(baseOrder({ committedRefundMinor: 30000 }), DEFAULT_POLICY, NOW).refused, 'fully_refunded')
  })

  it('withdrawal is open for 14 days after delivery and then closes', () => {
    assert.equal(evaluateEligibility(baseOrder(), DEFAULT_POLICY, NOW).claims.changed_mind.allowed, true)
    const late = evaluateEligibility(baseOrder({ deliveredAt: NOW - 15 * DAY }), DEFAULT_POLICY, NOW)
    assert.equal(late.claims.changed_mind.allowed, false)
    assert.equal(late.claims.changed_mind.refused, 'withdrawal_window_closed')
  })

  it('a late fault claim is never refused on the date alone — it goes to manual review', () => {
    const r = evaluateEligibility(baseOrder({ deliveredAt: NOW - 200 * DAY }), DEFAULT_POLICY, NOW)
    assert.equal(r.claims.defective.allowed, true)
    assert.ok(r.claims.defective.manualReview.includes('outside_fault_window'))
  })

  it('a non-delivery claim inside the delivery window waits; one on a "delivered" order goes to review', () => {
    const inTransit = evaluateEligibility(
      baseOrder({ status: 'shipped', deliveredAt: undefined, shippedAt: NOW - 2 * DAY, expectedDeliveryBy: NOW + 3 * DAY }),
      DEFAULT_POLICY,
      NOW,
    )
    assert.equal(inTransit.claims.non_delivery.allowed, true)
    assert.ok((inTransit.claims.non_delivery.waitUntil ?? 0) > NOW)
    const marked = evaluateEligibility(baseOrder(), DEFAULT_POLICY, NOW)
    assert.equal(marked.claims.non_delivery.allowed, true)
    assert.ok(marked.claims.non_delivery.manualReview.includes('marked_delivered'))
  })

  it('cancellation before dispatch only before dispatch; returns only after', () => {
    const notShipped = baseOrder({ status: 'processing', shippedAt: undefined, deliveredAt: undefined })
    const r = evaluateEligibility(notShipped, DEFAULT_POLICY, NOW)
    assert.equal(r.claims.cancel_before_dispatch.allowed, true)
    assert.equal(r.claims.changed_mind.refused, 'not_dispatched')
    assert.equal(evaluateEligibility(baseOrder(), DEFAULT_POLICY, NOW).claims.cancel_before_dispatch.refused, 'already_dispatched')
  })

  it('a non-returnable product cannot be withdrawn from, but can still be claimed faulty', () => {
    const policy = parsePolicyConfig({ restrictions: { nonReturnableProductSlugs: ['coat'] } })
    const r = evaluateEligibility(baseOrder(), policy, NOW)
    assert.equal(r.claims.changed_mind.refused, 'no_returnable_items')
    assert.equal(r.claims.defective.allowed, true)
  })

  it('units already claimed elsewhere are not offered again', () => {
    const r = evaluateEligibility(
      baseOrder({ lines: [{ orderItemId: 'a', productSlug: 'coat', name: 'Coat', qty: 2, claimedQty: 2 }] }),
      DEFAULT_POLICY,
      NOW,
    )
    assert.equal(r.eligible, false)
    assert.equal(r.refused, 'nothing_left_to_claim')
  })
})

// ------------------------------------------------------------ state machine --
describe('state machine', () => {
  const staffWith = (role: keyof typeof ROLE_PERMISSIONS) => (p: Parameters<typeof can>[1]) => can(role, p)

  it('customers cannot approve, refund, reject or move a case anywhere but their own commands allow', () => {
    for (const command of ['approve', 'second_approve', 'initiate_refund', 'record_manual_refund', 'reject', 'settle', 'mark_resolved', 'start_review']) {
      for (const state of CASE_STATES) {
        assert.equal(checkTransition({ command, state, actor: 'customer' }).ok, false, `${command} from ${state}`)
      }
    }
  })

  it('an agent handles cases but cannot decide them or move money', () => {
    const agent = staffWith('agent')
    assert.equal(checkTransition({ command: 'start_review', state: 'requested', actor: 'staff', hasPermission: agent }).ok, true)
    for (const command of ['approve', 'reject', 'initiate_refund', 'authorize_return', 'record_manual_refund']) {
      const r = checkTransition({ command, state: 'under_review', actor: 'staff', hasPermission: agent, reason: 'because' })
      assert.equal(r.ok ? 'ok' : r.reason, command === 'initiate_refund' || command === 'record_manual_refund' ? 'forbidden' : 'forbidden')
    }
    const viewer = staffWith('viewer')
    assert.equal(checkTransition({ command: 'add_note', state: 'requested', actor: 'staff', hasPermission: viewer }).ok, false)
  })

  it('invalid transitions are refused whatever the role', () => {
    const owner = staffWith('owner')
    assert.deepEqual(checkTransition({ command: 'initiate_refund', state: 'under_review', actor: 'staff', hasPermission: owner }), { ok: false, reason: 'wrong_state' })
    assert.deepEqual(checkTransition({ command: 'approve', state: 'refunded', actor: 'staff', hasPermission: owner }), { ok: false, reason: 'wrong_state' })
    assert.deepEqual(checkTransition({ command: 'set_state', state: 'requested', actor: 'staff', hasPermission: owner }), { ok: false, reason: 'unknown_command' })
    assert.deepEqual(checkTransition({ command: 'expire', state: 'awaiting_customer_info', actor: 'staff', hasPermission: owner }), { ok: false, reason: 'wrong_actor' })
  })

  it('a rejection, a cancellation and an information request need a reason', () => {
    const owner = staffWith('owner')
    for (const command of ['reject', 'cancel', 'request_info']) {
      assert.deepEqual(checkTransition({ command, state: 'under_review', actor: 'staff', hasPermission: owner, reason: '' }), { ok: false, reason: 'reason_required' })
    }
  })

  it('a closed case offers the customer nothing except an appeal of a rejection', () => {
    for (const state of TERMINAL_STATES) {
      const offered = availableCustomerCommands(state as CaseState)
      assert.deepEqual(offered, state === 'rejected' ? ['appeal'] : [], state)
    }
  })

  it('every command leads somewhere valid', () => {
    for (const [name, entry] of Object.entries(COMMANDS)) {
      assert.ok(entry.from.length > 0, name)
      for (const s of entry.from) assert.ok(CASE_STATES.includes(s), `${name}: ${s}`)
      if (typeof entry.to === 'string' && entry.to !== 'computed') assert.ok(CASE_STATES.includes(entry.to as CaseState), name)
    }
  })
})

// --------------------------------------------------------------------- risk --
const facts = (over: Partial<RiskFacts> = {}): RiskFacts => ({
  now: NOW,
  claimType: 'non_delivery',
  orderId: 'o1',
  claimMinor: 30000,
  orderItemIds: ['a'],
  history: [],
  priorRefundedUnitsSameItems: 0,
  contradictions: [],
  duplicateReturnTracking: false,
  duplicateEvidence: 0,
  fulfilmentRecordsMissing: false,
  ...over,
})
const past = (over: Partial<HistoryCase>): HistoryCase => ({
  id: Math.random().toString(36),
  orderId: 'o-old',
  claimType: 'non_delivery',
  state: 'refunded',
  createdAt: NOW - 40 * DAY,
  amountMinor: 20000,
  ...over,
})

describe('risk assessment', () => {
  it('a first claim with no history is low risk', () => {
    const r = assessRisk(facts(), DEFAULT_POLICY)
    assert.equal(r.level, 'low')
    assert.equal(r.score, 0)
    assert.deepEqual(r.hits, [])
  })

  it('no single signal makes a case high risk, however it is weighted', () => {
    const heavy = parsePolicyConfig({ risk: { rules: { duplicate_return_tracking: { enabled: true, weight: 100 } } } })
    const r = assessRisk(facts({ duplicateReturnTracking: true }), heavy)
    assert.equal(r.score, 100)
    assert.equal(r.level, 'medium')
    assert.equal(r.heldAtMedium, true)
    assert.ok(MIN_RULES_FOR_HIGH >= 2)
  })

  it('a high-value purchase, a delivered status or one request alone are not suspicious', () => {
    assert.equal(assessRisk(facts({ claimMinor: 500_000 }), DEFAULT_POLICY).level, 'low')
    assert.equal(assessRisk(facts({ claimType: 'changed_mind' }), DEFAULT_POLICY).level, 'low')
  })

  it('a pattern across signals is high, and every point is explained', () => {
    const r = assessRisk(
      facts({
        history: [
          past({ orderId: 'o2', deliveryConfirmed: true }),
          past({ orderId: 'o3', createdAt: NOW - 10 * DAY, finding: 'abuse_confirmed' }),
        ],
        duplicateEvidence: 1,
      }),
      DEFAULT_POLICY,
    )
    assert.equal(r.level, 'high')
    assert.equal(r.score, Math.min(100, r.hits.reduce((a, h) => a + h.weight, 0)))
    for (const hit of r.hits) assert.ok(Object.keys(hit.facts).length > 0, hit.rule)
    assert.ok(r.hits.some((h) => h.rule === 'repeat_non_delivery'))
  })

  it('an allegation that was never substantiated does not count as a finding', () => {
    const r = assessRisk(facts({ claimType: 'changed_mind', history: [past({ finding: 'not_substantiated', claimType: 'changed_mind' })] }), DEFAULT_POLICY)
    assert.ok(!r.hits.some((h) => h.rule === 'prior_documented_findings'))
  })

  it('the shop\'s own missing record is flagged as the shop\'s gap', () => {
    const r = assessRisk(facts({ fulfilmentRecordsMissing: true }), DEFAULT_POLICY)
    assert.equal(r.hits[0].basis, 'shop_records')
    assert.equal(r.level, 'low')
  })

  it('history outside the lookback window is ignored, and disabled rules never fire', () => {
    assert.equal(assessRisk(facts({ history: [past({ createdAt: NOW - 400 * DAY })] }), DEFAULT_POLICY).score, 0)
    const off = parsePolicyConfig({ risk: { rules: { duplicate_evidence: { enabled: false, weight: 30 } } } })
    assert.equal(assessRisk(facts({ duplicateEvidence: 3 }), off).score, 0)
  })

  it('is deterministic', () => {
    const f = facts({ history: [past({})], duplicateEvidence: 1 })
    assert.deepEqual(assessRisk(f, DEFAULT_POLICY), assessRisk(f, DEFAULT_POLICY))
  })
})

// ------------------------------------------------------------------ delivery --
const snap = (over: Partial<TrackingSnapshot>): TrackingSnapshot => ({
  status: 'in_transit',
  events: [],
  source: 'staff',
  retrievedAt: NOW,
  ...over,
})

describe('non-delivery advice', () => {
  it('a delayed shipment still inside its window waits', () => {
    const a = adviseNonDelivery({ now: NOW, waitUntil: NOW + DAY, latest: snap({ status: 'in_transit' }), investigation: 'open', hasTrackingNumber: true })
    assert.equal(a.advice, 'wait_for_delivery_window')
  })

  it('"delivered" but disputed is met with a check, not a rejection', () => {
    const a = adviseNonDelivery({ now: NOW, latest: snap({ status: 'delivered', deliveredAt: NOW - DAY }), investigation: 'open', hasTrackingNumber: true })
    assert.equal(a.advice, 'ask_customer_to_check')
  })

  it('a parcel the carrier confirms lost, or sent back, is resolved in the customer\'s favour', () => {
    assert.equal(adviseNonDelivery({ now: NOW, latest: snap({ status: 'lost' }), investigation: 'open', hasTrackingNumber: true }).advice, 'resolve_in_customer_favour')
    assert.equal(adviseNonDelivery({ now: NOW, latest: snap({ status: 'returned_to_sender' }), investigation: 'open', hasTrackingNumber: true }).advice, 'resolve_in_customer_favour')
    assert.equal(adviseNonDelivery({ now: NOW, investigation: 'lost_confirmed', hasTrackingNumber: true }).advice, 'resolve_in_customer_favour')
  })

  it('no tracking at all is the shop\'s gap: manual review, not a rejection', () => {
    assert.deepEqual(adviseNonDelivery({ now: NOW, investigation: 'open', hasTrackingNumber: false }), { advice: 'manual_review', reasons: ['no_tracking'] })
  })

  it('a label alone is not a shipment', () => {
    assert.equal(adviseNonDelivery({ now: NOW, latest: snap({ status: 'label_created' }), investigation: 'open', hasTrackingNumber: true }).advice, 'open_carrier_investigation')
  })

  it('conflicting events are flagged for a person', () => {
    const conflicting = snap({
      status: 'delivered',
      events: [
        { at: NOW - 3 * DAY, status: 'delivered' },
        { at: NOW - 2 * DAY, status: 'in_transit' },
      ],
    })
    assert.ok(trackingConflicts(conflicting).includes('movement_after_delivery'))
    assert.equal(adviseNonDelivery({ now: NOW, latest: conflicting, investigation: 'open', hasTrackingNumber: true }).advice, 'manual_review')
  })
})
