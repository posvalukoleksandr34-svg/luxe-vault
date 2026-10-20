import type { InvestigationStatus, TrackingStatus } from '@/lib/refunds/types'

/**
 * Delivery evidence and the non-delivery recommendation (Phase 4).
 *
 * WHAT THE SHOP CAN KNOW. There is no carrier API behind this shop — Swiss
 * Post's tracking API needs a business contract it does not have — so a
 * tracking snapshot is either READ OFF THE CARRIER'S PAGE by staff (source
 * 'staff', with the time they looked) or DERIVED FROM THE ORDER'S OWN RECORD
 * (source 'system': a tracking number and dispatch/delivery dates the admin
 * entered). Neither proves who received a parcel; nothing here says it does.
 * A field the source does not provide is `undefined` and shown "not
 * available" — never filled in.
 *
 * The recommendation is advice to a person, with its reasons. It never
 * approves or rejects anything, and staff may decide otherwise with a
 * recorded reason.
 */

export type TrackingEvent = {
  at: number
  status: TrackingStatus
  description?: string
  location?: string
}

export type TrackingSnapshot = {
  carrier?: string
  trackingNumber?: string
  status: TrackingStatus
  events: TrackingEvent[]
  shipmentCreatedAt?: number
  dispatchedAt?: number
  deliveredAt?: number
  deliveryLocation?: string
  proofOfDelivery?: boolean
  signatureObtained?: boolean
  exception?: string
  carrierClaimRef?: string
  /** Where this came from and when it was read. */
  source: 'staff' | 'system' | 'carrier_api'
  retrievedAt: number
}

/** True only for statuses that show the carrier actually holding the parcel. */
export function carrierHasParcel(status: TrackingStatus): boolean {
  // A label is not a shipment: the parcel may never have been handed over.
  return status !== 'label_created' && status !== 'unknown'
}

/**
 * Events that contradict each other: a delivery followed by the parcel moving
 * again, or a delivery dated before the carrier accepted it.
 */
export function trackingConflicts(snapshot: TrackingSnapshot): string[] {
  const conflicts: string[] = []
  const events = [...snapshot.events].sort((a, b) => a.at - b.at)
  const delivered = events.find((e) => e.status === 'delivered')
  if (delivered) {
    const after = events.filter((e) => e.at > delivered.at && !['delivered', 'returned_to_sender'].includes(e.status))
    if (after.length > 0) conflicts.push('movement_after_delivery')
    const accepted = events.find((e) => e.status === 'accepted_by_carrier' || e.status === 'in_transit')
    if (accepted && accepted.at > delivered.at) conflicts.push('delivered_before_accepted')
  }
  if (snapshot.deliveredAt && snapshot.dispatchedAt && snapshot.deliveredAt < snapshot.dispatchedAt) {
    conflicts.push('delivered_before_dispatch')
  }
  if (snapshot.status === 'delivered' && !snapshot.deliveredAt && !delivered) conflicts.push('delivered_without_date')
  return conflicts
}

export type NonDeliveryAdvice =
  | 'wait_for_delivery_window'
  | 'ask_customer_to_check'
  | 'open_carrier_investigation'
  | 'resolve_in_customer_favour'
  | 'manual_review'

export type AdviceReason =
  | 'inside_delivery_window'
  | 'no_tracking'
  | 'label_only'
  | 'tracking_conflicts'
  | 'carrier_reports_delivered'
  | 'delivered_with_signature'
  | 'carrier_exception'
  | 'returned_to_sender'
  | 'carrier_confirms_lost'
  | 'overdue_without_update'
  | 'carrier_claim_open'
  | 'awaiting_collection'
  | 'in_transit_within_grace'

export type Advice = { advice: NonDeliveryAdvice; reasons: AdviceReason[] }

export function adviseNonDelivery(params: {
  now: number
  /** The claim waits until here (eligibility.waitUntil), if anywhere. */
  waitUntil?: number
  latest?: TrackingSnapshot
  investigation: InvestigationStatus
  hasTrackingNumber: boolean
}): Advice {
  const { latest } = params
  if (params.investigation === 'lost_confirmed') return { advice: 'resolve_in_customer_favour', reasons: ['carrier_confirms_lost'] }
  if (params.investigation === 'carrier_claim_opened') return { advice: 'manual_review', reasons: ['carrier_claim_open'] }
  if (params.waitUntil && params.now < params.waitUntil) {
    return { advice: 'wait_for_delivery_window', reasons: ['inside_delivery_window'] }
  }
  if (!params.hasTrackingNumber && !latest) {
    // Nothing to check against: the shop's own record is incomplete, which is
    // the shop's gap, not evidence about the customer.
    return { advice: 'manual_review', reasons: ['no_tracking'] }
  }
  if (!latest) return { advice: 'open_carrier_investigation', reasons: ['overdue_without_update'] }

  const conflicts = trackingConflicts(latest)
  if (conflicts.length > 0) return { advice: 'manual_review', reasons: ['tracking_conflicts'] }

  switch (latest.status) {
    case 'lost':
      return { advice: 'resolve_in_customer_favour', reasons: ['carrier_confirms_lost'] }
    case 'returned_to_sender':
      return { advice: 'resolve_in_customer_favour', reasons: ['returned_to_sender'] }
    case 'label_created':
    case 'unknown':
      return { advice: 'open_carrier_investigation', reasons: [latest.status === 'label_created' ? 'label_only' : 'overdue_without_update'] }
    case 'available_for_collection':
    case 'delivery_attempted':
      return { advice: 'ask_customer_to_check', reasons: ['awaiting_collection'] }
    case 'delayed':
      return { advice: 'open_carrier_investigation', reasons: latest.exception ? ['carrier_exception'] : ['overdue_without_update'] }
    case 'accepted_by_carrier':
    case 'in_transit':
      return { advice: 'open_carrier_investigation', reasons: ['overdue_without_update'] }
    case 'delivered':
      // "Delivered" on a tracking page is the carrier's word that it left the
      // parcel somewhere — not proof the customer got it. A first claim is
      // met with a proportionate check (neighbours, mailbox, pickup point)
      // and, if that finds nothing, a carrier investigation.
      return {
        advice: 'ask_customer_to_check',
        reasons: latest.signatureObtained ? ['delivered_with_signature'] : ['carrier_reports_delivered'],
      }
  }
  return { advice: 'manual_review', reasons: [] }
}
