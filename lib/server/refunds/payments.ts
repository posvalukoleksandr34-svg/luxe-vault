import 'server-only'

import type Stripe from 'stripe'

import { scale } from '@/lib/refunds/money'
import { toMinor } from '@/lib/refunds/money'
import type { Actor, TransactionStatus } from '@/lib/refunds/types'
import { actorId } from '@/lib/refunds/types'
import {
  claimAttempt,
  ledgerForOrder,
  reserve,
  settle,
  type LedgerRow,
  type ReserveRefusal,
  type SettleResult,
} from '@/lib/server/refunds/ledger'
import type { RefundOrderFacts } from '@/lib/server/refunds/order-facts'
import { getStripe, isAmbiguousStripeFailure, isStripeConfigured } from '@/lib/server/stripe'

/**
 * Moving money back — the ONLY code that calls the payment provider's refund
 * API, whatever started the refund (a case, the order screen, the fraud
 * guard).
 *
 * APPROVAL IS NOT PAYMENT. A case's approval is a decision in the database;
 * this is what executes one, and the ledger row it writes says what the
 * provider actually answered. Nothing here marks money as returned without
 * the provider saying so — except a MANUAL payout (a crypto payment has no
 * refund API), which is recorded as exactly that: a person's statement, with
 * their name and the payout's reference, never dressed up as a provider
 * confirmation.
 *
 * THE SEQUENCE (Stripe):
 *
 *   1. check the payment at Stripe: captured, and Stripe's refund total is
 *      no further ahead than our ledger (a refund made in the dashboard must
 *      be recorded before another is decided on top of it);
 *   2. RESERVE in the ledger (reserve_refund_transaction): under the order's
 *      row lock, refused if it would exceed what was paid, what the case
 *      approved, or if another refund is in flight;
 *   3. SUBMIT to Stripe with an idempotency key derived from the ledger row
 *      and its attempt number, and the row's id in the refund's metadata;
 *   4. SETTLE the row with Stripe's answer — succeeded, pending,
 *      requires_action, failed — which rebuilds the order's summary from the
 *      ledger. A timeout or 5xx is 'unknown', never 'failed': the refund may
 *      exist. Reconciliation (reconcileRow) finds it by its metadata, and only
 *      resubmits — with the NEXT attempt's key — once Stripe shows no refund
 *      for the row after a quiet period.
 *
 * Stripe's later word (refund.updated / refund.failed webhooks) settles the
 * row again; a refund that succeeded and then failed comes off the summary.
 */

/** Minutes after an unknown outcome before Stripe's refund list is trusted to
 *  be complete and a new attempt may be made. */
export const RESUBMIT_AFTER_MS = 10 * 60 * 1000
/** Beyond this many attempts, a person checks Stripe by hand. */
export const MAX_ATTEMPTS = 3

export type ExecuteInput = {
  order: RefundOrderFacts
  amountMinor: number
  caseId?: string
  source: 'case' | 'order_screen' | 'cancellation' | 'fraud_guard'
  reason: string
  actor: Actor
  approvedBy?: string | null
  approvedByLabel?: string
  secondApprovedBy?: string | null
  /** Stable for one intended refund: a retry of the same request reuses it. */
  idempotencyKey: string
  correlationId: string
}

export type ExecuteFailure =
  | ReserveRefusal
  | 'manual_method'
  | 'stripe_unconfigured'
  | 'not_captured'
  | 'stripe_ledger_ahead'
  | 'provider_refused'
  | 'in_progress'

export type ExecuteResult =
  | { ok: true; row: LedgerRow; settled?: SettleResult }
  | { ok: false; code: ExecuteFailure; message: string; row?: LedgerRow; settled?: SettleResult }

