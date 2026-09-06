import Stripe from 'stripe'
import type { Order } from '@/lib/types'

/**
 * Stripe Checkout integration.
 *
 * Server-only. The secret key must never reach the browser, which is why
 * there is no NEXT_PUBLIC_ variant here: Checkout is a hosted redirect, so the
 * client never needs a publishable key at all — it only follows the session
 * URL this module returns. That is also why there is no Stripe.js bundle to
 * ship.
 *
 * Required environment variables:
 *   STRIPE_SECRET_KEY       sk_test_… / sk_live_…
 *   STRIPE_WEBHOOK_SECRET   whsec_…  (from `stripe listen` or the dashboard)
 *   NEXT_PUBLIC_SITE_URL    used to build absolute success/cancel URLs
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

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://luxe-vault.store').replace(/\/$/, '')
}

/**
 * Creates a hosted Checkout session for an order that already exists in
 * Postgres.
 *
 * The order is built first and the session second, deliberately: an abandoned
 * checkout then leaves a real `pending_payment` order the customer can settle
 * later from their account, instead of vanishing.
 *
 * Line items are rebuilt from the stored order rather than from anything the
 * client sends, so a tampered request cannot change what is charged. The
 * discount is applied as a single negative-value adjustment is not possible in
 * Checkout, so a discounted order is sent as one aggregated line instead —
 * see below.
 */
export async function createCheckoutSession(
  order: Order,
  options: { customerId?: string; saveCard?: boolean } = {},
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe()
  const base = siteUrl()

  // With no discount, each product gets its own line so the customer sees an
  // itemised page. With a discount, Checkout has no per-session "take X off
  // the total" primitive that does not require a pre-registered coupon, so the
  // order is charged as a single line whose amount is the authoritative
  // `order.total`. Either way the sum charged equals order.total exactly.
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
    order.discount > 0
      ? [
          {
            quantity: 1,
            price_data: {
              currency: STRIPE_CURRENCY,
              unit_amount: toMinorUnits(order.total),
              product_data: {
                name: `LUXE VAULT — ${order.id}`,
                description: `${order.items.length} item(s), discount applied`,
              },
            },
          },
        ]
      : order.items.map((item) => ({
          quantity: item.qty,
          price_data: {
            currency: STRIPE_CURRENCY,
            unit_amount: toMinorUnits(item.price),
            product_data: {
              name: item.name || 'LUXE VAULT',
              // Size and colour are what distinguish two lines of the same
              // product on the Stripe receipt.
              ...(item.size || item.color
                ? { description: [item.size, item.color].filter(Boolean).join(' · ') }
                : {}),
            },
          },
        }))

  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    // The lookup token is what lets the return page read the order without a
    // session; it is already a per-order secret.
    success_url: `${base}/order/${order.id}?token=${order.lookupToken ?? ''}&paid=1`,
    cancel_url: `${base}/order/${order.id}?token=${order.lookupToken ?? ''}&cancelled=1`,
    // A Customer is required to save a card, and to offer previously saved
    // cards back. Passing both `customer` and `customer_email` is an error, so
    // the email is only sent when there is no customer to attach to.
    ...(options.customerId
      ? { customer: options.customerId }
      : { customer_email: order.customer.email || undefined }),
    // Tells Stripe to keep the PaymentMethod on the Customer after this
    // payment. THIS is what "save my card" means — the card is stored by
    // Stripe, and this app never sees the number.
    ...(options.customerId && options.saveCard
      ? { payment_intent_data: { setup_future_usage: 'off_session' as const } }
      : {}),
    // Shows any card already saved on the Customer as a one-click option.
    ...(options.customerId ? { saved_payment_method_options: { payment_method_save: 'enabled' as const } } : {}),
    client_reference_id: order.id,
    // Echoed back on the webhook event. This is how the handler finds the
    // order without trusting anything in the browser's return URL.
    metadata: { orderId: order.id },
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
