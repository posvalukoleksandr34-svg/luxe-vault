'use server'

import { headers } from 'next/headers'
import { captureCheckoutCart, type CaptureOutcome } from '@/lib/server/abandoned-cart-flow'
import { checkLimit } from '@/lib/server/rate-limit'

export type LogAbandonedCheckoutInput = {
  email: string
  /** The cart lines as the storefront holds them; re-validated server-side. */
  items: unknown[]
  locale: string
}

/**
 * Logs an unfinished checkout for the abandoned-cart reminder — called by the
 * checkout (components/checkout-flow.tsx) once the email field holds a valid
 * address and the cart is not empty. The reminder itself is sent later, by
 * runAbandonedCartReminders(), once the cart has been idle for
 * ABANDONED_CART_DELAY_MINUTES.
 *
 * A Server Action is a public POST endpoint like any route, so it is treated
 * as one: rate-limited per client (the same budget as the legacy route), the
 * cross-site guard in middleware.ts applies, and every line is re-validated
 * against the catalogue (captureCheckoutCart). The outcome is returned only
 * as a coarse status — it never says whether an address is already known.
 */
export async function logAbandonedCheckout(input: LogAbandonedCheckoutInput): Promise<CaptureOutcome | 'rate_limited'> {
  const h = headers()
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || 'unidentified'
  const limit = await checkLimit('cart.capture', ip)
  if (!limit.allowed) return 'rate_limited'

  const outcome = await captureCheckoutCart({
    email: input?.email,
    items: input?.items,
    locale: input?.locale,
  })
  // Whether it was stored is not the caller's business.
  return outcome === 'invalid_email' ? 'invalid_email' : 'captured'
}