/** What one rappen of the order is in the charge currency's minor units. */
export function chargeMinorOf(order: RefundOrderFacts): { currency: string; chargeMinor: number; converted: boolean } {
  const code = order.paymentCurrency?.toUpperCase()
  if (order.paymentProvider === 'stripe' && code && order.paymentAmount !== undefined && order.paymentAmount > 0) {
    const chargeMinor = toMinor(order.paymentAmount.toFixed(2))
    return { currency: code, chargeMinor, converted: code !== 'CHF' }
  }
  return { currency: 'CHF', chargeMinor: order.totalMinor, converted: false }
}

/** CHF minor → charge-currency minor, at the rate the payment was MADE at. */
export function toProviderMinor(order: RefundOrderFacts, amountMinor: number): number {
  const c = chargeMinorOf(order)
  if (!c.converted || order.totalMinor === 0) return amountMinor
  return scale(amountMinor, c.chargeMinor, order.totalMinor)
}

export function fromProviderMinor(order: RefundOrderFacts, providerMinor: number): number {
  const c = chargeMinorOf(order)
  if (!c.converted || c.chargeMinor === 0) return providerMinor
  return scale(providerMinor, order.totalMinor, c.chargeMinor)
}

export function mapStripeStatus(status: string | null | undefined): TransactionStatus {
  switch (status) {
    case 'succeeded':
      return 'succeeded'
    case 'pending':
      return 'pending'
    case 'requires_action':
      return 'requires_action'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'canceled'
    default:
      return 'unknown'
  }
}

function actorFields(actor: Actor): { actorType: 'staff' | 'system' | 'provider'; actorId: string | null; actorLabel: string } {
  return {
    actorType: actor.type === 'customer' ? 'system' : actor.type,
    actorId: actorId(actor),
    actorLabel: actor.label,
  }
}

type ChargeState = { intent: Stripe.PaymentIntent; receivedMinor: number; refundedMinor: number }

async function chargeState(paymentIntentId: string): Promise<ChargeState> {
  const intent = await getStripe().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
  const charge = intent.latest_charge && typeof intent.latest_charge !== 'string' ? intent.latest_charge : null
  return { intent, receivedMinor: intent.amount_received ?? 0, refundedMinor: charge?.amount_refunded ?? 0 }
}

/**
 * Stripe's refunded total that our ledger cannot account for, in the charge
 * currency. Above a rounding tolerance it means a refund was made outside the
 * console and is not recorded yet.
 */
export function unexplainedStripeRefunds(
  order: RefundOrderFacts,
  ledger: LedgerRow[],
  stripeRefundedMinor: number,
): { unexplained: number; tolerance: number } {
  const c = chargeMinorOf(order)
  let accounted = 0
  for (const row of ledger) {
    if (!['pending_submission', 'submitted', 'unknown', 'pending', 'requires_action', 'succeeded'].includes(row.status)) continue
    if (row.provider === 'manual') continue
    accounted += row.providerAmountMinor ?? toProviderMinor(order, row.amountMinor)
  }
  const tolerance = c.converted ? Math.max(2, Math.ceil(c.chargeMinor * 0.001)) : 0
  return { unexplained: stripeRefundedMinor - accounted, tolerance }
}

