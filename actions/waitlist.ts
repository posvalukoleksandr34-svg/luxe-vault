'use server'

import { headers } from 'next/headers'
import { checkLimit } from '@/lib/server/rate-limit'
import { addToWaitlist, type WaitlistError } from '@/lib/server/waitlist'
import { isValidEmail } from '@/lib/validation'
import { getCurrentUser } from '@/lib/supabase/server'

export type JoinWaitlistInput = {
  /** The product's slug (Product.id in the storefront). */
  productId: string
  /** product_variants.id, when the page has it. */
  variantId?: string
  /** Otherwise the variant is found by size + colour. */
  size?: string
  color?: string
  /** Ignored for a signed-in customer — their account address is used. */
  email?: string
}

export type JoinWaitlistResult =
  | { ok: true; already: boolean }
  | { ok: false; error: WaitlistError | 'RATE_LIMITED' }

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/**
 * "Notify me when it is back" — adds the address to public.waitlist.
 *
 * A Server Action is a public POST endpoint like any route, so everything
 * that arrives is checked as a route would check it:
 *  - the email is the SESSION's for a signed-in customer, and only taken from
 *    the form for a guest — otherwise this would be a way to make the shop
 *    email a stranger;
 *  - it is throttled (the same 'stock.alert' budget as /api/stock-alerts),
 *    because it ends in an email and an unbounded version is a queue anyone
 *    can fill;
 *  - the variant must exist, belong to the product, and be sold out
 *    (lib/server/waitlist.ts).
 */
export async function joinWaitlist(input: JoinWaitlistInput): Promise<JoinWaitlistResult> {
  const productId = str(input?.productId, 120)
  const variantId = str(input?.variantId, 36) || undefined
  const size = str(input?.size, 40)
  const color = str(input?.color, 60)
  if (!productId || (!variantId && (!size || !color))) return { ok: false, error: 'UNKNOWN_VARIANT' }

  let user: Awaited<ReturnType<typeof getCurrentUser>> = null
  try {
    user = await getCurrentUser()
  } catch {
    // No session or auth unreachable: treated as a guest.
  }
  const email = user?.email ?? str(input?.email, 254)
  // Before the rate limit: a mistyped address costs the customer nothing.
  if (!isValidEmail(email)) return { ok: false, error: 'INVALID_EMAIL' }

  const h = headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || 'unidentified'
  const limit = await checkLimit('stock.alert', ip)
  if (!limit.allowed) return { ok: false, error: 'RATE_LIMITED' }

  return addToWaitlist({ productSlug: productId, variantId, size, color, email, userId: user?.id })
}
