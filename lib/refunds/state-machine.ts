import type { Permission } from '@/lib/refunds/permissions'
import { CASE_STATES, type CaseState } from '@/lib/refunds/types'

/**
 * The refund case state machine.
 *
 * NOT A STATUS DROPDOWN. Nobody sets a state: they issue a COMMAND ("approve",
 * "record the return as received"), and this table says from which states
 * that command may be issued, by whom, and where it leads. The server looks
 * the command up here before anything is written, and the write itself
 * (refund_case_apply, migration 0059) repeats the from-state check atomically
 * against the version the decision was made on — so neither a crafted request
 * nor two people clicking at once can move a case somewhere the table does not
 * allow.
 *
 * Each entry also records what the transition touches — the customer
 * (notification), stock, money — which the README's transition table is
 * generated from and the services rely on.
 */

export type ActorKind = 'customer' | 'staff' | 'system' | 'provider'

export type CommandDef = {
  /** States the command may be issued from. */
  from: readonly CaseState[]
  /** Where it leads. `null`: no state change (a note, an assignment). A
   *  function: the target depends on the command's input or outcome. */
  to: CaseState | null | 'computed'
  actors: readonly ActorKind[]
  /** Required of a staff actor. */
  permission?: Permission
  /** Issued by hand or by the system. */
  automatic: boolean
  /** The customer is told. */
  notifies: boolean
  /** Changes stock. */
  inventory: boolean
  /** Moves or commits money. */
  payment: boolean
  /** A reason is mandatory. */
  requiresReason: boolean
  /** One line for the README and the audit log. */
  summary: string
}

/** Every state a case is still being worked in. */
export const OPEN_STATES: readonly CaseState[] = [
  'requested',
  'under_review',
  'awaiting_customer_info',
  'awaiting_return_shipment',
  'return_in_transit',
  'return_delivered',
  'awaiting_inspection',
  'approved',
  'refund_processing',
  'disputed',
]

/** Open, and nothing irreversible is in motion. */
const DECIDABLE: readonly CaseState[] = [
  'requested',
  'under_review',
  'awaiting_customer_info',
  'awaiting_return_shipment',
  'return_in_transit',
  'return_delivered',
  'awaiting_inspection',
]

const def = (d: Partial<CommandDef> & Pick<CommandDef, 'from' | 'to' | 'actors' | 'summary'>): CommandDef => ({
  automatic: false,
  notifies: false,
  inventory: false,
  payment: false,
  requiresReason: false,
  ...d,
})