export async function executeRefund(input: ExecuteInput): Promise<ExecuteResult> {
  const { order } = input
  if (order.paymentProvider !== 'stripe' || !order.paymentId) {
    return { ok: false, code: 'manual_method', message: 'Оплата прошла не через Stripe — возврат вручную с указанием реквизитов выплаты.' }
  }
  if (!isStripeConfigured()) return { ok: false, code: 'stripe_unconfigured', message: 'Stripe не настроен' }

  // 1. The payment as Stripe sees it.
  const state = await chargeState(order.paymentId)
  if (state.intent.status !== 'succeeded') {
    return { ok: false, code: 'not_captured', message: `Платёж в Stripe в статусе ${state.intent.status}, не списан` }
  }
  const ledger = await ledgerForOrder(order.id)
  const { unexplained, tolerance } = unexplainedStripeRefunds(order, ledger, state.refundedMinor)
  if (unexplained > tolerance) {
    return {
      ok: false,
      code: 'stripe_ledger_ahead',
      message: 'В Stripe есть возврат, которого нет в журнале (сделан в панели Stripe?). Синхронизируйте заказ и проверьте сумму перед новым возвратом.',
    }
  }

  // The provider amount. The refund that completes the order takes exactly
  // what Stripe still holds, so a converted payment never leaves a stray cent.
  const remainingAtStripe = state.receivedMinor - state.refundedMinor
  const completes = input.amountMinor + order.committedMinor >= order.totalMinor
  let providerMinor = completes ? remainingAtStripe : toProviderMinor(order, input.amountMinor)
  if (providerMinor === remainingAtStripe + 1) providerMinor = remainingAtStripe
  if (providerMinor <= 0 || providerMinor > remainingAtStripe) {
    return { ok: false, code: 'REFUND_EXCEEDS_BALANCE', message: 'Сумма превышает остаток платежа в Stripe' }
  }

  // 2. Reserve.
  const reserved = await reserve({
    orderId: order.id,
    caseId: input.caseId,
    provider: 'stripe',
    paymentReference: order.paymentId,
    idempotencyKey: input.idempotencyKey,
    amountMinor: input.amountMinor,
    providerAmountMinor: providerMinor,
    providerCurrency: (state.intent.currency ?? 'chf').toUpperCase(),
    reason: input.reason,
    source: input.source,
    initiatedBy: actorId(input.actor),
    initiatedByLabel: input.actor.label,
    approvedBy: input.approvedBy,
    approvedByLabel: input.approvedByLabel,
    secondApprovedBy: input.secondApprovedBy,
    actorType: actorFields(input.actor).actorType,
    correlationId: input.correlationId,
  })
  if (!reserved.ok) return { ok: false, code: reserved.refusal, message: refusalMessage(reserved.refusal) }

  const row = reserved.row
  // The same request sent again: report where the first one got to, and
  // check Stripe if that was "unknown" — never submit a second time blind.
  if (row.status !== 'pending_submission') {
    if (row.status === 'unknown' || row.status === 'submitted') return reconcileRow(row, input.actor)
    return resultOf(row)
  }
  return submit(row, input.actor, input.correlationId)
}

function resultOf(row: LedgerRow, settled?: SettleResult): ExecuteResult {
  if (row.status === 'failed' || row.status === 'canceled') {
    return { ok: false, code: 'provider_refused', message: row.failureMessage ?? row.failureCode ?? 'Stripe отклонил возврат', row, settled }
  }
  return { ok: true, row, settled }
}

export function refusalMessage(code: ReserveRefusal): string {
  switch (code) {
    case 'REFUND_IN_FLIGHT':
      return 'По заказу уже идёт другой возврат — дождитесь его результата.'
    case 'REFUND_EXCEEDS_BALANCE':
      return 'Сумма больше, чем осталось к возврату по заказу.'
    case 'REFUND_EXCEEDS_APPROVED':
      return 'Сумма больше одобренной по заявке.'
    case 'CASE_NOT_APPROVED':
      return 'Заявка не одобрена — сначала решение, потом возврат.'
    case 'ORDER_NOT_REFUNDABLE':
      return 'Заказ не оплачен или уже полностью возвращён.'
    case 'CASE_ORDER_MISMATCH':
      return 'Заявка относится к другому заказу.'
    case 'ORDER_NOT_FOUND':
      return 'Заказ не найден.'
    case 'INVALID_AMOUNT':
      return 'Некорректная сумма.'
  }
}

