import Stripe from 'stripe'
import type { Order } from '@/lib/types'

/**
 * Stripe Checkout integration.
 *
 * Server-only. The secret key must never reach the browser.
 *
 * Since the move from hosted Checkout to embedded Elements, the browser DOES
 * need a publishable key — it is what Stripe.js authenticates with in order to
 * render PaymentElement and confirm the payment. That key is public by design
 * and lives in NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY; see lib/stripe-client.ts.
 *
 * Required environment variables:
 *   STRIPE_SECRET_KEY                    sk_test_… / sk_live_…
 *   STRIPE_WEBHOOK_SECRET                whsec_…  (`stripe listen`/dashboard)
 *   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY   pk_test_… / pk_live_…
 */

const SECRET_KEY = process.env.STRIPE_SECRET_KEY?.trim()
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET?.trim()

/** Currency Stripe charges in. Must match how prices are stored. */
export const STRIPE_CURRENCY = 'chf'

/**
 * Stripe takes amounts in the currency's smallest unit. CHF has two decimal
 * places, so a price of 249.90 has to be sent as 24990 — passing 249.9 would
 * silently charge the customer CHF 2.49.
 */
function toMinorUnits(amount: number): number {
  return Math.round(amount * 100)
}

let client: Stripe | null = null

/**
 * Lazily constructed so that importing this module (which the webhook route
 * does at build time) cannot crash a deployment that has not set the key yet.
 */
export function getStripe(): Stripe {
  if (!SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set')
  }
  if (!client) {
    client = new Stripe(SECRET_KEY, {
      // Pinned rather than floating: an account whose default API version is
      // bumped in the dashboard would otherwise start returning a different
      // payload shape to code that was never redeployed.
      apiVersion: '2026-08-26.dahlia',
      appInfo: { name: 'LUXE VAULT', url: 'https://luxe-vault.store' },
    })
  }
  return client
}

export function isStripeConfigured(): boolean {
  return Boolean(SECRET_KEY)
}

export function isStripeWebhookConfigured(): boolean {
  return Boolean(WEBHOOK_SECRET)
}

/**
 * Creates a PaymentIntent for an order that already exists in Postgres, and
 * returns it so the caller can hand the client secret to the browser.
 *
 * Replaces the old hosted Checkout Session. The difference that matters: the
 * card form now renders inside our own page via Stripe Elements, so the
 * customer never leaves the site. The security properties are unchanged —
 * card data still goes straight from the browser to Stripe and never touches
 * this server, because PaymentElement is a cross-origin iframe.
 *
 * The amount is taken from the STORED order, never from anything the client
 * sends, so a tampered request cannot change what is charged.
 *
 * The client secret is not a bearer token for the account: it authorises
 * confirming this one payment and reading its status, nothing else. It is
 * still per-order and must only be returned to someone who proved they own
 * the order.
 */
export async function createPaymentIntent(
  order: Order,
  options: { customerId?: string; saveCard?: boolean } = {},
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe()

  return stripe.paymentIntents.create({
    amount: toMinorUnits(order.total),
    currency: STRIPE_CURRENCY,
    // Lets Stripe decide which methods to show in the Element based on what is
    // enabled on the account and what suits the currency, instead of
    // hard-coding a list here that would drift from the dashboard.
    automatic_payment_methods: { enabled: true },
    ...(options.customerId ? { customer: options.customerId } : {}),
    // "Remember this card" — Stripe keeps the PaymentMethod on the Customer
    // once the payment succeeds. Requires a customer, hence the guard.
    ...(options.customerId && options.saveCard
      ? { setup_future_usage: 'off_session' as const }
      : {}),
    ...(order.customer.email ? { receipt_email: order.customer.email } : {}),
    // Echoed back on every webhook event for this payment. This is how the
    // handler ties a payment to an order without trusting the browser.
    metadata: { orderId: order.id },
    description: `LUXE VAULT ${order.id}`,
  })
}

/**
 * Verifies a webhook request came from Stripe and returns the parsed event.
 *
 * The raw request body must be passed verbatim — the signature is computed
 * over the exact bytes, so re-serialising a parsed JSON object breaks it.
 * Throws if the signature does not verify; callers must treat that as 400 and
 * change nothing.
 */
export function constructWebhookEvent(rawBody: string, signature: string | null): Stripe.Event {
  if (!WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not set')
  if (!signature) throw new Error('Missing stripe-signature header')
  return getStripe().webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET)
}


/**
 * Finds or creates the Stripe Customer that owns a user's saved cards.
 *
 * Idempotent by construction: the id is written back to `profiles`, so a
 * second checkout reuses the same customer rather than scattering saved cards
 * across duplicates. Callers must pass an id that has already been
 * authenticated — this function does no authorisation of its own.
 */
