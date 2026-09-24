import Stripe from 'stripe'
import {
  BASE_CURRENCY,
  CARD_CURRENCIES,
  chargeAmount,
  fromMinorUnits,
  isCardCurrency,
  isCurrencyCode,
  roundMinor,
  toMinorUnits,
  type CardCurrencyCode,
  type CurrencyCode,
  type ExchangeRates,
} from '@/lib/currency'
import { getExchangeRates } from '@/lib/server/exchange-rates'
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
 *
 * Optional:
 *   STRIPE_PRESENTMENT_CURRENCIES        e.g. "CHF,EUR" — see chargeCurrencies()
 */

const SECRET_KEY = process.env.STRIPE_SECRET_KEY?.trim()
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET?.trim()

/**
 * The currencies a card may be charged in.
 *
 * Prices are stored in CHF and converted (lib/currency.ts); these are the
 * PRESENTMENT currencies — what the customer's card is debited in. Stripe
 * settles them into the account's own currency. STRIPE_PRESENTMENT_CURRENCIES
 * (comma-separated) narrows the list, e.g. while a currency is not enabled on
 * the account; unset, every currency the shop displays is accepted. CHF is
 * always included: every price is in francs, and it is the fallback.
 */
export function chargeCurrencies(): CardCurrencyCode[] {
  const raw = process.env.STRIPE_PRESENTMENT_CURRENCIES?.trim()
  if (!raw) return CARD_CURRENCIES
  const listed = raw
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(isCardCurrency)
  return listed.indexOf(BASE_CURRENCY) === -1 ? [BASE_CURRENCY].concat(listed) : listed
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

export type PreparedPayment =
  | {
      ok: true
      intent: Stripe.PaymentIntent
      /** What the card will be charged in… */
      currency: CardCurrencyCode
      /** …and how much, in major units, rounded to the cent. */
      amount: number
      /** Units of `currency` per 1 CHF behind `amount`. */
      rate: number
      /** The currency the customer asked for. */
      requested: CurrencyCode
      /** True when it could not be honoured and the charge is in CHF. */
      fellBack: boolean
    }
  | { ok: false; reason: 'already_paid' }

type Charge =
  | { ok: true; intent: Stripe.PaymentIntent; currency: CardCurrencyCode; amount: number; rate: number }
  | { ok: false; reason: 'already_paid' }

/**
 * Stripe refusing the currency itself — not enabled on the account, or no
 * payment method on it that takes that currency. Worth retrying in CHF;
 * anything else is a real failure and is re-thrown.
 */
function isCurrencyRejection(error: unknown): boolean {
  const e = error as { type?: string; param?: string; message?: string } | null
  return Boolean(
    e &&
      e.type === 'StripeInvalidRequestError' &&
      (e.param === 'currency' || /currenc/i.test(e.message ?? '')),
  )
}

async function retrieveIntent(id: string): Promise<Stripe.PaymentIntent | null> {
  try {
    return await getStripe().paymentIntents.retrieve(id)
  } catch (error) {
    // Gone — deleted, or minted under the other key mode: start afresh. Any
    // other failure is re-thrown, because creating a second intent while the
    // first might still be payable is exactly what the caller must avoid.
    if ((error as { code?: string } | null)?.code === 'resource_missing') return null
    throw error
  }
}

/**
 * Prices the order's PaymentIntent in `currency` — creating it, or re-pricing
 * the one it already has.
 *
 * ONE INTENT PER ORDER. The order's existing intent is updated in place
 * whenever Stripe allows it (it is still waiting for a payment method, for the
 * same customer). Minting a fresh one each time — as before — left the old one
 * confirmable: pay it from a second tab, or after switching currency, and the
 * money arrived against an intent the order no longer pointed at, so the
 * webhook could never mark it paid. When an intent cannot be updated it is
 * cancelled first; one that has already taken money stops everything.
 */
async function chargeIn(
  order: Order,
  currency: CardCurrencyCode,
  options: { customerId?: string; saveCard?: boolean },
  rates: ExchangeRates,
): Promise<Charge> {
  const stripe = getStripe()
  const rate = rates[currency]
  // Converted from the STORED order total, never from anything the client
  // sends: the request carries a currency code, not a figure. `rates` is the
  // live snapshot — the same one /api/rates gives the storefront.
  const amount = chargeAmount(order.total, currency, rates)
  const saveCard = Boolean(options.customerId && options.saveCard)

  const priced = {
    amount: toMinorUnits(amount),
    currency: currency.toLowerCase(),
    ...(order.customer.email ? { receipt_email: order.customer.email } : {}),
    // Echoed back on every webhook event for this payment. orderId is how the
    // handler ties a payment to an order without trusting the browser; the
    // rest records the conversion next to the charge, for reconciliation in
    // the Stripe dashboard.
    metadata: {
      orderId: order.id,
      baseCurrency: BASE_CURRENCY,
      baseAmount: order.total.toFixed(2),
      fxRate: String(rate),
      // Who is paying, as typed at checkout, so the Stripe dashboard shows the
      // buyer next to the charge. An order placed before checkout asked for the
      // two halves separately has only the full name; the keys are then left
      // out rather than guessed. The order in Postgres stays the source of
      // truth — the webhook reads the name from there, not from here.
      ...(order.customer.firstName && order.customer.lastName
        ? { firstName: order.customer.firstName, lastName: order.customer.lastName }
        : { customerName: order.customer.name }),
    },
    description: `LUXE VAULT ${order.id}`,
  }

  const existing =
    order.paymentProvider === 'stripe' && order.paymentId
      ? await retrieveIntent(order.paymentId)
      : null

  if (existing) {
    if (
      existing.status === 'succeeded' ||
      existing.status === 'processing' ||
      existing.status === 'requires_capture'
    ) {
      return { ok: false, reason: 'already_paid' }
    }

    const existingCustomer =
      typeof existing.customer === 'string' ? existing.customer : existing.customer?.id
    if (
      existing.status === 'requires_payment_method' &&
      (existingCustomer ?? undefined) === (options.customerId ?? undefined)
    ) {
      const intent = await stripe.paymentIntents.update(existing.id, {
        ...priced,
        // Scoped to the card, never intent-wide — see the note on create.
        // '' clears a "remember this card" chosen on an earlier attempt.
        payment_method_options: {
          card: { setup_future_usage: saveCard ? 'off_session' : '' },
        },
        // Clears an intent-wide value left by an intent minted BEFORE the move
        // to per-method scoping. Without this, an order that was already
        // waiting to be paid would keep showing a card-only Element for the
        // rest of its life.
        setup_future_usage: '',
      })
      return { ok: true, intent, currency, amount, rate }
    }

    if (existing.status !== 'canceled') {
      const cancelled = await cancelPaymentIntent(existing.id)
      if (!cancelled.ok) {
        if (cancelled.reason === 'captured') return { ok: false, reason: 'already_paid' }
        throw new Error(cancelled.message)
      }
    }
  }

  const intent = await stripe.paymentIntents.create({
    ...priced,
    // Lets Stripe decide which methods to show in the Element based on what is
    // enabled on the account and what suits the currency, instead of
    // hard-coding a list here that would drift from the dashboard. (TWINT,
    // for one, takes only CHF, and simply is not offered for EUR or USD.)
    automatic_payment_methods: { enabled: true },
    ...(options.customerId ? { customer: options.customerId } : {}),
    // "Remember this card" — Stripe keeps the PaymentMethod on the Customer
    // once the payment succeeds. Requires a customer, hence the guard.
    //
    // Scoped to the CARD rather than set intent-wide, which is what the
    // top-level `setup_future_usage` would do. An intent-wide value marks the
    // whole payment as non-one-time, and Stripe then filters the Element down
    // to methods that can be saved: Klarna's instalment plans disappear (its
    // docs say so outright), and the tab strip can lose Klarna and Amazon Pay
    // entirely. Per-method, ticking "remember this card" changes the card and
    // nothing else.
    ...(saveCard
      ? { payment_method_options: { card: { setup_future_usage: 'off_session' as const } } }
      : {}),
  })
  return { ok: true, intent, currency, amount, rate }
}

/**
 * The PaymentIntent for an order that already exists in Postgres, priced in
 * the customer's chosen currency, for the caller to hand its client secret to
 * the browser.
 *
 * Replaces the old hosted Checkout Session. The difference that matters: the
 * card form now renders inside our own page via Stripe Elements, so the
 * customer never leaves the site. The security properties are unchanged —
 * card data still goes straight from the browser to Stripe and never touches
 * this server, because PaymentElement is a cross-origin iframe.
 *
 * The amount is taken from the STORED order, never from anything the client
 * sends, so a tampered request cannot change what is charged. The currency is
 * the customer's choice, checked against chargeCurrencies(); a currency not
 * on that list — or one Stripe refuses — is charged in CHF instead, and
 * `fellBack` says so, for the payment step to tell the customer before they
 * pay.
 *
 * The client secret is not a bearer token for the account: it authorises
 * confirming this one payment and reading its status, nothing else. It is
 * still per-order and must only be returned to someone who proved they own
 * the order.
 */
export async function preparePaymentIntent(
  order: Order,
  options: { customerId?: string; saveCard?: boolean; currency?: unknown } = {},
): Promise<PreparedPayment> {
  const asked = typeof options.currency === 'string' ? options.currency.trim().toUpperCase() : ''
  const requested: CurrencyCode = isCurrencyCode(asked) ? asked : BASE_CURRENCY
  // USDT is display-only: it is never a card currency, so it falls back to
  // francs here and the response says so (`fellBack`).
  const target: CardCurrencyCode =
    isCardCurrency(requested) && chargeCurrencies().indexOf(requested) !== -1 ? requested : BASE_CURRENCY
  const { rates } = await getExchangeRates()

  let charge: Charge
  try {
    charge = await chargeIn(order, target, options, rates)
  } catch (error) {
    if (target === BASE_CURRENCY || !isCurrencyRejection(error)) throw error
    console.warn(`[stripe] ${target} refused for ${order.id}; charging ${BASE_CURRENCY} instead`)
    charge = await chargeIn(order, BASE_CURRENCY, options, rates)
  }

  if (!charge.ok) return charge
  return { ...charge, requested, fellBack: charge.currency !== requested }
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
 * `amount` is in the ORDER's units — CHF, like Order.total — and is converted
 * here twice over: into the currency the card was charged in, at `rate`
 * (units of that currency per franc, as the payment was made — see
 * orderChargeRate), and into minor units. A CHF 100 refund of a euro payment
 * made at 1.07 returns EUR 107.00; passing 49.9 straight to Stripe would have
 * refunded 0.49 of whatever the card was charged in. Omit it for a full
 * refund of whatever remains. `amountRefunded` comes back in CHF too.
 *
 * The remaining balance is computed from Stripe's own ledger
 * (amount_received - amount_refunded) rather than from our database, so two
 * concurrent refund requests cannot together return more than was charged:
 * Stripe rejects the second.
 */
export async function refundPayment(
  paymentIntentId: string,
  amount?: number,
  rate = 1,
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

    let requested = amount === undefined ? remaining : toMinorUnits(amount * rate)
    if (requested <= 0) return { ok: false, message: 'Refund amount must be greater than zero.' }
    // Converting a franc amount can land one cent above what is left (the
    // conversion rounds up where the charge rounded down). That cent is
    // rounding, not an over-refund.
    if (rate !== 1 && requested === remaining + 1) requested = remaining
    if (requested > remaining) {
      return {
        ok: false,
        message: `Refund exceeds the remaining balance (${fromMinorUnits(remaining).toFixed(2)} ${intent.currency.toUpperCase()}).`,
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
      // Back to CHF major units for the caller, which stores and displays them.
      amountRefunded: roundMinor(fromMinorUnits(requested) / rate),
      fullyRefunded: requested === remaining,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Stripe error' }
  }
}
