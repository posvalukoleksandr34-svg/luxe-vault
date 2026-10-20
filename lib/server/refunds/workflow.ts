import 'server-only'

import { calculateRefund, CalculationError, type CalcResult } from '@/lib/refunds/calculator'
import type { CustomerEvent } from '@/lib/refunds/customer-copy'
import { can, type Permission } from '@/lib/refunds/permissions'
import { claimRule, type PolicyConfig } from '@/lib/refunds/policy'
import { checkTransition, COMMANDS, type Command } from '@/lib/refunds/state-machine'
import {
  INSPECTION_OUTCOMES,
  INVESTIGATION_STATUSES,
  RESOLUTIONS,
  TRACKING_STATUSES,
  type Actor,
  type CaseState,
  type InspectionOutcome,
  type InvestigationStatus,
  type Resolution,
} from '@/lib/refunds/types'
import type { TrackingSnapshot } from '@/lib/refunds/delivery'
import { reverseReferralReward } from '@/lib/server/referrals'
import { audit, eventActor, newCorrelationId } from '@/lib/server/refunds/audit'
import {
  getCase,
  getCaseItems,
  type ApprovalBreakdown,
  type CaseItem,
  type CaseRecord,
  type PendingApproval,
} from '@/lib/server/refunds/cases'
import { recordTrackingSnapshot } from '@/lib/server/refunds/evidence'
import { ledgerRow, type LedgerRow } from '@/lib/server/refunds/ledger'
import { notifyCustomer, notifyOrderRefunded, notifyStaff } from '@/lib/server/refunds/notify'
import { claimedElsewhere, loadOrderFacts, toCalcOrder, type RefundOrderFacts } from '@/lib/server/refunds/order-facts'
import { cancelStuckReservation, executeRefund, reconcileRow, recordManualRefund, type ExecuteResult } from '@/lib/server/refunds/payments'
import { policyVersion } from '@/lib/server/refunds/policy-store'
import { assessAndStore } from '@/lib/server/refunds/risk-facts'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The refund case workflow: every change to a case goes through here.
 *
 *   1. The command is looked up in the state machine (lib/refunds/state-machine.ts):
 *      may this actor, with this role, issue it to a case in this state?
 *   2. The command's own rules are checked against the server's data — the
 *      order, the ledger, the policy the case was filed under. Nothing the
 *      browser sends is taken as a fact: amounts are computed here, the
 *      browser may only ask for LESS, with a reason.
 *   3. The change is written by refund_case_apply: compare-and-set on the
 *      version the decision was made on and on the from-state, case and line
 *      changes and the audit row in one transaction.
 *   4. Consequences follow — notifications (deduplicated), stock (only after
 *      inspection), money (lib/server/refunds/payments.ts, only from
 *      'approved').
 *
 * A route never writes a case itself; it calls runStaffCommand or
 * runCustomerCommand. A call straight at the API gets exactly the checks the
 * console's buttons get.
 */

export type WorkflowResult =
  | { ok: true; case: CaseRecord; payment?: PaymentSummary; message?: string }
  | { ok: false; status: number; code: string; message: string; payment?: PaymentSummary }

export type PaymentSummary = { status?: string; message?: string; transactionId?: string; amountMinor?: number }

const DAY = 86_400_000
const MONEY: readonly Resolution[] = ['refund', 'return_and_refund']

const fail = (status: number, code: string, message: string, payment?: PaymentSummary): WorkflowResult => ({
  ok: false,
  status,
  code,
  message,
  payment,
})

type StaffActor = Extract<Actor, { type: 'staff' }>

// ------------------------------------------------------------------- apply

type ApplyEvent = { action: string; reason?: string | null; data?: Record<string, unknown>; correlationId?: string; providerRef?: string }

/**
 * refund_case_apply: the only writer of a case row. `expectedVersion` null
 * skips the version check (system consequences of a payment, which must land
 * whatever else changed); the from-state check always applies.
 */
async function apply(
  c: CaseRecord,
  expectedVersion: number | null,
  allowedFrom: readonly CaseState[] | null,
  changes: Record<string, unknown>,
  actor: Actor,
  event: ApplyEvent,
): Promise<CaseRecord | null> {
  const { data, error } = await createAdminClient().rpc('refund_case_apply', {
    p_case_id: c.id,
    p_expected_version: expectedVersion,
    p_allowed_from: allowedFrom,
    p_changes: changes,
    p_event: {
      ...eventActor(actor),
      action: event.action,
      reason: event.reason?.slice(0, 2000) ?? null,
      data: event.data ?? {},
      correlation_id: event.correlationId ?? null,
      provider_ref: event.providerRef ?? null,
    },
  })
  if (error) {
    if (error.message.includes('ITEM_NOT_IN_CASE')) throw new WorkflowRefusal(400, 'item_not_in_case', 'Позиция не относится к заявке')
    throw new Error(`Failed to update case ${c.caseNumber}: ${error.message}`)
  }
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as unknown[]
  if (rows.length === 0) return null
  const fresh = await getCase(c.id)
  if (fresh) await syncOrderSummary(fresh.orderId)
  return fresh
}

class WorkflowRefusal extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const conflict = (): WorkflowResult =>
  fail(409, 'conflict', 'Заявку уже изменили (другой сотрудник или другая вкладка). Обновите страницу.')

/**
 * orders.return_status — the summary every order listing already shows — from
 * all of the order's cases. An open case wins, then an approved one, then a
 * settled one, then a rejection.
 */
export async function syncOrderSummary(orderId: string): Promise<void> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('return_requests')
    .select('state, claim_type, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error(`[refunds] could not read cases for the order summary: ${error.message}`)
    return
  }
  const states = (data ?? []).map((r) => r.state as CaseState)
  const open: CaseState[] = ['requested', 'under_review', 'awaiting_customer_info', 'awaiting_return_shipment', 'return_in_transit', 'return_delivered', 'awaiting_inspection', 'disputed']
  const summary = states.some((s) => open.includes(s))
    ? 'requested'
    : states.some((s) => s === 'approved' || s === 'refund_processing')
      ? 'approved'
      : states.some((s) => s === 'refunded' || s === 'partially_refunded' || s === 'resolved')
        ? 'refunded'
        : states.some((s) => s === 'rejected')
          ? 'rejected'
          : 'none'
  const latest = data?.[0]
  const { error: updateError } = await admin
    .from('orders')
    .update({
      return_status: summary,
      ...(latest ? { return_reason: latest.claim_type, return_requested_at: latest.created_at } : {}),
    })
    .eq('id', orderId)
  if (updateError) console.error(`[refunds] could not update the order's return summary: ${updateError.message}`)
}

async function addMessage(
  c: CaseRecord,
  author: Actor,
  visibility: 'customer' | 'internal',
  body: string,
): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('refund_case_messages')
    .insert({
      case_id: c.id,
      author_type: author.type === 'staff' ? 'staff' : author.type === 'customer' ? 'customer' : 'system',
      author_staff: author.type === 'staff' ? author.staffId : null,
      // What the CUSTOMER sees as the author of a staff message is the shop,
      // not a person (lib/server/refunds/customer-view.ts); the name is kept
      // for the staff's own view.
      author_label: author.label.slice(0, 120),
      visibility,
      body: body.trim().slice(0, 4000),
    })
    .select('id')
    .single()
  if (error) throw new Error(`Failed to save the message: ${error.message}`)
  return data.id as string
}

// ------------------------------------------------------------- money rules

type Line = { itemId: string; qty: number }

