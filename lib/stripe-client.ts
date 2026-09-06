import { loadStripe, type Stripe } from '@stripe/stripe-js'

/**
 * Browser-side Stripe.js loader.
 *
 * The publishable key is public by design — it identifies the account and can
 * do nothing but create and confirm payments the server already authorised. It
 * is NOT the secret key, which never leaves the server.
 *
 * loadStripe is called once at module scope rather than inside a component:
 * it injects a <script> tag, and calling it per render would download Stripe.js
 * repeatedly and hand <Elements> a new promise identity on every render, which
 * remounts the iframe and wipes whatever the customer had typed.
 */
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim()

export const stripePromise: Promise<Stripe | null> | null = publishableKey
  ? loadStripe(publishableKey)
  : null

/** False when the key is unset, so the UI can say so instead of failing blank. */
export const isStripeClientConfigured = Boolean(publishableKey)
