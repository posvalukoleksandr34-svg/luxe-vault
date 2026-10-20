import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import { calculateRefund, CalculationError } from '@/lib/refunds/calculator'
import { evaluateEligibility, type ClaimEligibility } from '@/lib/refunds/eligibility'
import { CLAIM_TYPES, RESOLUTIONS, type Actor, type ClaimType, type Resolution } from '@/lib/refunds/types'
import { audit, eventActor, newCorrelationId } from '@/lib/server/refunds/audit'
import { getCase, type CaseRecord } from '@/lib/server/refunds/cases'
import { recordOrderRecord, registerCustomerPhotos } from '@/lib/server/refunds/evidence'
import { notifyCustomer, notifyStaff } from '@/lib/server/refunds/notify'
import { claimedElsewhere, loadOrderFacts, toCalcOrder, toEligibilityOrder, type RefundOrderFacts } from '@/lib/server/refunds/order-facts'
import { activePolicy } from '@/lib/server/refunds/policy-store'
import { reassess, syncOrderSummary } from '@/lib/server/refunds/workflow'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Filing a case — by the customer from their account, or by staff on a
 * customer's behalf (a phone call, an email, a guest order).
 *
 * Everything is decided from the server's data: the order's own record, the
 * policy in force, the units other cases already hold. The browser says what
 * it wants (which lines, how many, why, what resolution); the server says
 * whether that is allowed and what it is worth. The claim is created under a
 * row lock on the order (create_refund_case), so two submissions cannot both
 * claim the same unit, and a resubmitted form (same submission key) returns
 * the case the first one created.
 */

export type CreateCaseInput = {
  orderId?: string
  orderNumber?: string
  claimType: ClaimType
  lines: { orderItemId: string; qty: number }[]
  resolution: Resolution
  description: string
  photos: string[]
  submissionKey?: string
  actor: Actor
}

export type CreateCaseResult =
  | { ok: true; case: CaseRecord; created: boolean; manualReview: string[] }
  | { ok: false; status: number; code: string; message: string }

const fail = (status: number, code: string, message: string): CreateCaseResult => ({ ok: false, status, code, message })

function caseNumber(): string {
  // 8 characters from a 32-letter alphabet without look-alikes: ~10^12.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(8)
  return `RC-${Array.from(bytes, (b) => alphabet[b % 32]).join('')}`
}

const PHOTO_PATH = /^returns\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