function defaultLines(items: CaseItem[], resolution: Resolution): Line[] {
  return items.map((i) => {
    if (resolution === 'return_and_refund') {
      const accepted = i.inspectionOutcome === undefined || i.inspectionOutcome === 'accepted'
      return { itemId: i.id, qty: accepted ? i.qtyReceived : 0 }
    }
    return { itemId: i.id, qty: i.qtyRequested }
  })
}

function validateLines(items: CaseItem[], lines: Line[], resolution: Resolution): string | null {
  const byId = new Map(items.map((i) => [i.id, i]))
  for (const l of lines) {
    const item = byId.get(l.itemId)
    if (!item) return 'Позиция не относится к заявке'
    if (!Number.isInteger(l.qty) || l.qty < 0 || l.qty > item.qtyRequested) return `Некорректное количество для «${item.name}»`
    if (resolution === 'return_and_refund' && l.qty > item.qtyReceived) {
      return `«${item.name}»: к возврату денег — не больше, чем получено обратно (${item.qtyReceived})`
    }
  }
  if (!lines.some((l) => l.qty > 0)) return 'Не выбрано ни одной единицы товара'
  return null
}

function calculate(
  c: CaseRecord,
  items: CaseItem[],
  lines: Line[],
  order: RefundOrderFacts,
  policy: PolicyConfig,
  extra: { deductionMinor?: number; returnPostageMinor?: number; includeShipping?: boolean },
): CalcResult {
  const byId = new Map(items.map((i) => [i.id, i]))
  return calculateRefund({
    order: toCalcOrder(order),
    claimType: c.claimType,
    selection: lines.filter((l) => l.qty > 0).map((l) => ({ orderItemId: byId.get(l.itemId)!.orderItemId, qty: l.qty })),
    policy,
    claimedElsewhere: claimedElsewhere(order),
    shippingAlreadyRefunded: order.shippingAlreadyRefunded,
    committedMinor: order.committedMinor,
    deductionMinor: extra.deductionMinor,
    returnPostageMinor: extra.returnPostageMinor,
    includeShipping: extra.includeShipping,
  })
}

function needsSecondApproval(c: CaseRecord, amountMinor: number, policy: PolicyConfig): boolean {
  if (amountMinor <= 0) return false
  const threshold = policy.approvals.secondApprovalMinor
  if (threshold !== null && threshold !== undefined && amountMinor >= threshold) return true
  return c.riskLevel === 'high' && policy.approvals.highRiskRequiresSecondApproval
}

/** What approving now would refund — shown in the console before the decision. */
export async function previewApproval(
  caseId: string,
  input: { resolution?: Resolution; lines?: Line[]; deductionMinor?: number; returnPostageMinor?: number; includeShipping?: boolean },
): Promise<{ ok: true; calc: CalcResult | null; lines: Line[]; needsSecondApproval: boolean } | { ok: false; message: string }> {
  const c = await getCase(caseId)
  if (!c) return { ok: false, message: 'Заявка не найдена' }
  const resolution = input.resolution ?? c.requestedResolution
  const items = await getCaseItems(c.id)
  const lines = input.lines ?? defaultLines(items, resolution)
  const invalid = validateLines(items, lines, resolution)
  if (invalid) return { ok: false, message: invalid }
  if (!MONEY.includes(resolution)) return { ok: true, calc: null, lines, needsSecondApproval: false }
  const [order, policy] = await Promise.all([loadOrderFacts({ id: c.orderId }, c.id), policyVersion(c.policyVersion ?? 0)])
  if (!order) return { ok: false, message: 'Заказ не найден' }
  try {
    const calc = calculate(c, items, lines, order, policy.config, input)
    return { ok: true, calc, lines, needsSecondApproval: needsSecondApproval(c, calc.totalMinor, policy.config) }
  } catch (e) {
    if (e instanceof CalculationError) return { ok: false, message: calcMessage(e.code) }
    throw e
  }
}

function calcMessage(code: CalculationError['code']): string {
  switch (code) {
    case 'unknown_line':
      return 'Позиция не найдена в заказе'
    case 'invalid_quantity':
      return 'Некорректное количество'
    case 'exceeds_available':
      return 'Эти единицы уже заявлены в другой заявке'
    case 'empty_selection':
      return 'Не выбрано ни одной единицы товара'
  }
}

// ------------------------------------------------------------------- staff

export type StaffInput = Record<string, unknown>

const text = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined)

export async function runStaffCommand(
  caseId: string,
  command: string,
  input: StaffInput,
  actor: StaffActor,
  expectedVersion: number,
): Promise<WorkflowResult> {
  const c = await getCase(caseId)
  if (!c) return fail(404, 'not_found', 'Заявка не найдена')
  const reason = text(input.reason) || text(input.note) || text(input.body) || text(input.message)
  const check = checkTransition({
    command,
    state: c.state,
    actor: 'staff',
    hasPermission: (p: Permission) => can(actor.role, p),
    reason,
  })
  if (!check.ok) {
    const messages: Record<string, string> = {
      unknown_command: 'Неизвестное действие',
      wrong_actor: 'Это действие выполняет не сотрудник',
      forbidden: 'Недостаточно прав для этого действия',
      wrong_state: 'В текущем статусе заявки это действие недоступно',
      reason_required: 'Укажите причину',
    }
    const status = check.reason === 'forbidden' ? 403 : check.reason === 'wrong_state' ? 409 : 400
    return fail(status, check.reason, messages[check.reason])
  }
  if (expectedVersion !== c.version && !['add_note', 'send_message', 'record_evidence', 'check_refund'].includes(command)) {
    return conflict()
  }
  const correlationId = newCorrelationId()
  try {
    return await staffCommand(c, command as Command, input, actor, correlationId)
  } catch (e) {
    if (e instanceof WorkflowRefusal) return fail(e.status, e.code, e.message)
    throw e
  }
}

