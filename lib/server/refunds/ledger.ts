import 'server-only'

import type { TransactionStatus } from '@/lib/refunds/types'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The refund ledger (public.refund_transactions), as the services see it.
 *
 * Every write goes through a database function that takes the order's row
 * lock: reserve_refund_transaction (the over-refund guard),
 * settle_refund_transaction (records the provider's answer and rebuilds the
 * order and case summaries from the ledger) and record_external_refund. The
 * table itself refuses edits to amounts, deletions and backward status moves.
 */

export type LedgerRow = {
  id: string
  orderId: string
  caseId?: string
  provider: 'stripe' | 'manual' | 'legacy'
  paymentReference?: string
  providerRefundId?: string
  idempotencyKey: string
  amountMinor: number
  currency: string
  providerAmountMinor?: number
  providerCurrency?: string
  reason?: string
  status: TransactionStatus
  source: string
  initiatedByLabel?: string
  approvedByLabel?: string
  manualReference?: string
  failureCode?: string
  failureMessage?: string
  attempts: number
  createdAt: number
  submittedAt?: number
  settledAt?: number
  lastCheckedAt?: number
  lastAttemptAt?: number
}

const ms = (v: unknown): number | undefined => (typeof v === 'string' && v ? Date.parse(v) : undefined)

export function toLedgerRow(r: Record<string, unknown>): LedgerRow {
  return {
    id: r.id as string,
    orderId: r.order_id as string,
    caseId: (r.case_id as string | null) ?? undefined,
    provider: r.provider as LedgerRow['provider'],
    paymentReference: (r.payment_reference as string | null) ?? undefined,
    providerRefundId: (r.provider_refund_id as string | null) ?? undefined,
    idempotencyKey: r.idempotency_key as string,
    amountMinor: Number(r.amount_minor),
    currency: r.currency as string,
    providerAmountMinor: r.provider_amount_minor === null || r.provider_amount_minor === undefined ? undefined : Number(r.provider_amount_minor),
    providerCurrency: (r.provider_currency as string | null) ?? undefined,
    reason: (r.reason as string | null) ?? undefined,
    status: r.status as TransactionStatus,
    source: r.source as string,
    initiatedByLabel: (r.initiated_by_label as string | null) ?? undefined,
    approvedByLabel: (r.approved_by_label as string | null) ?? undefined,
    manualReference: (r.manual_reference as string | null) ?? undefined,
    failureCode: (r.failure_code as string | null) ?? undefined,
    failureMessage: (r.failure_message as string | null) ?? undefined,
    attempts: Number(r.attempts) || 0,
    createdAt: Date.parse(r.created_at as string),
    submittedAt: ms(r.submitted_at),
    settledAt: ms(r.settled_at),
    lastCheckedAt: ms(r.last_checked_at),
    lastAttemptAt: ms(r.last_attempt_at),
  }
}

/** Codes reserve_refund_transaction raises, as the services report them. */
export type ReserveRefusal =
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_REFUNDABLE'
  | 'REFUND_IN_FLIGHT'
  | 'REFUND_EXCEEDS_BALANCE'
  | 'CASE_ORDER_MISMATCH'
  | 'CASE_NOT_APPROVED'
  | 'REFUND_EXCEEDS_APPROVED'
  | 'INVALID_AMOUNT'

const RESERVE_REFUSALS: ReserveRefusal[] = [
  'ORDER_NOT_FOUND',
  'ORDER_NOT_REFUNDABLE',
  'REFUND_IN_FLIGHT',
  'REFUND_EXCEEDS_BALANCE',
  'CASE_ORDER_MISMATCH',
  'CASE_NOT_APPROVED',
  'REFUND_EXCEEDS_APPROVED',
  'INVALID_AMOUNT',
]

export function refusalOf(message: string | undefined): ReserveRefusal | null {
  if (!message) return null
  return RESERVE_REFUSALS.find((code) => message.includes(code)) ?? null
}

export type Reservation = {
  orderId: string
  caseId?: string
  provider: 'stripe' | 'manual'
  paymentReference?: string
  idempotencyKey: string
  amountMinor: number
  providerAmountMinor?: number
  providerCurrency?: string
  reason: string
  source: 'case' | 'order_screen' | 'cancellation' | 'fraud_guard'
  initiatedBy?: string | null
  initiatedByLabel: string
  approvedBy?: string | null
  approvedByLabel?: string
  secondApprovedBy?: string | null
  manualReference?: string
  actorType: 'staff' | 'system' | 'provider'
  correlationId?: string
}

export async function reserve(r: Reservation): Promise<{ ok: true; row: LedgerRow } | { ok: false; refusal: ReserveRefusal; detail?: string }> {
  const { data, error } = await createAdminClient().rpc('reserve_refund_transaction', {
    p: {
      order_id: r.orderId,
      case_id: r.caseId ?? null,
      provider: r.provider,
      payment_reference: r.paymentReference ?? null,
      idempotency_key: r.idempotencyKey,
      amount_minor: r.amountMinor,
      provider_amount_minor: r.providerAmountMinor ?? null,
      provider_currency: r.providerCurrency ?? null,
      reason: r.reason.slice(0, 500),
      source: r.source,
      initiated_by: r.initiatedBy ?? null,
      initiated_by_label: r.initiatedByLabel,
      approved_by: r.approvedBy ?? null,
      approved_by_label: r.approvedByLabel ?? null,
      second_approved_by: r.secondApprovedBy ?? null,
      manual_reference: r.manualReference ?? null,
      actor_type: r.actorType,
      correlation_id: r.correlationId ?? null,
    },
  })
  if (error) {
    const refusal = refusalOf(error.message)
    if (refusal) return { ok: false, refusal, detail: error.details ?? undefined }
    throw new Error(`Failed to reserve a refund: ${error.message}`)
  }
  return { ok: true, row: toLedgerRow(data as Record<string, unknown>) }
}