export const COMMANDS = {
  // ------------------------------------------------------------ customer --
  provide_info: def({
    from: ['awaiting_customer_info'],
    to: 'under_review',
    actors: ['customer'],
    summary: 'The customer answers an information request.',
  }),
  add_return_tracking: def({
    from: ['awaiting_return_shipment'],
    to: 'return_in_transit',
    actors: ['customer'],
    summary: 'The customer reports the return parcel sent, with its tracking number.',
  }),
  withdraw: def({
    from: ['requested', 'under_review', 'awaiting_customer_info', 'awaiting_return_shipment'],
    to: 'cancelled',
    actors: ['customer'],
    notifies: true,
    summary: 'The customer withdraws the request.',
  }),
  appeal: def({
    from: ['rejected'],
    to: 'under_review',
    actors: ['customer'],
    requiresReason: true,
    summary: 'The customer asks for a rejection to be reviewed again (once, within the appeal window).',
  }),
  customer_message: def({
    from: OPEN_STATES,
    to: null,
    actors: ['customer'],
    summary: 'The customer writes on the case.',
  }),

  // ---------------------------------------------------------------- staff --
  start_review: def({
    from: ['requested'],
    to: 'under_review',
    actors: ['staff'],
    permission: 'case.triage',
    summary: 'Staff take the case up.',
  }),
  request_info: def({
    from: ['requested', 'under_review', 'awaiting_inspection'],
    to: 'awaiting_customer_info',
    actors: ['staff'],
    permission: 'case.triage',
    notifies: true,
    requiresReason: true,
    summary: 'Staff ask the customer for something specific, with a deadline.',
  }),
  authorize_return: def({
    from: ['requested', 'under_review'],
    to: 'awaiting_return_shipment',
    actors: ['staff'],
    permission: 'case.decide',
    notifies: true,
    summary: 'Staff authorise the return and send instructions, with a deadline to ship.',
  }),
  record_return_shipped: def({
    from: ['awaiting_return_shipment'],
    to: 'return_in_transit',
    actors: ['staff'],
    permission: 'case.return',
    summary: 'Staff record a return tracking number the customer sent another way.',
  }),
  mark_return_delivered: def({
    from: ['awaiting_return_shipment', 'return_in_transit'],
    to: 'return_delivered',
    actors: ['staff'],
    permission: 'case.return',
    summary: 'The carrier shows the return delivered to the shop.',
  }),
  receive_return: def({
    from: ['awaiting_return_shipment', 'return_in_transit', 'return_delivered'],
    to: 'awaiting_inspection',
    actors: ['staff'],
    permission: 'case.return',
    notifies: true,
    summary: 'Staff count what arrived; it waits for inspection.',
  }),
  record_inspection: def({
    // Also after a decision: an item approved before it was inspected still
    // has to be inspected before it can go back on sale.
    from: ['awaiting_inspection', 'under_review', 'approved', 'refund_processing', 'partially_refunded', 'refunded', 'resolved'],
    to: 'computed',
    actors: ['staff'],
    permission: 'case.return',
    inventory: true,
    notifies: true,
    summary: 'Staff record what inspection found, line by line; accepted units can go back on sale.',
  }),
  restock: def({
    from: ['awaiting_inspection', 'under_review', 'approved', 'refund_processing', 'partially_refunded', 'refunded', 'resolved'],
    to: null,
    actors: ['staff'],
    permission: 'case.return',
    inventory: true,
    summary: 'Units that passed inspection go back on sale (never before inspection, never twice).',
  }),
  approve: def({
    from: ['requested', 'under_review', 'awaiting_inspection'],
    to: 'computed',
    actors: ['staff'],
    permission: 'case.decide',
    notifies: true,
    summary: 'A decision: the resolution and the amount. Waits for a second approver when the policy says so.',
  }),
  second_approve: def({
    from: ['requested', 'under_review', 'awaiting_inspection'],
    to: 'approved',
    actors: ['staff'],
    permission: 'refund.second_approve',
    notifies: true,
    summary: 'A different staff member confirms a pending approval.',
  }),
  withdraw_approval: def({
    from: ['requested', 'under_review', 'awaiting_inspection', 'approved'],
    to: 'under_review',
    actors: ['staff'],
    permission: 'case.decide',
    requiresReason: true,
    summary: 'Staff take back an approval (or a pending one) before any money moved.',
  }),
  reject: def({
    from: DECIDABLE,
    to: 'rejected',
    actors: ['staff'],
    permission: 'case.decide',
    notifies: true,
    requiresReason: true,
    summary: 'The request is refused, with an explanation the customer reads.',
  }),
  initiate_refund: def({
    from: ['approved'],
    to: 'refund_processing',
    actors: ['staff'],
    permission: 'refund.execute',
    payment: true,
    notifies: true,
    summary: 'The approved amount is sent to the payment provider.',
  }),
  record_manual_refund: def({
    from: ['approved'],
    to: 'computed',
    actors: ['staff'],
    permission: 'refund.execute',
    payment: true,
    notifies: true,
    requiresReason: true,
    summary: 'Money returned outside any API (a crypto payment): recorded with its reference.',
  }),
  check_refund: def({
    from: ['approved', 'refund_processing'],
    to: null,
    actors: ['staff'],
    permission: 'refund.execute',
    payment: true,
    summary: 'Ask the provider what happened to an in-flight refund, and record it (never sends a second one blind).',
  }),
  mark_resolved: def({
    from: ['approved'],
    to: 'resolved',
    actors: ['staff'],
    permission: 'case.decide',
    notifies: true,
    summary: 'A replacement or reshipment was sent; recorded with its reference.',
  }),
  cancel: def({
    from: DECIDABLE,
    to: 'cancelled',
    actors: ['staff'],
    permission: 'case.decide',
    notifies: true,
    requiresReason: true,
    summary: 'Staff close a case without a decision (duplicate, filed in error, settled elsewhere).',
  }),
  reopen: def({
    from: ['expired', 'cancelled', 'rejected'],
    to: 'under_review',
    actors: ['staff'],
    permission: 'case.decide',
    requiresReason: true,
    summary: 'Staff reopen a closed case.',
  }),
  resolve_dispute: def({
    from: ['disputed'],
    to: 'under_review',
    actors: ['staff'],
    permission: 'case.decide',
    requiresReason: true,
    summary: 'The payment dispute is over; the case is worked again.',
  }),
  assign: def({ from: OPEN_STATES, to: null, actors: ['staff'], permission: 'case.assign', summary: 'Staff assign the case.' }),
  escalate: def({
    from: OPEN_STATES,
    to: null,
    actors: ['staff', 'system'],
    permission: 'case.triage',
    requiresReason: true,
    summary: 'Flagged for senior attention.',
  }),
  de_escalate: def({ from: OPEN_STATES, to: null, actors: ['staff'], permission: 'case.decide', requiresReason: true, summary: 'Escalation cleared.' }),
  add_note: def({
    from: [...OPEN_STATES, 'refunded', 'partially_refunded', 'resolved', 'rejected', 'cancelled', 'expired'],
    to: null,
    actors: ['staff'],
    permission: 'case.note',
    summary: 'An internal note. Never shown to the customer.',
  }),
  send_message: def({ from: OPEN_STATES, to: null, actors: ['staff'], permission: 'case.message', notifies: true, summary: 'A message to the customer.' }),
  record_evidence: def({
    // Any state: a carrier's letter or a chargeback can arrive after the
    // case closed, and the record must be able to hold it.
    from: CASE_STATES,
    to: null,
    actors: ['staff'],
    permission: 'case.triage',
    summary: 'Evidence recorded: a tracking snapshot, a carrier letter, a document.',
  }),
  update_investigation: def({
    from: OPEN_STATES,
    to: null,
    actors: ['staff'],
    permission: 'case.triage',
    summary: 'A non-delivery investigation moves on (carrier claim opened, a result).',
  }),
  wait_for_delivery: def({
    from: ['requested', 'under_review'],
    to: 'under_review',
    actors: ['staff', 'system'],
    permission: 'case.triage',
    notifies: true,
    summary: 'The parcel is still inside its delivery window; the claim waits until it closes.',
  }),
  record_finding: def({
    from: [...OPEN_STATES, 'refunded', 'partially_refunded', 'resolved', 'rejected', 'cancelled', 'expired'],
    to: null,
    actors: ['staff'],
    permission: 'case.decide',
    requiresReason: true,
    summary: 'What staff established about the claim, as distinct from what was alleged.',
  }),
  reassess_risk: def({ from: OPEN_STATES, to: null, actors: ['staff', 'system'], permission: 'case.triage', summary: 'The risk assessment is run again.' }),

  // ------------------------------------------------------- system/provider --
  expire: def({
    from: ['awaiting_customer_info', 'awaiting_return_shipment'],
    to: 'expired',
    actors: ['system'],
    automatic: true,
    notifies: true,
    summary: 'The customer did not answer or ship within the deadline.',
  }),
  end_delivery_wait: def({
    from: ['under_review'],
    to: 'under_review',
    actors: ['system'],
    automatic: true,
    summary: 'The delivery window closed; the non-delivery claim is ready to judge.',
  }),
  settle: def({
    // From refunded / partially_refunded too: a card refund can fail AFTER it
    // succeeded (a closed card account). The money is back with the shop, so
    // the case returns to approved — escalated — for staff to pay it another way.
    from: ['refund_processing', 'refunded', 'partially_refunded'],
    to: 'computed',
    actors: ['provider', 'system', 'staff'],
    automatic: true,
    payment: true,
    notifies: true,
    summary: 'The provider confirms (refunded / partially refunded) or refuses (back to approved) the refund; a later reversal reopens it.',
  }),
  mark_disputed: def({
    from: OPEN_STATES,
    to: 'disputed',
    actors: ['provider', 'staff'],
    permission: 'case.decide',
    automatic: true,
    summary: 'A chargeback was opened on the payment; refunds through the provider stop until it ends.',
  }),
} as const satisfies Record<string, CommandDef>