async function staffCommand(
  c: CaseRecord,
  command: Command,
  input: StaffInput,
  actor: StaffActor,
  correlationId: string,
): Promise<WorkflowResult> {
  const v = c.version
  const from = COMMANDS[command].from
  const now = new Date().toISOString()
  const done = (updated: CaseRecord | null, extra: Partial<Extract<WorkflowResult, { ok: true }>> = {}): WorkflowResult =>
    updated ? { ok: true, case: updated, ...extra } : conflict()

  switch (command) {
    case 'start_review':
      return done(await apply(c, v, from, { state: 'under_review' }, actor, { action: 'case.review_started', correlationId }))

    case 'request_info': {
      const message = text(input.message ?? input.reason, 4000)
      const policy = await policyVersion(c.policyVersion ?? 0)
      const deadline = Date.now() + policy.config.windows.customerResponseDays * DAY
      const updated = await apply(
        c,
        v,
        from,
        { state: 'awaiting_customer_info', customer_deadline_at: new Date(deadline).toISOString() },
        actor,
        { action: 'case.info_requested', reason: message, correlationId },
      )
      if (!updated) return conflict()
      await addMessage(updated, actor, 'customer', message)
      await notifyCustomer(updated, 'info_requested', updated.version, { note: message, deadline })
      return done(updated)
    }

    case 'authorize_return': {
      const policy = await policyVersion(c.policyVersion ?? 0)
      const deadline = Date.now() + policy.config.windows.returnShipmentDays * DAY
      const note = text(input.note)
      const updated = await apply(
        c,
        v,
        from,
        { state: 'awaiting_return_shipment', customer_deadline_at: new Date(deadline).toISOString() },
        actor,
        { action: 'return.authorized', reason: note || null, correlationId },
      )
      if (!updated) return conflict()
      await notifyCustomer(updated, 'return_authorized', updated.version, {
        note: note || undefined,
        deadline,
        instructions: policy.config.returnInstructions,
      })
      return done(updated)
    }

    case 'record_return_shipped': {
      const tracking = text(input.trackingNumber, 64)
      if (tracking.length < 4) return fail(400, 'tracking_required', 'Укажите трек-номер возврата')
      const updated = await apply(
        c,
        v,
        from,
        { state: 'return_in_transit', return_tracking_number: tracking, return_carrier: text(input.carrier, 60) || null, return_shipped_at: now },
        actor,
        { action: 'return.shipped', data: { trackingNumber: tracking }, correlationId },
      )
      if (updated) await reassess(updated, 'возврат отправлен')
      return done(updated)
    }

    case 'mark_return_delivered':
      return done(await apply(c, v, from, { state: 'return_delivered' }, actor, { action: 'return.delivered', correlationId }))

    case 'receive_return': {
      const items = await getCaseItems(c.id)
      const lines = Array.isArray(input.lines) ? (input.lines as { itemId?: unknown; qtyReceived?: unknown }[]) : []
      const byId = new Map(items.map((i) => [i.id, i]))
      const patch: Record<string, unknown>[] = []
      for (const l of lines) {
        const item = byId.get(String(l.itemId))
        const qty = int(l.qtyReceived)
        if (!item || qty === undefined || qty < item.restockedQty || qty > item.qtyRequested) {
          return fail(400, 'invalid_quantity', 'Некорректное полученное количество')
        }
        patch.push({ id: item.id, qty_received: qty })
      }
      if (patch.length === 0) return fail(400, 'invalid_quantity', 'Укажите, что получено')
      const updated = await apply(
        c,
        v,
        from,
        { state: 'awaiting_inspection', return_received_at: now, customer_deadline_at: null, items: patch },
        actor,
        { action: 'return.received', data: { lines: patch }, correlationId },
      )
      if (updated) await notifyCustomer(updated, 'return_received', updated.version)
      return done(updated)
    }

    case 'record_inspection': {
      const items = await getCaseItems(c.id)
      const byId = new Map(items.map((i) => [i.id, i]))
      const lines = Array.isArray(input.lines) ? (input.lines as { itemId?: unknown; outcome?: unknown; note?: unknown }[]) : []
      const patch: Record<string, unknown>[] = []
      const outcomes = new Map<string, InspectionOutcome>()
      for (const l of lines) {
        const item = byId.get(String(l.itemId))
        const outcome = String(l.outcome) as InspectionOutcome
        if (!item || !(INSPECTION_OUTCOMES as readonly string[]).includes(outcome)) {
          return fail(400, 'invalid_inspection', 'Укажите результат проверки по каждой позиции')
        }
        if (outcome === 'accepted' && item.qtyReceived === 0) {
          return fail(400, 'nothing_received', `«${item.name}»: ничего не получено — принять нечего`)
        }
        outcomes.set(item.id, outcome)
        patch.push({ id: item.id, inspection_outcome: outcome, inspection_note: text(l.note, 2000), inspected_by: actor.staffId ?? '' })
      }
      if (patch.length === 0) return fail(400, 'invalid_inspection', 'Укажите результат проверки')
      const finished = items.every((i) => {
        const o = outcomes.get(i.id) ?? i.inspectionOutcome
        return i.qtyReceived === 0 || (o !== undefined && o !== 'further_inspection')
      })
      const updated = await apply(
        c,
        v,
        from,
        { state: finished ? 'under_review' : 'awaiting_inspection', items: patch },
        actor,
        { action: 'inspection.recorded', data: { lines: patch.map((p) => ({ id: p.id, outcome: p.inspection_outcome })) }, correlationId },
      )
      if (!updated) return conflict()
      let message: string | undefined
      if (input.restock === true) {
        const failures = await restockAccepted(updated, actor, correlationId)
        if (failures.length > 0) message = `Не удалось вернуть на склад: ${failures.join(', ')}`
      }
      return done(updated, { message })
    }

    case 'restock': {
      const failures = await restockAccepted(c, actor, correlationId, typeof input.itemId === 'string' ? input.itemId : undefined)
      if (failures.length > 0) return fail(409, 'restock_failed', `Не удалось вернуть на склад: ${failures.join(', ')}`)
      return done(await getCase(c.id))
    }

    case 'approve':
      return approve(c, input, actor, correlationId)

    case 'second_approve':
      return secondApprove(c, input, actor, correlationId)

    case 'withdraw_approval': {
      if (c.refundedAmountMinor > 0) return fail(409, 'money_moved', 'По заявке уже был возврат денег — одобрение не отозвать')
      const items = await getCaseItems(c.id)
      const updated = await apply(
        c,
        v,
        from,
        {
          state: 'under_review',
          approved_resolution: null,
          approved_amount_minor: null,
          approval: null,
          pending_approval: null,
          items: items.map((i) => ({ id: i.id, qty_approved: '' })),
        },
        actor,
        { action: 'case.approval_withdrawn', reason: text(input.reason), correlationId },
      )
      return done(updated)
    }

    case 'reject': {
      const note = text(input.reason)
      const updated = await apply(
        c,
        v,
        from,
        { state: 'rejected', decision_note: note, decided_at: now, closed_at: now, pending_approval: null, customer_deadline_at: null },
        actor,
        { action: 'case.rejected', reason: note, correlationId },
      )
      if (!updated) return conflict()
      const internal = text(input.internalNote, 4000)
      if (internal) await addMessage(updated, actor, 'internal', internal)
      await notifyCustomer(updated, 'rejected', updated.version, { note })
      return done(updated)
    }

    case 'initiate_refund':
      return initiateRefund(c, actor, correlationId)

    case 'record_manual_refund':
      return manualRefund(c, input, actor, correlationId)

    case 'mark_resolved': {
      if (!c.approvedResolution || MONEY.includes(c.approvedResolution)) {
        return fail(409, 'not_a_replacement', 'Отметить решённой можно только замену или повторную отправку')
      }
      const ref = text(input.reference, 120)
      if (ref.length < 3) return fail(400, 'reference_required', 'Укажите трек-номер или номер новой отправки')
      const updated = await apply(c, v, from, { state: 'resolved', resolution_ref: ref, closed_at: now }, actor, {
        action: 'case.resolved',
        data: { reference: ref },
        correlationId,
      })
      if (updated) await notifyCustomer(updated, 'resolved', updated.version, { note: text(input.note) || undefined })
      return done(updated)
    }

    case 'cancel': {
      const note = text(input.reason)
      const updated = await apply(c, v, from, { state: 'cancelled', decision_note: note, closed_at: now, pending_approval: null }, actor, {
        action: 'case.cancelled',
        reason: note,
        correlationId,
      })
      if (updated) await notifyCustomer(updated, 'cancelled', updated.version, { note })
      return done(updated)
    }

    case 'reopen': {
      const blocked = await unitsStillFree(c)
      if (blocked) return fail(409, 'units_claimed', blocked)
      const updated = await apply(c, v, from, { state: 'under_review', closed_at: null }, actor, {
        action: 'case.reopened',
        reason: text(input.reason),
        correlationId,
      })
      if (updated) await notifyCustomer(updated, 'reopened', updated.version)
      return done(updated)
    }

    case 'resolve_dispute':
      return done(await apply(c, v, from, { state: 'under_review' }, actor, { action: 'dispute.resolved', reason: text(input.reason), correlationId }))

    case 'mark_disputed': {
      const ref = text(input.disputeRef, 120)
      return done(
        await apply(c, v, from, { state: 'disputed', dispute_ref: ref || null }, actor, {
          action: 'dispute.opened',
          reason: text(input.reason),
          correlationId,
        }),
      )
    }

    case 'assign': {
      const staffId = input.staffId === null || input.staffId === '' ? null : String(input.staffId)
      if (staffId) {
        const { data, error } = await createAdminClient().from('admin_staff').select('id, active').eq('id', staffId).maybeSingle()
        if (error) throw new Error(`Failed to read staff: ${error.message}`)
        if (!data?.active) return fail(400, 'unknown_staff', 'Сотрудник не найден или отключён')
      }
      return done(await apply(c, v, from, { assigned_to: staffId ?? '' }, actor, { action: 'case.assigned', data: { staffId }, correlationId }))
    }

    case 'escalate':
      return done(
        await apply(c, v, from, { escalated_at: now, escalation_reason: text(input.reason) }, actor, {
          action: 'case.escalated',
          reason: text(input.reason),
          correlationId,
        }),
      )

    case 'de_escalate':
      return done(
        await apply(c, v, from, { escalated_at: '', escalation_reason: null }, actor, {
          action: 'case.de_escalated',
          reason: text(input.reason),
          correlationId,
        }),
      )

    case 'add_note': {
      const body = text(input.body, 4000)
      if (!body) return fail(400, 'empty', 'Пустая заметка')
      const id = await addMessage(c, actor, 'internal', body)
      await audit({ actor, action: 'note.added', caseId: c.id, orderId: c.orderId, data: { messageId: id }, correlationId })
      return done(c)
    }

    case 'send_message': {
      const body = text(input.body, 4000)
      if (!body) return fail(400, 'empty', 'Пустое сообщение')
      const id = await addMessage(c, actor, 'customer', body)
      await audit({ actor, action: 'message.sent', caseId: c.id, orderId: c.orderId, data: { messageId: id }, correlationId })
      await notifyCustomer(c, 'message', id, { note: body })
      return done(c)
    }

    case 'record_evidence': {
      const snapshot = staffSnapshot(input.snapshot)
      if (!snapshot) return fail(400, 'invalid_evidence', 'Нет данных отслеживания')
      await recordTrackingSnapshot({ caseId: c.id, orderId: c.orderId, snapshot, actor, note: text(input.note, 200) || undefined })
      return done(c)
    }

    case 'update_investigation': {
      const status = String(input.status) as InvestigationStatus
      if (!(INVESTIGATION_STATUSES as readonly string[]).includes(status)) return fail(400, 'invalid_status', 'Неизвестный статус расследования')
      const changes: Record<string, unknown> = { investigation_status: status }
      if (typeof input.carrierClaimRef === 'string') changes.carrier_claim_ref = text(input.carrierClaimRef, 120) || null
      if (status !== 'waiting_delivery_window') changes.wait_until = ''
      return done(
        await apply(c, v, from, changes, actor, {
          action: 'investigation.updated',
          reason: text(input.note) || null,
          data: { status, carrierClaimRef: changes.carrier_claim_ref ?? null },
          correlationId,
        }),
      )
    }

    case 'wait_for_delivery': {
      const until = typeof input.until === 'number' ? input.until : (c.waitUntil ?? Date.now() + 5 * DAY)
      if (until <= Date.now()) return fail(400, 'past_date', 'Дата ожидания уже прошла')
      return done(
        await apply(
          c,
          v,
          from,
          { state: 'under_review', wait_until: new Date(until).toISOString(), investigation_status: 'waiting_delivery_window' },
          actor,
          { action: 'investigation.waiting_delivery_window', data: { until }, correlationId },
        ),
      )
    }

    case 'record_finding': {
      const finding = String(input.finding)
      if (!['legitimate', 'not_substantiated', 'abuse_confirmed'].includes(finding)) return fail(400, 'invalid_finding', 'Неизвестный вывод')
      const note = text(input.reason)
      if (note.length < 10) return fail(400, 'reason_required', 'Опишите, на чём основан вывод (не короче 10 символов)')
      return done(
        await apply(c, v, from, { finding, finding_note: note }, actor, { action: 'case.finding_recorded', reason: note, data: { finding }, correlationId }),
      )
    }

    case 'reassess_risk':
      return done(await reassess(c, actor.label, actor, v))

    case 'check_refund':
      return checkRefund(c, actor)

    default:
      return fail(400, 'unsupported', 'Это действие выполняется автоматически')
  }
}

