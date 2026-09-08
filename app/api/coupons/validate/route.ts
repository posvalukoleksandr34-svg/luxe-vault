import { NextResponse, type NextRequest } from 'next/server'
import { applyCoupon } from '@/lib/server/coupons'
import { enforceLimit } from '@/lib/server/rate-limit'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Previews a discount code without consuming it.
 *
 * `commit` is deliberately NOT accepted from the request. A redemption is
 * spent exactly once, by repriceItems() at order creation — if this endpoint
 * could consume, anyone could exhaust a single-use code by typing it into the
 * cart, and a customer who abandoned checkout would lose theirs.
 *
 * Throttled because it is an oracle: without a limit, a script can discover
 * every valid code in the table by trying strings.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('coupon.validate', request)
  if (limited) return limited

  let body: { code?: unknown; subtotal?: unknown; productSlugs?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!code) return NextResponse.json({ ok: false, reason: 'NOT_FOUND' })

  // The subtotal is only used to evaluate a minimum-order rule and to size a
  // percentage. It is not trusted for anything that reaches an order: the
  // discount is recomputed from the catalogue at checkout.
  const subtotal = Number(body.subtotal)
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return NextResponse.json({ error: 'Invalid subtotal' }, { status: 400 })
  }

  const productSlugs = Array.isArray(body.productSlugs)
    ? body.productSlugs.filter((s): s is string => typeof s === 'string').slice(0, 50)
    : []

  const userId = (await getCurrentUser())?.id

  const result = await applyCoupon(code, subtotal, { userId, productSlugs, commit: false })

  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason })

  // The coupon's id is deliberately not returned — the browser has no use for
  // it and it is an internal identifier.
  return NextResponse.json({ ok: true, code: result.code, discount: result.discount })
}