export async function createCase(input: CreateCaseInput): Promise<CreateCaseResult> {
  if (!(CLAIM_TYPES as readonly string[]).includes(input.claimType)) return fail(400, 'invalid_claim', 'Unknown claim type')
  if (!(RESOLUTIONS as readonly string[]).includes(input.resolution)) return fail(400, 'invalid_resolution', 'Unknown resolution')

  const order = await loadOrderFacts({ id: input.orderId, number: input.orderNumber })
  if (!order) return fail(404, 'order_not_found', 'Order not found')
  // The customer's own order only. Staff may file for anyone.
  if (input.actor.type === 'customer' && order.userId !== input.actor.userId) return fail(404, 'order_not_found', 'Order not found')

  const policy = await activePolicy()
  const eligibility = evaluateEligibility(toEligibilityOrder(order), policy.config, Date.now())
  const claim: ClaimEligibility = eligibility.claims[input.claimType]
  if (!claim.allowed) return fail(409, `refused_${claim.refused ?? 'unknown'}`, claim.refused ?? 'not_allowed')
  if (!claim.resolutions.includes(input.resolution)) return fail(400, 'resolution_not_offered', 'That resolution is not offered for this kind of request')

  // Lines: in the order, available, positive whole numbers, no line twice.
  const seen = new Set<string>()
  for (const line of input.lines) {
    const allowed = claim.lines.find((l) => l.orderItemId === line.orderItemId)
    if (!allowed) return fail(400, 'line_not_claimable', 'An item cannot be included in this request')
    if (!Number.isInteger(line.qty) || line.qty <= 0 || line.qty > allowed.available) {
      return fail(400, 'invalid_quantity', 'Invalid quantity')
    }
    if (seen.has(line.orderItemId)) return fail(400, 'duplicate_line', 'An item is listed twice')
    seen.add(line.orderItemId)
  }
  if (input.lines.length === 0) return fail(400, 'no_items', 'Choose at least one item')

  // Photographs: the customer's own uploads only; enough of them for the claim.
  if (input.photos.some((p) => !PHOTO_PATH.test(p))) return fail(400, 'invalid_photo', 'Invalid photo')
  if (input.actor.type === 'customer') {
    const own = `returns/${input.actor.userId}/`
    if (input.photos.some((p) => !p.startsWith(own))) return fail(400, 'invalid_photo', 'Invalid photo')
    if (input.photos.length < claim.minPhotos) return fail(400, 'photos_required', `Please add at least ${claim.minPhotos} photo(s)`)
  }
  const description = input.description.trim().slice(0, 2000)
  if (input.actor.type === 'customer' && ['damaged', 'defective', 'wrong_item', 'missing_item', 'not_as_described', 'other'].includes(input.claimType) && description.length < 10) {
    return fail(400, 'description_required', 'Please describe the problem (at least 10 characters)')
  }

  // What the claim is worth, from the order as charged.
  let requestedMinor: number
  try {
    requestedMinor = calculateRefund({
      order: toCalcOrder(order),
      claimType: input.claimType,
      selection: input.lines,
      policy: policy.config,
      claimedElsewhere: claimedElsewhere(order),
      shippingAlreadyRefunded: order.shippingAlreadyRefunded,
      committedMinor: order.committedMinor,
    }).totalMinor
  } catch (e) {
    if (e instanceof CalculationError) return fail(400, e.code, e.code)
    throw e
  }

  const correlationId = newCorrelationId()
  const submissionKey = input.submissionKey
    ? createHash('sha256').update(`${input.actor.type}:${'userId' in input.actor ? input.actor.userId : ''}:${input.submissionKey}`).digest('hex')
    : null

  let caseId: string | null = null
  for (let attempt = 0; attempt < 3 && !caseId; attempt++) {
    const { data, error } = await createAdminClient().rpc('create_refund_case', {
      p_case: {
        order_id: order.id,
        user_id: order.userId ?? null,
        comment: description,
        images: input.photos,
        case_number: caseNumber(),
        claim_type: input.claimType,
        state: 'requested',
        requested_resolution: input.resolution,
        currency: 'CHF',
        requested_amount_minor: requestedMinor,
        source: input.actor.type === 'staff' ? 'staff' : 'customer',
        created_by_staff: input.actor.type === 'staff' ? input.actor.staffId : null,
        submission_key: submissionKey,
        policy_version: policy.version,
        policy_snapshot: policy.config.claims[input.claimType],
        eligibility: {
          manualReview: claim.manualReview,
          deadline: claim.deadline ?? null,
          waitUntil: claim.waitUntil ?? null,
          requireReturn: claim.requireReturn,
        },
        investigation_status: input.claimType === 'non_delivery' ? (claim.waitUntil ? 'waiting_delivery_window' : 'open') : 'none',
        wait_until: claim.waitUntil ? new Date(claim.waitUntil).toISOString() : null,
      },
      p_items: input.lines.map((l) => ({ order_item_id: l.orderItemId, qty: l.qty })),
      p_event: { ...eventActor(input.actor), reason: null, data: { claimType: input.claimType, requestedMinor }, correlation_id: correlationId },
    })
    if (error) {
      if (error.code === '23505' && error.message.includes('case_number')) continue
      if (error.message.includes('QTY_EXCEEDS_AVAILABLE')) return fail(409, 'already_claimed', 'Some of these items are already part of another request')
      if (error.message.includes('ITEM_NOT_IN_ORDER')) return fail(400, 'line_not_claimable', 'An item is not part of this order')
      throw new Error(`Failed to create the case: ${error.message}`)
    }
    caseId = data as string
  }
  if (!caseId) throw new Error('Could not allocate a case number')

  const c = await getCase(caseId)
  if (!c) throw new Error(`Case ${caseId} vanished after creation`)
  // A resubmitted form gets the case the first submission made, untouched:
  // only the request whose correlation id is on the creation event goes on.
  if (!(await createdBy(c.id, correlationId))) {
    return { ok: true, case: c, created: false, manualReview: claim.manualReview }
  }

  await afterCreate(c, order, input, correlationId)
  const fresh = (await getCase(c.id)) ?? c
  return { ok: true, case: fresh, created: true, manualReview: claim.manualReview }
}

async function createdBy(caseId: string, correlationId: string): Promise<boolean> {
  const { count, error } = await createAdminClient()
    .from('refund_case_events')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .eq('action', 'case.created')
    .eq('correlation_id', correlationId)
  if (error) throw new Error(`Failed to read the case's creation: ${error.message}`)
  return (count ?? 0) > 0
}

/** Evidence, risk, notifications and the order's summary. None of it may undo the filing. */
async function afterCreate(c: CaseRecord, order: RefundOrderFacts, input: CreateCaseInput, correlationId: string): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    [
      'photos',
      async () => {
        if (input.photos.length > 0) await registerCustomerPhotos(c.id, input.photos, input.actor)
      },
    ],
    [
      'order record',
      () =>
        recordOrderRecord(c.id, {
          status: order.status,
          trackingNumber: order.trackingNumber ?? null,
          courier: order.courierName ?? null,
          shippedAt: order.shippedAt ?? null,
          deliveredAt: order.deliveredAt ?? null,
          expectedDeliveryBy: order.expectedDeliveryBy ?? null,
          note: 'From the shop’s own order record. Not carrier data.',
        }),
    ],
    ['summary', () => syncOrderSummary(c.orderId)],
  ]
  for (const [what, step] of steps) {
    try {
      await step()
    } catch (e) {
      console.error(`[refunds] ${c.caseNumber}: ${what} failed after filing:`, (e as Error).message)
      await audit({ actor: { type: 'system', label: 'system' }, action: 'case.post_create_failed', caseId: c.id, reason: `${what}: ${(e as Error).message}`, correlationId }).catch(() => {})
    }
  }
  let assessed: CaseRecord | null = c
  try {
    assessed = await reassess(c, 'risk engine (on filing)')
  } catch (e) {
    console.error(`[refunds] ${c.caseNumber}: risk assessment failed:`, (e as Error).message)
  }
  const current = assessed ?? c
  await notifyCustomer(current, 'created', 0)
  await notifyStaff(current, 'created', 0, input.description.slice(0, 300))
}