/**
 * A tracking snapshot typed in by staff, from what the carrier's page shows.
 * Its SOURCE is always 'staff' and its time is now, whatever the browser
 * sent: only a real carrier integration may write 'carrier_api', and there
 * is none (docs/refunds/README.md).
 */
function staffSnapshot(raw: unknown): TrackingSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const status = String(r.status) as TrackingSnapshot['status']
  if (!(TRACKING_STATUSES as readonly string[]).includes(status)) return null
  const when = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= Date.now() + DAY ? v : undefined)
  const events: TrackingSnapshot['events'] = []
  for (const e of Array.isArray(r.events) ? (r.events as Record<string, unknown>[]).slice(0, 50) : []) {
    const at = when(e.at)
    const eventStatus = String(e.status) as TrackingSnapshot['status']
    if (at === undefined || !(TRACKING_STATUSES as readonly string[]).includes(eventStatus)) continue
    events.push({ at, status: eventStatus, description: text(e.description, 200) || undefined, location: text(e.location, 120) || undefined })
  }
  return {
    status,
    carrier: text(r.carrier, 60) || undefined,
    trackingNumber: text(r.trackingNumber, 64) || undefined,
    events,
    dispatchedAt: when(r.dispatchedAt),
    deliveredAt: when(r.deliveredAt),
    deliveryLocation: text(r.deliveryLocation, 200) || undefined,
    proofOfDelivery: r.proofOfDelivery === true || undefined,
    signatureObtained: r.signatureObtained === true || undefined,
    exception: text(r.exception, 200) || undefined,
    carrierClaimRef: text(r.carrierClaimRef, 120) || undefined,
    source: 'staff',
    retrievedAt: Date.now(),
  }
}