export async function ensureStripeCustomer(params: {
  existingId?: string | null
  email?: string
  name?: string
  userId: string
}): Promise<string> {
  const stripe = getStripe()
  if (params.existingId) {
    // Verify it still exists: a customer deleted in the Stripe dashboard would
    // otherwise fail every future checkout for this account.
    try {
      const existing = await stripe.customers.retrieve(params.existingId)
      if (!existing.deleted) return params.existingId
    } catch {
      // Fall through and mint a new one.
    }
  }

  const created = await stripe.customers.create({
    email: params.email || undefined,
    name: params.name || undefined,
    metadata: { userId: params.userId },
  })
  return created.id
}

export type SavedCard = {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

/**
 * Lists a customer's saved cards, reduced to the display-only fields.
 *
 * Everything returned here is deliberately non-sensitive: a brand and four
 * digits cannot be used to charge anything. The full PAN is never retrievable
 * through the Stripe API at all.
 */
export async function listSavedCards(customerId: string): Promise<SavedCard[]> {
  const methods = await getStripe().paymentMethods.list({
    customer: customerId,
    type: 'card',
    limit: 20,
  })
  return methods.data
    .filter((m) => m.card)
    .map((m) => ({
      id: m.id,
      brand: m.card!.brand,
      last4: m.card!.last4,
      expMonth: m.card!.exp_month,
      expYear: m.card!.exp_year,
    }))
}

/** Detaches a card from its customer. Verify ownership before calling. */
export async function detachSavedCard(paymentMethodId: string): Promise<void> {
  await getStripe().paymentMethods.detach(paymentMethodId)
}

/**
 * Cancels a PaymentIntent that has not been captured, so it can never be
 * confirmed and charged.
 *
 * Idempotent by design: an intent already in a terminal state is reported as
 * success rather than raised, because the caller's goal ("this must not be
 * chargeable") is already satisfied and a hard failure would leave the order
 * row and Stripe out of step.
 *
 * Returns false only when the intent has actually taken money — that needs a
 * refund, not a cancellation, and silently swallowing it would lose funds.
 */
export async function cancelPaymentIntent(paymentIntentId: string): Promise<
  { ok: true; alreadyTerminal: boolean } | { ok: false; reason: 'captured' | 'error'; message: string }
> {
  const stripe = getStripe()
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId)

    if (intent.status === 'canceled') return { ok: true, alreadyTerminal: true }
    if (intent.status === 'succeeded' || intent.status === 'processing') {
      return {
        ok: false,
        reason: 'captured',
        message: `PaymentIntent is ${intent.status}; refund it instead of cancelling.`,
      }
    }

    await stripe.paymentIntents.cancel(paymentIntentId, {
      cancellation_reason: 'requested_by_customer',
    })
    return { ok: true, alreadyTerminal: false }
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: error instanceof Error ? error.message : 'Stripe error',
    }
  }
}

export type RefundOutcome =
  | { ok: true; refundId: string; amountRefunded: number; fullyRefunded: boolean }
  | { ok: false; message: string }

/**
 * Refunds a captured PaymentIntent, in full or in part.
 *
 * `amount` is in MAJOR units (the same units as Order.total) and is converted
 * here — passing 49.9 where Stripe expects minor units would refund CHF 0.49.
 * Omit it for a full refund of whatever remains.
 *
 * The remaining balance is computed from Stripe's own ledger
 * (amount_received - amount_refunded) rather than from our database, so two
 * concurrent refund requests cannot together return more than was charged:
 * Stripe rejects the second.
 */
export async function refundPayment(
  paymentIntentId: string,
  amount?: number,
): Promise<RefundOutcome> {
  const stripe = getStripe()
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    })

    if (intent.status !== 'succeeded') {
      return { ok: false, message: `PaymentIntent is ${intent.status}, not a captured payment.` }
    }

    const charge = intent.latest_charge
    const alreadyRefunded =
      charge && typeof charge !== 'string' ? charge.amount_refunded : 0
    const remaining = intent.amount_received - alreadyRefunded

    if (remaining <= 0) return { ok: false, message: 'This payment is already fully refunded.' }

    const requested = amount === undefined ? remaining : toMinorUnits(amount)
    if (requested <= 0) return { ok: false, message: 'Refund amount must be greater than zero.' }
    if (requested > remaining) {
      return {
        ok: false,
        message: `Refund exceeds the remaining balance (${(remaining / 100).toFixed(2)} ${intent.currency.toUpperCase()}).`,
      }
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: requested,
      reason: 'requested_by_customer',
      metadata: intent.metadata?.orderId ? { orderId: intent.metadata.orderId } : undefined,
    })

    return {
      ok: true,
      refundId: refund.id,
      // Back to major units for the caller, which stores and displays them.
      amountRefunded: requested / 100,
      fullyRefunded: requested === remaining,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Stripe error' }
  }
}