/** One call to Stripe for a reserved row. */
async function submit(row: LedgerRow, actor: Actor, correlationId?: string): Promise<ExecuteResult> {
  const who = actorFields(actor)
  // Claim the attempt BEFORE the call, compare-and-set on the attempt count:
  // only one caller holding this row gets to call Stripe, and the attempt's
  // number keys the request — so a crash after this line and a later retry
  // can never reuse a key Stripe may have cached a 500 under.
  const claimed = await claimAttempt(row, { ...who, correlationId })
  if (!claimed) {
    return { ok: false, code: 'in_progress', message: 'Этот возврат уже отправляется — обновите страницу через минуту.', row }
  }
  const key = `lv_refund:${row.id}:${claimed.attempts}`

  let refund: Stripe.Refund
  try {
    refund = await getStripe().refunds.create(
      {
        payment_intent: row.paymentReference,
        amount: row.providerAmountMinor,
        reason: 'requested_by_customer',
        metadata: {
          refund_tx_id: row.id,
          order_id: row.orderId,
          ...(row.caseId ? { case_id: row.caseId } : {}),
          source: row.source,
        },
      },
      { idempotencyKey: key },
    )
  } catch (error) {
    if (isAmbiguousStripeFailure(error)) {
      const settled = await settle({
        transactionId: row.id,
        status: 'unknown',
        failureMessage: (error as Error)?.message,
        ...who,
        correlationId,
      })
      return {
        ok: false,
        code: 'provider_refused',
        message:
          'Stripe не подтвердил возврат (таймаут или ошибка связи). Возврат мог пройти: статус проверится автоматически — не повторяйте вручную.',
        row: settled.row,
        settled,
      }
    }
    const e = error as { code?: string; type?: string; message?: string }
    const settled = await settle({
      transactionId: row.id,
      status: 'failed',
      failureCode: e.code ?? e.type ?? 'stripe_error',
      failureMessage: e.message ?? 'Stripe error',
      ...who,
      correlationId,
    })
    return { ok: false, code: 'provider_refused', message: e.message ?? 'Stripe отклонил возврат', row: settled.row, settled }
  }

  const settled = await settle({
    transactionId: row.id,
    status: mapStripeStatus(refund.status),
    providerRefundId: refund.id,
    providerAmountMinor: refund.amount,
    providerCurrency: refund.currency?.toUpperCase(),
    failureCode: refund.failure_reason ?? undefined,
    ...who,
    correlationId,
  })
  return resultOf(settled.row, settled)
}

/**
 * Finds out what happened to one in-flight row and records it. Used by the
 * sweep, by "check status" in the console, and when the same request comes in
 * twice. Never creates a second refund while the first may exist.
 */
export async function reconcileRow(row: LedgerRow, actor: Actor): Promise<ExecuteResult> {
  const who = actorFields(actor)
  if (row.provider !== 'stripe' || !row.paymentReference) return resultOf(row)
  if (!isStripeConfigured()) return { ok: false, code: 'stripe_unconfigured', message: 'Stripe не настроен', row }

  const stripe = getStripe()
  let found: Stripe.Refund | null = null
  if (row.providerRefundId) {
    found = await stripe.refunds.retrieve(row.providerRefundId)
  } else {
    for await (const r of stripe.refunds.list({ payment_intent: row.paymentReference, limit: 100 })) {
      if (r.metadata?.refund_tx_id === row.id) {
        found = r
        break
      }
    }
  }

  if (found) {
    const status = mapStripeStatus(found.status)
    if (status === row.status && row.providerRefundId) {
      const settled = await settle({ transactionId: row.id, ...who })
      return resultOf(settled.row, settled)
    }
    const settled = await settle({
      transactionId: row.id,
      status: status === row.status ? undefined : status,
      providerRefundId: found.id,
      providerAmountMinor: found.amount,
      providerCurrency: found.currency?.toUpperCase(),
      failureCode: found.failure_reason ?? undefined,
      ...who,
    })
    return resultOf(settled.row, settled)
  }

  // No refund at Stripe for this row.
  if (row.status === 'pending' || row.status === 'requires_action') {
    // It had an id once and Stripe no longer knows it: a person looks.
    return { ok: false, code: 'provider_refused', message: 'Stripe не находит этот возврат — проверьте вручную в Stripe.', row }
  }
  // Never called (reserved, then the request died before its first call):
  // submit — the claim stops this racing the original request. Called
  // before: wait out a quiet period after the LAST call, so a request Stripe
  // was still processing has surely surfaced in its list.
  const quietSince = row.lastAttemptAt ?? row.createdAt
  if (row.attempts > 0 && Date.now() - quietSince < RESUBMIT_AFTER_MS) {
    const settled = await settle({ transactionId: row.id, ...who })
    return { ok: false, code: 'provider_refused', message: 'Результат пока неизвестен — проверка повторится.', row: settled.row, settled }
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return {
      ok: false,
      code: 'provider_refused',
      message: `После ${row.attempts} попыток Stripe так и не подтвердил возврат. Проверьте платёж в Stripe и отмените резерв, если возврата нет.`,
      row,
    }
  }
  return submit(row, actor)
}