async function approve(c: CaseRecord, input: StaffInput, actor: StaffActor, correlationId: string): Promise<WorkflowResult> {
  const resolution = String(input.resolution ?? c.requestedResolution) as Resolution
  if (!(RESOLUTIONS as readonly string[]).includes(resolution)) return fail(400, 'invalid_resolution', 'Неизвестное решение')
  const policy = await policyVersion(c.policyVersion ?? 0)
  const rule = claimRule(policy.config, c.claimType)
  const justification = text(input.justification)
  let policyOverride: string | undefined
  if (!rule.allowedResolutions.includes(resolution)) {
    if (justification.length < 10) {
      return fail(400, 'resolution_not_in_policy', 'Это решение не предусмотрено политикой для такого типа заявки — обоснуйте отступление')
    }
    policyOverride = justification
  }
  if (c.riskLevel === 'high' && policy.config.approvals.highRiskRequiresJustification && justification.length < 20) {
    return fail(400, 'justification_required', 'Высокий риск: опишите, почему одобряете (не короче 20 символов)')
  }

  const items = await getCaseItems(c.id)
  const lines = Array.isArray(input.lines)
    ? (input.lines as { itemId?: unknown; qty?: unknown }[]).map((l) => ({ itemId: String(l.itemId), qty: Number(l.qty) }))
    : defaultLines(items, resolution)
  const invalid = validateLines(items, lines, resolution)
  if (invalid) return fail(400, 'invalid_lines', invalid)

  const deductionMinor = int(input.deductionMinor) ?? 0
  const deductionReason = text(input.deductionReason)
  if (deductionMinor > 0 && deductionReason.length < 5) return fail(400, 'deduction_reason', 'Укажите причину удержания (потеря стоимости)')
  const note = text(input.note)

  let amountMinor = 0
  let breakdown: ApprovalBreakdown = {
    itemsMinor: 0,
    shippingMinor: 0,
    returnPostageMinor: 0,
    deductionMinor: 0,
    computedMinor: 0,
    includesShipping: false,
    warnings: [],
    policyOverride,
  }
  if (MONEY.includes(resolution)) {
    const order = await loadOrderFacts({ id: c.orderId }, c.id)
    if (!order) return fail(404, 'order_not_found', 'Заказ не найден')
    let calc: CalcResult
    try {
      calc = calculate(c, items, lines, order, policy.config, {
        deductionMinor,
        returnPostageMinor: int(input.returnPostageMinor),
        includeShipping: typeof input.includeShipping === 'boolean' ? input.includeShipping : undefined,
      })
    } catch (e) {
      if (e instanceof CalculationError) return fail(400, e.code, calcMessage(e.code))
      throw e
    }
    if (calc.totalMinor <= 0) return fail(409, 'nothing_refundable', 'По заказу нечего возвращать')
    const asked = int(input.amountMinor)
    if (asked !== undefined && (asked <= 0 || asked > calc.totalMinor)) {
      return fail(400, 'amount_out_of_range', `Сумма должна быть от 0.01 до ${(calc.totalMinor / 100).toFixed(2)} CHF`)
    }
    amountMinor = asked ?? calc.totalMinor
    const partial = amountMinor < calc.computedMinor || deductionMinor > 0 || amountMinor < (c.requestedAmountMinor ?? 0)
    if (partial && note.length < 10) {
      return fail(400, 'note_required', 'Частичное одобрение: объясните покупателю, почему сумма меньше (не короче 10 символов)')
    }
    breakdown = {
      itemsMinor: calc.itemsMinor,
      shippingMinor: calc.shippingMinor,
      returnPostageMinor: calc.returnPostageMinor,
      deductionMinor: calc.deductionMinor,
      deductionReason: deductionReason || undefined,
      computedMinor: calc.computedMinor,
      includesShipping: calc.includesShipping,
      warnings: calc.warnings,
      policyOverride,
    }
  }

  const itemPatch = items.map((i) => ({ id: i.id, qty_approved: lines.find((l) => l.itemId === i.id)?.qty ?? 0 }))
  if (needsSecondApproval(c, amountMinor, policy.config)) {
    if (actor.legacy || !actor.staffId) {
      return fail(
        409,
        'second_approval_unavailable',
        'Для этой суммы нужно согласование второго сотрудника. Создайте личные учётные записи (Админ → Сотрудники) — с общим входом это невозможно.',
      )
    }
    const pending: PendingApproval = {
      by: actor.staffId,
      byLabel: actor.label,
      at: Date.now(),
      resolution,
      amountMinor,
      lines,
      approval: breakdown,
      note: note || undefined,
      justification: justification || undefined,
    }
    const updated = await apply(c, c.version, COMMANDS.approve.from, { pending_approval: pending }, actor, {
      action: 'case.approval_pending',
      reason: justification || null,
      data: { amountMinor, resolution },
      correlationId,
    })
    if (!updated) return conflict()
    await recordApproval(updated, 'approve', actor, amountMinor, resolution, justification || note)
    await notifyStaff(updated, 'awaiting_second_approval', updated.version, `Первое согласование: ${actor.label}`)
    return { ok: true, case: updated, message: 'Ждёт согласования второго сотрудника' }
  }

  const now = new Date().toISOString()
  const updated = await apply(
    c,
    c.version,
    COMMANDS.approve.from,
    {
      state: 'approved',
      approved_resolution: resolution,
      approved_amount_minor: amountMinor,
      approval: breakdown,
      decision_note: note || null,
      decided_at: now,
      pending_approval: null,
      customer_deadline_at: null,
      wait_until: '',
      items: itemPatch,
    },
    actor,
    { action: 'case.approved', reason: justification || null, data: { amountMinor, resolution, breakdown }, correlationId },
  )
  if (!updated) return conflict()
  await recordApproval(updated, 'approve', actor, amountMinor, resolution, justification || note)
  await notifyCustomer(updated, 'approved', updated.version, { amountMinor: amountMinor || undefined, note: note || undefined })
  return { ok: true, case: updated }
}

async function secondApprove(c: CaseRecord, input: StaffInput, actor: StaffActor, correlationId: string): Promise<WorkflowResult> {
  const pending = c.pendingApproval
  if (!pending) return fail(409, 'nothing_pending', 'Нет одобрения, ожидающего второго согласования')
  if (actor.legacy || !actor.staffId) return fail(409, 'second_approval_unavailable', 'Второе согласование — только из личной учётной записи сотрудника')
  if (pending.by === actor.staffId) return fail(403, 'same_person', 'Второе согласование должен дать другой сотрудник')

  if (pending.amountMinor > 0) {
    const order = await loadOrderFacts({ id: c.orderId }, c.id)
    if (!order) return fail(404, 'order_not_found', 'Заказ не найден')
    if (pending.amountMinor > order.totalMinor - order.committedMinor) {
      return fail(409, 'stale_approval', 'С момента первого одобрения по заказу были возвраты — отзовите и одобрите заново')
    }
  }
  const items = await getCaseItems(c.id)
  const updated = await apply(
    c,
    c.version,
    COMMANDS.second_approve.from,
    {
      state: 'approved',
      approved_resolution: pending.resolution,
      approved_amount_minor: pending.amountMinor,
      approval: pending.approval,
      decision_note: pending.note ?? null,
      decided_at: new Date().toISOString(),
      pending_approval: null,
      customer_deadline_at: null,
      wait_until: '',
      items: items.map((i) => ({ id: i.id, qty_approved: pending.lines.find((l) => l.itemId === i.id)?.qty ?? 0 })),
    },
    actor,
    { action: 'case.second_approved', reason: text(input.note) || null, data: { firstApprover: pending.byLabel, amountMinor: pending.amountMinor }, correlationId },
  )
  if (!updated) return conflict()
  await recordApproval(updated, 'second_approval', actor, pending.amountMinor, pending.resolution, text(input.note))
  await notifyCustomer(updated, 'approved', updated.version, { amountMinor: pending.amountMinor || undefined, note: pending.note })
  return { ok: true, case: updated }
}

async function recordApproval(
  c: CaseRecord,
  kind: 'approve' | 'second_approval',
  actor: StaffActor,
  amountMinor: number,
  resolution: Resolution,
  note: string,
): Promise<void> {
  const { error } = await createAdminClient().from('refund_approvals').insert({
    case_id: c.id,
    kind,
    staff_id: actor.staffId,
    staff_label: actor.label,
    amount_minor: amountMinor,
    resolution,
    note: note || null,
  })
  // The decision is already recorded (and audited) on the case; this table is
  // the convenient list. Logged loudly rather than reported as a failed decision.
  if (error) console.error(`[refunds] approval row for ${c.caseNumber} not written: ${error.message}`)
}

// ---------------------------------------------------------------- payments

function paymentSummary(result: ExecuteResult): PaymentSummary {
  return {
    status: result.row?.status,
    message: result.ok ? undefined : result.message,
    transactionId: result.row?.id,
    amountMinor: result.row?.amountMinor,
  }
}