export type Settlement = {
  transactionId: string
  status?: TransactionStatus
  providerRefundId?: string
  providerAmountMinor?: number
  providerCurrency?: string
  failureCode?: string
  failureMessage?: string
  countAttempt?: boolean
  actorType: 'staff' | 'system' | 'provider'
  actorId?: string | null
  actorLabel: string
  correlationId?: string
}

export type SettleResult = {
  row: LedgerRow
  orderRefundedMinor: number
  orderTotalMinor: number
  paymentStatus: string
  caseRefundedMinor?: number
}

export async function settle(s: Settlement): Promise<SettleResult> {
  const { data, error } = await createAdminClient().rpc('settle_refund_transaction', {
    p: {
      transaction_id: s.transactionId,
      status: s.status ?? null,
      provider_refund_id: s.providerRefundId ?? null,
      provider_amount_minor: s.providerAmountMinor ?? null,
      provider_currency: s.providerCurrency ?? null,
      failure_code: s.failureCode?.slice(0, 120) ?? null,
      failure_message: s.failureMessage?.slice(0, 500) ?? null,
      count_attempt: Boolean(s.countAttempt),
      actor_type: s.actorType,
      actor_id: s.actorId ?? null,
      actor_label: s.actorLabel,
      correlation_id: s.correlationId ?? null,
    },
  })
  if (error) throw new Error(`Failed to settle refund ${s.transactionId}: ${error.message}`)
  const out = data as Record<string, unknown>
  return {
    row: toLedgerRow(out.transaction as Record<string, unknown>),
    orderRefundedMinor: Number(out.order_refunded_minor),
    orderTotalMinor: Number(out.order_total_minor),
    paymentStatus: out.payment_status as string,
    caseRefundedMinor: out.case_refunded_minor === null || out.case_refunded_minor === undefined ? undefined : Number(out.case_refunded_minor),
  }
}

/**
 * The right to call the provider for this row once more, if nobody else took
 * it first (claim_refund_attempt). Returns the claimed row — its `attempts`
 * is this attempt's number — or null when another caller holds it.
 */
export async function claimAttempt(
  row: LedgerRow,
  event: { actorType: string; actorId?: string | null; actorLabel: string; correlationId?: string },
): Promise<LedgerRow | null> {
  const { data, error } = await createAdminClient().rpc('claim_refund_attempt', {
    p_tx: row.id,
    p_expected: row.attempts,
    p_event: {
      actor_type: event.actorType,
      actor_id: event.actorId ?? null,
      actor_label: event.actorLabel,
      correlation_id: event.correlationId ?? null,
    },
  })
  if (error) throw new Error(`Failed to claim a refund attempt: ${error.message}`)
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Record<string, unknown>[]
  return rows[0] ? toLedgerRow(rows[0]) : null
}

export async function recordExternal(e: {
  orderId: string
  providerRefundId: string
  paymentReference?: string
  amountMinor: number
  providerAmountMinor?: number
  providerCurrency?: string
  status: TransactionStatus
  reason?: string
  correlationId?: string
}): Promise<LedgerRow | null> {
  const { data, error } = await createAdminClient().rpc('record_external_refund', {
    p: {
      order_id: e.orderId,
      provider: 'stripe',
      payment_reference: e.paymentReference ?? null,
      provider_refund_id: e.providerRefundId,
      amount_minor: e.amountMinor,
      provider_amount_minor: e.providerAmountMinor ?? null,
      provider_currency: e.providerCurrency ?? null,
      status: e.status,
      reason: e.reason ?? null,
      actor_label: 'Stripe',
      correlation_id: e.correlationId ?? null,
    },
  })
  if (error) {
    if (error.message.includes('NOTHING_TO_RECORD')) return null
    throw new Error(`Failed to record an outside refund: ${error.message}`)
  }
  return toLedgerRow(data as Record<string, unknown>)
}

export async function ledgerForOrder(orderId: string): Promise<LedgerRow[]> {
  const { data, error } = await createAdminClient()
    .from('refund_transactions')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Failed to read the refund ledger: ${error.message}`)
  return (data ?? []).map((r) => toLedgerRow(r as Record<string, unknown>))
}

export async function ledgerRow(id: string): Promise<LedgerRow | null> {
  const { data, error } = await createAdminClient().from('refund_transactions').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Failed to read refund ${id}: ${error.message}`)
  return data ? toLedgerRow(data as Record<string, unknown>) : null
}

export async function ledgerRowByProviderId(providerRefundId: string): Promise<LedgerRow | null> {
  const { data, error } = await createAdminClient()
    .from('refund_transactions')
    .select('*')
    .eq('provider', 'stripe')
    .eq('provider_refund_id', providerRefundId)
    .maybeSingle()
  if (error) throw new Error(`Failed to read refund ${providerRefundId}: ${error.message}`)
  return data ? toLedgerRow(data as Record<string, unknown>) : null
}

/** In-flight rows whose outcome needs checking: oldest check first. */
export async function unsettledRows(olderThanMs: number, limit = 25): Promise<LedgerRow[]> {
  const { data, error } = await createAdminClient()
    .from('refund_transactions')
    .select('*')
    .in('status', ['pending_submission', 'submitted', 'unknown', 'pending', 'requires_action'])
    .lt('updated_at', new Date(Date.now() - olderThanMs).toISOString())
    .order('updated_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`Failed to read unsettled refunds: ${error.message}`)
  return (data ?? []).map((r) => toLedgerRow(r as Record<string, unknown>))
}