/**
 * Releases a stuck reservation — ONLY after Stripe confirms it holds no
 * refund for it. The in-flight lock on the order goes with it.
 */
export async function cancelStuckReservation(row: LedgerRow, actor: Actor, reason: string): Promise<ExecuteResult> {
  if (!['pending_submission', 'submitted', 'unknown'].includes(row.status)) {
    return { ok: false, code: 'provider_refused', message: 'Отменить можно только возврат с неизвестным результатом', row }
  }
  if (row.provider === 'stripe' && row.paymentReference) {
    if (!isStripeConfigured()) return { ok: false, code: 'stripe_unconfigured', message: 'Stripe не настроен', row }
    for await (const r of getStripe().refunds.list({ payment_intent: row.paymentReference, limit: 100 })) {
      if (r.metadata?.refund_tx_id === row.id) {
        return reconcileRow(row, actor)
      }
    }
  }
  const settled = await settle({
    transactionId: row.id,
    status: 'canceled',
    failureCode: 'released_by_staff',
    failureMessage: reason.slice(0, 500),
    ...actorFields(actor),
  })
  return { ok: true, row: settled.row, settled }
}

/**
 * Money returned outside any API — a crypto payment, which NOWPayments cannot
 * refund. A staff member with refund.execute pays it out themselves, then
 * records it here with the payout's reference. Recorded as provider 'manual':
 * the ledger never claims a provider confirmed it.
 */
export async function recordManualRefund(input: {
  order: RefundOrderFacts
  amountMinor: number
  caseId?: string
  reference: string
  note: string
  actor: Extract<Actor, { type: 'staff' }>
  approvedBy?: string | null
  approvedByLabel?: string
  secondApprovedBy?: string | null
  idempotencyKey: string
  correlationId: string
}): Promise<ExecuteResult> {
  if (input.order.paymentProvider === 'stripe') {
    return {
      ok: false,
      code: 'manual_method',
      message: 'Карточный платёж возвращается только через Stripe — ручная запись для него запрещена.',
    }
  }
  const reserved = await reserve({
    orderId: input.order.id,
    caseId: input.caseId,
    provider: 'manual',
    paymentReference: input.order.paymentId,
    idempotencyKey: input.idempotencyKey,
    amountMinor: input.amountMinor,
    reason: input.note,
    source: input.caseId ? 'case' : 'order_screen',
    initiatedBy: input.actor.staffId,
    initiatedByLabel: input.actor.label,
    approvedBy: input.approvedBy,
    approvedByLabel: input.approvedByLabel,
    secondApprovedBy: input.secondApprovedBy,
    manualReference: input.reference,
    actorType: 'staff',
    correlationId: input.correlationId,
  })
  if (!reserved.ok) return { ok: false, code: reserved.refusal, message: refusalMessage(reserved.refusal) }
  if (reserved.row.status !== 'pending_submission') return resultOf(reserved.row)
  const settled = await settle({
    transactionId: reserved.row.id,
    status: 'succeeded',
    ...actorFields(input.actor),
    correlationId: input.correlationId,
  })
  return { ok: true, row: settled.row, settled }
}
