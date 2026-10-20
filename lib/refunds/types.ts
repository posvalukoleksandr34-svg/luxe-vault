/**
 * The refund system's vocabulary, shared by the server, the admin console and
 * the customer's pages. Mirrors the CHECK constraints of migration 0059 — a
 * value that is not listed here cannot be stored.
 */

/** Where a case is in its life (docs/refunds/README.md has the diagram). */
export const CASE_STATES = [
  'requested',
  'under_review',
  'awaiting_customer_info',
  'awaiting_return_shipment',
  'return_in_transit',
  'return_delivered',
  'awaiting_inspection',
  'approved',
  'refund_processing',
  'partially_refunded',
  'refunded',
  'resolved',
  'rejected',
  'cancelled',
  'expired',
  'disputed',
] as const
export type CaseState = (typeof CASE_STATES)[number]

/** States a case never leaves on its own (some can be reopened by staff). */
export const TERMINAL_STATES: readonly CaseState[] = [
  'partially_refunded',
  'refunded',
  'resolved',
  'rejected',
  'cancelled',
  'expired',
]

export function isTerminal(state: CaseState): boolean {
  return TERMINAL_STATES.includes(state)
}

/** States whose claimed units still count against the order (0059's
 *  create_refund_case uses the complement of rejected/cancelled/expired). */
export function holdsUnits(state: CaseState): boolean {
  return state !== 'rejected' && state !== 'cancelled' && state !== 'expired'
}

/** What the customer says happened. */
export const CLAIM_TYPES = [
  'non_delivery',
  'damaged',
  'defective',
  'wrong_item',
  'missing_item',
  'not_as_described',
  'wrong_size',
  'changed_mind',
  'cancel_before_dispatch',
  'other',
] as const
export type ClaimType = (typeof CLAIM_TYPES)[number]

/** Claims where the shop, not the customer, is at fault: return postage is the
 *  shop's, the original shipping is refunded, and the published 14-day notice
 *  period never ends the customer's statutory rights (Refund Policy §7). */
export const SELLER_FAULT_CLAIMS: readonly ClaimType[] = [
  'damaged',
  'defective',
  'wrong_item',
  'missing_item',
  'not_as_described',
  'non_delivery',
]

/** Withdrawal within the 14-day window (Refund Policy §2). */
export const WITHDRAWAL_CLAIMS: readonly ClaimType[] = ['wrong_size', 'changed_mind']

/** What the customer would like; what the shop decides. Store credit is not
 *  offered: the shop has no store-credit or gift-card balance to put it on. */
export const RESOLUTIONS = ['refund', 'return_and_refund', 'replacement', 'reshipment'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

/** A non-delivery investigation's progress, alongside the case state. */
export const INVESTIGATION_STATUSES = [
  'none',
  'open',
  'waiting_delivery_window',
  'carrier_claim_opened',
  'delivered_confirmed',
  'lost_confirmed',
  'inconclusive',
] as const
export type InvestigationStatus = (typeof INVESTIGATION_STATUSES)[number]

/** What the warehouse found when a returned item was opened. */
export const INSPECTION_OUTCOMES = [
  'accepted',
  'damaged',
  'incorrect_item',
  'missing_components',
  'used_or_altered',
  'not_received',
  'further_inspection',
] as const
export type InspectionOutcome = (typeof INSPECTION_OUTCOMES)[number]

export const RISK_LEVELS = ['low', 'medium', 'high'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

export const STAFF_ROLES = ['owner', 'manager', 'agent', 'viewer'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

/** A refund ledger row's provider state (0059 refund_transactions.status). */
export const TRANSACTION_STATUSES = [
  'pending_submission',
  'submitted',
  'unknown',
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
] as const
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number]

/** Money that may still move or already did: counts against the balance. */
export const COMMITTED_STATUSES: readonly TransactionStatus[] = [
  'pending_submission',
  'submitted',
  'unknown',
  'pending',
  'requires_action',
  'succeeded',
]

/** Still waiting on the provider. */
export const IN_FLIGHT_STATUSES: readonly TransactionStatus[] = [
  'pending_submission',
  'submitted',
  'unknown',
  'pending',
  'requires_action',
]

export const EVIDENCE_KINDS = [
  'tracking_snapshot',
  'carrier_correspondence',
  'proof_of_delivery',
  'customer_photo',
  'return_receipt',
  'inspection_report',
  'order_event',
  'other',
] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

/**
 * A parcel's status as a tracking page describes it (Phase 4.1). Read off the
 * carrier's site by staff, or derived from the order's own record — there is
 * no carrier API behind it (docs/refunds/README.md, "Shipping evidence").
 */
export const TRACKING_STATUSES = [
  'label_created',
  'accepted_by_carrier',
  'in_transit',
  'delayed',
  'delivery_attempted',
  'available_for_collection',
  'delivered',
  'returned_to_sender',
  'lost',
  'unknown',
] as const
export type TrackingStatus = (typeof TRACKING_STATUSES)[number]

/** Who is acting. Every change to a case names one. */
export type Actor =
  | { type: 'customer'; userId: string; label: string }
  | { type: 'staff'; staffId: string | null; role: StaffRole; label: string; legacy: boolean }
  | { type: 'system'; label: string }
  | { type: 'provider'; label: string }

export function actorId(actor: Actor): string | null {
  if (actor.type === 'customer') return actor.userId
  if (actor.type === 'staff') return actor.staffId
  return null
}