async function lastApprovals(c: CaseRecord): Promise<{ approvedBy?: string | null; approvedByLabel?: string; secondApprovedBy?: string | null }> {
  const { data, error } = await createAdminClient()
    .from('refund_approvals')
    .select('kind, staff_id, staff_label')
    .eq('case_id', c.id)
    .order('created_at', { ascending: false })
    .limit(2)
  if (error) {
    console.error(`[refunds] could not read approvals for ${c.caseNumber}: ${error.message}`)
    return {}
  }
  const second = data?.find((a) => a.kind === 'second_approval')
  const first = data?.find((a) => a.kind === 'approve')
  return {
    approvedBy: (first?.staff_id as string | null) ?? null,
    approvedByLabel: (first?.staff_label as string | undefined) ?? undefined,
    secondApprovedBy: (second?.staff_id as string | null) ?? null,
  }
}

async function initiateRefund(c: CaseRecord, actor: StaffActor, correlationId: string): Promise<WorkflowResult> {
  if (!c.approvedResolution || !MONEY.includes(c.approvedResolution)) {
    return fail(409, 'not_a_refund', 'По этой заявке одобрена не выплата денег')
  }
  const amountMinor = (c.approvedAmountMinor ?? 0) - c.refundedAmountMinor
  if (amountMinor <= 0) return fail(409, 'nothing_to_refund', 'Одобренная сумма уже возвращена')

  // The claim: approved → refund_processing, on the version the button was
  // pressed on. Two presses, two tabs, two staff: one wins, one is told.
  const claimed = await apply(c, c.version, ['approved'], { state: 'refund_processing' }, actor, {
    action: 'refund.initiated',
    data: { amountMinor },
    correlationId,
  })
  if (!claimed) return conflict()

  const order = await loadOrderFacts({ id: c.orderId })
  if (!order) return fail(404, 'order_not_found', 'Заказ не найден')
  const result = await executeRefund({
    order,
    amountMinor,
    caseId: c.id,
    source: 'case',
    reason: `Case ${c.caseNumber}`,
    actor,
    ...(await lastApprovals(c)),
    idempotencyKey: `case:${c.id}:v${claimed.version}`,
    correlationId,
  })
  return afterPayment(claimed, result, actor, correlationId)
}

async function manualRefund(c: CaseRecord, input: StaffInput, actor: StaffActor, correlationId: string): Promise<WorkflowResult> {
  if (!c.approvedResolution || !MONEY.includes(c.approvedResolution)) {
    return fail(409, 'not_a_refund', 'По этой заявке одобрена не выплата денег')
  }
  const reference = text(input.reference, 200)
  if (reference.length < 3) return fail(400, 'reference_required', 'Укажите реквизиты выплаты (хэш транзакции, номер перевода)')
  const amountMinor = (c.approvedAmountMinor ?? 0) - c.refundedAmountMinor
  if (amountMinor <= 0) return fail(409, 'nothing_to_refund', 'Одобренная сумма уже возвращена')
  const order = await loadOrderFacts({ id: c.orderId })
  if (!order) return fail(404, 'order_not_found', 'Заказ не найден')
  if (order.paymentProvider === 'stripe') {
    return fail(409, 'card_payment', 'Карточный платёж возвращается только через Stripe — кнопкой «Вернуть деньги»')
  }
  const claimed = await apply(c, c.version, ['approved'], { state: 'refund_processing' }, actor, {
    action: 'refund.manual_started',
    data: { amountMinor, reference },
    correlationId,
  })
  if (!claimed) return conflict()
  const result = await recordManualRefund({
    order,
    amountMinor,
    caseId: c.id,
    reference,
    note: text(input.reason) || `Manual payout for ${c.caseNumber}`,
    actor,
    ...(await lastApprovals(c)),
    idempotencyKey: `case:${c.id}:v${claimed.version}:manual`,
    correlationId,
  })
  return afterPayment(claimed, result, actor, correlationId)
}

/** What the payment's outcome means for the case, right after the call. */
async function afterPayment(c: CaseRecord, result: ExecuteResult, actor: Actor, correlationId: string): Promise<WorkflowResult> {
  const payment = paymentSummary(result)
  if (result.row) {
    const updated = await applyLedgerOutcome(result.row, actor, correlationId)
    const fresh = updated ?? (await getCase(c.id)) ?? c
    if (result.ok) return { ok: true, case: fresh, payment }
    if (result.code === 'in_progress') return { ok: true, case: fresh, payment, message: result.message }
    return { ok: false, status: 502, code: result.code, message: result.message, payment }
  }
  // Nothing reserved — refused before any money could move. Back to approved.
  await apply(c, null, ['refund_processing'], { state: 'approved' }, actor, {
    action: 'refund.not_started',
    reason: result.ok ? null : result.message,
    data: { code: result.ok ? null : result.code },
    correlationId,
  })
  return fail(409, result.ok ? 'unknown' : result.code, result.ok ? '' : result.message, payment)
}

/**
 * The case's side of a ledger row's latest status — from the console, the
 * webhook, or the sweep. Idempotent: a status the case already reflects
 * changes nothing.
 */
export async function applyLedgerOutcome(row: LedgerRow, actor: Actor, correlationId?: string): Promise<CaseRecord | null> {
  if (!row.caseId) {
    if (row.status === 'succeeded') await afterOrderLevelRefund(row)
    return null
  }
  const c = await getCase(row.caseId)
  if (!c) return null

  if (row.status === 'succeeded' && c.state === 'refund_processing') {
    const target: CaseState =
      c.approvedAmountMinor !== undefined && c.requestedAmountMinor !== undefined && c.approvedAmountMinor < c.requestedAmountMinor
        ? 'partially_refunded'
        : 'refunded'
    const updated = await apply(c, null, ['refund_processing'], { state: target, closed_at: new Date().toISOString() }, actor, {
      action: 'case.settled',
      data: { transactionId: row.id, amountMinor: row.amountMinor },
      correlationId,
      providerRef: row.providerRefundId,
    })
    if (updated) {
      const event: CustomerEvent = target === 'refunded' ? 'refunded' : 'partially_refunded'
      await notifyCustomer(updated, event, `tx:${row.id}`, { amountMinor: updated.refundedAmountMinor, note: updated.decisionNote })
      await afterCaseRefund(updated)
    }
    return updated
  }

  if ((row.status === 'pending' || row.status === 'requires_action') && c.state === 'refund_processing') {
    await notifyCustomer(c, 'refund_sent', `tx:${row.id}`, { amountMinor: row.amountMinor })
    return c
  }

  if (row.status === 'unknown' && c.state === 'refund_processing') {
    await notifyStaff(c, 'refund_unknown', `tx:${row.id}:${row.attempts}`, row.failureMessage)
    return c
  }

  if (row.status === 'failed' || row.status === 'canceled') {
    if (c.state === 'refund_processing') {
      const updated = await apply(c, null, ['refund_processing'], { state: 'approved' }, actor, {
        action: 'refund.failed',
        reason: row.failureMessage ?? row.failureCode ?? null,
        data: { transactionId: row.id, failureCode: row.failureCode },
        correlationId,
        providerRef: row.providerRefundId,
      })
      if (updated && row.failureCode !== 'released_by_staff') {
        await notifyStaff(updated, 'refund_failed', `tx:${row.id}`, row.failureMessage ?? row.failureCode)
      }
      return updated
    }
    if ((c.state === 'refunded' || c.state === 'partially_refunded') && row.settledAt) {
      // Failed AFTER succeeding: the money is back with the shop.
      const updated = await apply(
        c,
        null,
        ['refunded', 'partially_refunded'],
        {
          state: 'approved',
          closed_at: null,
          escalated_at: new Date().toISOString(),
          escalation_reason: 'Возврат отменён банком после успешного проведения — выплатите другим способом',
        },
        actor,
        { action: 'refund.reversed', reason: row.failureMessage ?? row.failureCode ?? null, data: { transactionId: row.id }, correlationId },
      )
      if (updated) await notifyStaff(updated, 'refund_reversed', `tx:${row.id}`, row.failureMessage ?? row.failureCode)
      return updated
    }
  }
  return c
}