export type Command = keyof typeof COMMANDS

export type TransitionCheck =
  | { ok: true; def: CommandDef }
  | { ok: false; reason: 'unknown_command' | 'wrong_state' | 'wrong_actor' | 'forbidden' | 'reason_required' }

/**
 * May this actor issue this command to a case in this state? The permission
 * check for staff is separate (the caller knows the role) and passed in.
 */
export function checkTransition(params: {
  command: string
  state: CaseState
  actor: ActorKind
  hasPermission?: (p: Permission) => boolean
  reason?: string | null
}): TransitionCheck {
  const entry = (COMMANDS as Record<string, CommandDef>)[params.command]
  if (!entry) return { ok: false, reason: 'unknown_command' }
  if (!entry.actors.includes(params.actor)) return { ok: false, reason: 'wrong_actor' }
  if (params.actor === 'staff' && entry.permission && !(params.hasPermission?.(entry.permission) ?? false)) {
    return { ok: false, reason: 'forbidden' }
  }
  if (!entry.from.includes(params.state)) return { ok: false, reason: 'wrong_state' }
  if (entry.requiresReason && !(params.reason && params.reason.trim().length >= 3)) {
    return { ok: false, reason: 'reason_required' }
  }
  return { ok: true, def: entry }
}

/** Commands staff could issue on a case in this state (what the console
 *  offers; the server checks again). */
export function availableStaffCommands(state: CaseState, hasPermission: (p: Permission) => boolean): Command[] {
  return (Object.keys(COMMANDS) as Command[]).filter((name) => {
    const entry: CommandDef = COMMANDS[name]
    return (
      entry.actors.includes('staff') &&
      entry.from.includes(state) &&
      (!entry.permission || hasPermission(entry.permission))
    )
  })
}

/** Commands a customer may issue now. */
export function availableCustomerCommands(state: CaseState): Command[] {
  return (Object.keys(COMMANDS) as Command[]).filter((name) => {
    const entry: CommandDef = COMMANDS[name]
    return entry.actors.includes('customer') && entry.from.includes(state)
  })
}
