/**
 * Whether the shop may take NEW orders and NEW payments — the launch gate.
 *
 * Selling is a business act, not a deployment side effect. Before the owner
 * has worked through the launch checklist (OWNER_APPROVAL_CHECKLIST.md:
 * lawful products, the seller's identity, payment-provider acceptance,
 * backups, rotated credentials), a deploy must not start taking money. So the
 * gate is CLOSED until two things are true:
 *
 *  1. SALES_ENABLED=true — the owner's explicit decision, set in the hosting
 *     environment. Nothing in the code sets it, and no default turns it on.
 *  2. The seller's identity is configured (config/business.ts). Swiss law
 *     (UWG art. 3(1)(s)) requires an online seller to say who they are and
 *     where; selling with an incomplete Imprint is the defect this prevents.
 *
 * WHAT IT STOPS: placing an order, starting a card payment, starting a crypto
 * payment, and the emails that ask a customer to come back and buy
 * (abandoned-cart and unpaid-order reminders, back-in-stock alerts).
 *
 * WHAT IT NEVER STOPS: anything about money that has already moved or an
 * order that already exists — payment webhooks, the owner's reconciliation,
 * refunds, cancellations, returns, order pages, support. Closing the shop
 * must not strand a customer who has paid.
 *
 * ENFORCED IN PRODUCTION BUILDS ONLY (NODE_ENV=production), which includes
 * Vercel previews and a local `next start`: set SALES_ENABLED there too when
 * a sandbox checkout is to be tested. `next dev` and the unit tests are not
 * gated, so development is not blocked by an environment variable.
 *
 * Pure: the caller passes the environment and the missing identity fields,
 * so this is testable without a server (tests/store/sales-gate.test.ts).
 */

export type SalesBlocker =
  /** SALES_ENABLED is not "true": the owner has not opened the shop. */
  | 'not_enabled'
  /** The seller's name or postal address is not configured. */
  | 'seller_identity'

export type SalesGate = {
  /** True when new orders and payments are accepted. */
  open: boolean
  /** False outside production builds, where the gate is reported but not applied. */
  enforced: boolean
  /** Every reason the gate is (or, unenforced, would be) closed. */
  blockers: SalesBlocker[]
  /** The identity variables still missing, for the console. */
  missingIdentity: string[]
}

export type SalesGateEnv = {
  NODE_ENV?: string
  SALES_ENABLED?: string
}

/** Only the literal word: "1", "yes" or a stray value never opens the shop. */
export function salesEnabledFlag(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true'
}

export function evaluateSalesGate(env: SalesGateEnv, missingIdentity: string[]): SalesGate {
  const blockers: SalesBlocker[] = []
  if (!salesEnabledFlag(env.SALES_ENABLED)) blockers.push('not_enabled')
  if (missingIdentity.length > 0) blockers.push('seller_identity')
  const enforced = env.NODE_ENV === 'production'
  return {
    open: !enforced || blockers.length === 0,
    enforced,
    blockers,
    missingIdentity,
  }
}

/** The stable code every refusal carries; the browser shows its own words. */
export const SALES_CLOSED_CODE = 'SALES_CLOSED'