/**
 * A case's money is back with the customer. A cancellation before dispatch
 * puts its units back on sale (they never left); for everything else stock
 * moves only after inspection. A fully refunded order loses any referral
 * reward it earned, as before.
 */
async function afterCaseRefund(c: CaseRecord): Promise<void> {
  const order = await loadOrderFacts({ id: c.orderId })
  if (!order) return
  if (order.paymentStatus === 'refunded') {
    if (!order.shippedAt && c.claimType === 'cancel_before_dispatch') await restoreUnshippedStock(order.number)
    await reverseReferralReward(order.number).catch((e) => console.error('[refunds] referral reversal failed:', e))
  }
}

/** A refund not tied to a case (the order screen, the fraud guard). */
async function afterOrderLevelRefund(row: LedgerRow): Promise<void> {
  const order = await loadOrderFacts({ id: row.orderId })
  if (!order) return
  // A refund made in the Stripe dashboard was not the shop's message to send.
  if (row.source !== 'external') await notifyOrderRefunded(order.number, row.id)
  if (order.paymentStatus !== 'refunded') return
  // The whole order came back before it left: its units were never shipped.
  if (!order.shippedAt) await restoreUnshippedStock(order.number)
  await reverseReferralReward(order.number).catch((e) => console.error('[refunds] referral reversal failed:', e))
}

async function restoreUnshippedStock(orderNumber: string): Promise<void> {
  const { error } = await createAdminClient().rpc('restore_order_stock', { p_order_number: orderNumber })
  if (error && error.code !== 'PGRST202') {
    console.error(`[refunds] restock of unshipped order ${orderNumber} failed: ${error.message}`)
  }
}

/** "Check status": asks Stripe about the case's in-flight refund. */
async function checkRefund(c: CaseRecord, actor: StaffActor): Promise<WorkflowResult> {
  const { data, error } = await createAdminClient()
    .from('refund_transactions')
    .select('id')
    .eq('case_id', c.id)
    .in('status', ['pending_submission', 'submitted', 'unknown', 'pending', 'requires_action'])
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to read the case's refunds: ${error.message}`)
  if (!data) return { ok: true, case: c, message: 'Незавершённых возвратов нет' }
  const row = await ledgerRow(data.id as string)
  if (!row) return { ok: true, case: c }
  const result = await reconcileRow(row, actor)
  const updated = result.row ? await applyLedgerOutcome(result.row, actor) : null
  return { ok: true, case: updated ?? (await getCase(c.id)) ?? c, payment: paymentSummary(result), message: result.ok ? undefined : result.message }
}

/** Releases a reservation Stripe holds no refund for (staff, with a reason). */
export async function releaseStuckRefund(transactionId: string, actor: StaffActor, reason: string): Promise<WorkflowResult> {
  const row = await ledgerRow(transactionId)
  if (!row) return fail(404, 'not_found', 'Возврат не найден')
  const result = await cancelStuckReservation(row, actor, reason)
  const updated = result.row ? await applyLedgerOutcome(result.row, actor) : null
  if (!result.ok) return fail(409, result.code, result.message, paymentSummary(result))
  const c = row.caseId ? (updated ?? (await getCase(row.caseId))) : null
  return c ? { ok: true, case: c, payment: paymentSummary(result) } : fail(200, 'released', 'Резерв снят', paymentSummary(result))
}

// ------------------------------------------------------------------- stock

async function restockAccepted(c: CaseRecord, actor: StaffActor, correlationId: string, onlyItemId?: string): Promise<string[]> {
  const items = await getCaseItems(c.id)
  const failures: string[] = []
  for (const item of items) {
    if (onlyItemId && item.id !== onlyItemId) continue
    if (item.inspectionOutcome !== 'accepted' || item.restockedQty >= item.qtyReceived) continue
    const { error } = await createAdminClient().rpc('restock_return_item', { p_item_id: item.id, p_target_qty: item.qtyReceived })
    if (error) {
      failures.push(item.name)
      console.error(`[refunds] restock of ${item.id} failed: ${error.message}`)
      continue
    }
    await audit({
      actor,
      action: 'stock.restocked',
      caseId: c.id,
      orderId: c.orderId,
      data: { itemId: item.id, product: item.productSlug, size: item.size, color: item.color, units: item.qtyReceived - item.restockedQty },
      correlationId,
    })
  }
  if (onlyItemId && !items.some((i) => i.id === onlyItemId)) failures.push('позиция не найдена')
  if (failures.length > 0) await notifyStaff(c, 'restock_failed', `${c.version}:${failures.join(',')}`, failures.join(', '))
  return failures
}

/** A reopened or appealed case takes its units back — if nobody else has. */
async function unitsStillFree(c: CaseRecord): Promise<string | null> {
  if (!['rejected', 'cancelled', 'expired'].includes(c.state)) return null
  const [items, order] = await Promise.all([getCaseItems(c.id), loadOrderFacts({ id: c.orderId }, c.id)])
  if (!order) return 'Заказ не найден'
  for (const item of items) {
    const line = order.lines.find((l) => l.orderItemId === item.orderItemId)
    if (!line || line.claimedQty + item.qtyRequested > line.qty) {
      return `«${item.name}» уже заявлен в другой заявке — открыть эту нельзя`
    }
  }
  return null
}

// -------------------------------------------------------------------- risk

/** Runs the risk engine again and records the result on the case. */
export async function reassess(c: CaseRecord, by: string, actor?: Actor, expectedVersion: number | null = null): Promise<CaseRecord | null> {
  const [items, order, policy] = await Promise.all([
    getCaseItems(c.id),
    loadOrderFacts({ id: c.orderId }, c.id),
    policyVersion(c.policyVersion ?? 0),
  ])
  if (!order) return c
  const result = await assessAndStore(c, items, order, policy, by)
  const changed = result.level !== c.riskLevel || result.score !== c.riskScore
  if (!changed && expectedVersion === null) return c
  const updated = await apply(
    c,
    expectedVersion,
    null,
    { risk_level: result.level, risk_score: result.score },
    actor ?? { type: 'system', label: 'risk engine' },
    { action: 'risk.assessed', data: { score: result.score, level: result.level, rules: result.hits.map((h) => h.rule) } },
  )
  if (updated && result.level === 'high' && c.riskLevel !== 'high') {
    await notifyStaff(updated, 'high_risk', `risk:${updated.version}`, result.hits.map((h) => h.rule).join(', '))
  }
  return updated
}

// ---------------------------------------------------------------- customer

export type CustomerActor = Extract<Actor, { type: 'customer' }>

export async function runCustomerCommand(
  caseId: string,
  command: string,
  input: Record<string, unknown>,
  customer: CustomerActor,
): Promise<WorkflowResult> {
  const c = await getCase(caseId)
  // Not theirs looks exactly like not there.
  if (!c || !c.userId || c.userId !== customer.userId) return fail(404, 'not_found', 'Not found')
  const reason = text(input.reason) || text(input.message) || text(input.body)
  const check = checkTransition({ command, state: c.state, actor: 'customer', reason })
  if (!check.ok) {
    const status = check.reason === 'wrong_state' ? 409 : 400
    return fail(status, check.reason, check.reason === 'reason_required' ? 'Please give a reason.' : 'This action is not available for this request now.')
  }
  const correlationId = newCorrelationId()
  const from = COMMANDS[command as Command].from
  const now = new Date().toISOString()
  try {
    switch (command as Command) {
      case 'provide_info': {
        const message = text(input.message, 4000)
        if (!message) return fail(400, 'empty', 'Please write your answer.')
        const updated = await apply(c, null, from, { state: 'under_review', customer_deadline_at: '' }, customer, {
          action: 'case.info_provided',
          correlationId,
        })
        if (!updated) return conflict()
        await addMessage(updated, customer, 'customer', message)
        await notifyStaff(updated, 'customer_replied', updated.version)
        return { ok: true, case: updated }
      }
      case 'add_return_tracking': {
        const tracking = text(input.trackingNumber, 64)
        if (!/^[A-Za-z0-9 .\-]{4,64}$/.test(tracking)) return fail(400, 'tracking_invalid', 'Please enter the tracking number from your receipt.')
        const updated = await apply(
          c,
          null,
          from,
          {
            state: 'return_in_transit',
            return_tracking_number: tracking,
            return_carrier: text(input.carrier, 60) || null,
            return_shipped_at: now,
            customer_deadline_at: '',
          },
          customer,
          { action: 'return.shipped', data: { trackingNumber: tracking }, correlationId },
        )
        if (!updated) return conflict()
        await reassess(updated, 'return tracking added')
        return { ok: true, case: (await getCase(c.id)) ?? updated }
      }
      case 'withdraw': {
        const updated = await apply(c, null, from, { state: 'cancelled', closed_at: now, customer_deadline_at: '' }, customer, {
          action: 'case.withdrawn',
          correlationId,
        })
        if (updated) await notifyCustomer(updated, 'cancelled', updated.version)
        return updated ? { ok: true, case: updated } : conflict()
      }
      case 'appeal': {
        const policy = await policyVersion(c.policyVersion ?? 0)
        if (c.appealCount >= 1) return fail(409, 'appeal_used', 'A review has already been requested for this request.')
        const decidedAt = c.decidedAt ?? c.stateChangedAt
        if (Date.now() > decidedAt + policy.config.windows.appealDays * DAY) {
          return fail(409, 'appeal_window_closed', 'The time to ask for a review has passed. Please contact us.')
        }
        const blocked = await unitsStillFree(c)
        if (blocked) return fail(409, 'units_claimed', 'These items are part of another request.')
        // The customer's words go in the message (deleted with the case),
        // not the append-only trail.
        const updated = await apply(c, null, from, { state: 'under_review', appeal_count: c.appealCount + 1, closed_at: '' }, customer, {
          action: 'case.appealed',
          correlationId,
        })
        if (!updated) return conflict()
        await addMessage(updated, customer, 'customer', reason)
        await notifyCustomer(updated, 'appeal_received', updated.version)
        await notifyStaff(updated, 'appeal', updated.version, reason)
        return { ok: true, case: updated }
      }
      case 'customer_message': {
        const body = text(input.body, 4000)
        if (!body) return fail(400, 'empty', 'Please write a message.')
        const id = await addMessage(c, customer, 'customer', body)
        await audit({ actor: customer, action: 'message.received', caseId: c.id, orderId: c.orderId, data: { messageId: id }, correlationId })
        await notifyStaff(c, 'customer_replied', id)
        return { ok: true, case: c }
      }
      default:
        return fail(400, 'unsupported', 'This action is not available.')
    }
  } catch (e) {
    if (e instanceof WorkflowRefusal) return fail(e.status, e.code, e.message)
    throw e
  }
}

// ------------------------------------------------------------------ system

const SYSTEM: Actor = { type: 'system', label: 'system' }

/** Customer deadlines that passed: the case expires (the sweep). */
export async function expireOverdue(limit = 50): Promise<number> {
  const { data, error } = await createAdminClient()
    .from('return_requests')
    .select('id')
    .in('state', ['awaiting_customer_info', 'awaiting_return_shipment'])
    .lt('customer_deadline_at', new Date().toISOString())
    .limit(limit)
  if (error) throw new Error(`Failed to find overdue cases: ${error.message}`)
  let expired = 0
  for (const row of data ?? []) {
    const c = await getCase(row.id as string)
    if (!c) continue
    const updated = await apply(c, c.version, COMMANDS.expire.from, { state: 'expired', closed_at: new Date().toISOString() }, SYSTEM, {
      action: 'case.expired',
    })
    if (updated) {
      expired++
      await notifyCustomer(updated, 'expired', updated.version)
    }
  }
  return expired
}

/** Non-delivery claims whose delivery window has now closed. */
export async function endDeliveryWaits(limit = 50): Promise<number> {
  const { data, error } = await createAdminClient()
    .from('return_requests')
    .select('id')
    .not('wait_until', 'is', null)
    .lt('wait_until', new Date().toISOString())
    .in('state', ['requested', 'under_review'])
    .limit(limit)
  if (error) throw new Error(`Failed to find finished delivery waits: ${error.message}`)
  let ended = 0
  for (const row of data ?? []) {
    const c = await getCase(row.id as string)
    if (!c) continue
    const updated = await apply(
      c,
      c.version,
      ['requested', 'under_review'],
      { state: 'under_review', wait_until: '', investigation_status: c.investigationStatus === 'waiting_delivery_window' ? 'open' : c.investigationStatus },
      SYSTEM,
      { action: 'investigation.delivery_window_closed' },
    )
    if (updated) {
      ended++
      await notifyStaff(updated, 'delivery_wait_over', updated.version)
    }
  }
  return ended
}

/** Open cases past the decision SLA are escalated once. */
export async function escalateOverdue(decisionDays: number, limit = 50): Promise<number> {
  const { data, error } = await createAdminClient()
    .from('return_requests')
    .select('id')
    .in('state', ['requested', 'under_review', 'awaiting_inspection', 'return_delivered'])
    .is('escalated_at', null)
    .is('wait_until', null)
    .lt('created_at', new Date(Date.now() - decisionDays * DAY).toISOString())
    .limit(limit)
  if (error) throw new Error(`Failed to find overdue cases: ${error.message}`)
  let escalated = 0
  for (const row of data ?? []) {
    const c = await getCase(row.id as string)
    if (!c) continue
    const reason = `Нет решения дольше ${decisionDays} дней`
    const updated = await apply(c, c.version, COMMANDS.escalate.from, { escalated_at: new Date().toISOString(), escalation_reason: reason }, SYSTEM, {
      action: 'case.escalated',
      reason,
    })
    if (updated) {
      escalated++
      await notifyStaff(updated, 'sla_breach', 'sla')
    }
  }
  return escalated
}

/** A chargeback on an order: its open cases are marked disputed. */
export async function markOrderDisputed(orderId: string, disputeRef: string, reason: string): Promise<number> {
  const { data, error } = await createAdminClient()
    .from('return_requests')
    .select('id')
    .eq('order_id', orderId)
    .in('state', COMMANDS.mark_disputed.from as unknown as string[])
  if (error) throw new Error(`Failed to read cases for the dispute: ${error.message}`)
  let marked = 0
  for (const row of data ?? []) {
    const c = await getCase(row.id as string)
    if (!c) continue
    const updated = await apply(c, null, COMMANDS.mark_disputed.from, { state: 'disputed', dispute_ref: disputeRef }, { type: 'provider', label: 'Stripe' }, {
      action: 'dispute.opened',
      reason,
      providerRef: disputeRef,
    })
    if (updated) {
      marked++
      await notifyStaff(updated, 'disputed', disputeRef, reason)
    }
  }
  return marked
}

