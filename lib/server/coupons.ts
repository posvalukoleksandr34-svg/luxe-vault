import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Coupon validation and redemption.
 *
 * Replaces SEED_PROMOS in lib/data.ts — two percentage codes in a TypeScript
 * array with no expiry, no usage limit, no minimum order and no scoping, that
 * needed a deploy to change. See migration 0015.
 *
 * Every decision is made by Postgres, for the same reason prices are: a
 * discount is money, and the browser must not be able to name its own. The
 * redemption counter is incremented under a row lock so two people racing for
 * the last use of a single-use code cannot both win.
 */

/** Stable reasons from redeem_coupon(). Translated in the UI — the storefront
 *  speaks five languages, so the database never returns prose. */
export type CouponRejection =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'BELOW_MINIMUM'
  | 'EXHAUSTED'
  | 'NOT_APPLICABLE'

export type CouponResult =
  | { ok: true; discount: number; couponId: string; code: string }
  | { ok: false; reason: CouponRejection }

/**
 * Checks a code and computes its discount.
 *
 * `commit` distinguishes the two moments a coupon is looked at:
 *
 *   false — the customer typed a code into the cart and wants to see what it
 *           does. Burning a redemption here would exhaust a single-use code
 *           before anything was bought.
 *   true  — the order is being created. This is the only call that consumes.
 */
export async function applyCoupon(
  code: string,
  subtotal: number,
  options: { userId?: string; productSlugs?: string[]; commit?: boolean } = {},
): Promise<CouponResult> {
  const normalised = code.trim().toUpperCase()
  if (!normalised) return { ok: false, reason: 'NOT_FOUND' }

  const { data, error } = await createAdminClient().rpc('redeem_coupon', {
    p_code: normalised,
    p_subtotal: subtotal,
    p_user_id: options.userId ?? null,
    p_product_slugs: options.productSlugs ?? [],
    p_commit: options.commit ?? false,
  })

  if (error) {
    // Missing function means migration 0015 has not been applied. Refusing the
    // code is the safe direction: an unrecognised coupon costs a customer a
    // discount, whereas granting one on a failed check costs real money.
    console.error('[coupons] redeem_coupon failed:', error.message)
    return { ok: false, reason: 'NOT_FOUND' }
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { ok: false, reason: 'NOT_FOUND' }

  if (!row.ok) return { ok: false, reason: row.reason as CouponRejection }

  return {
    ok: true,
    discount: Number(row.discount) || 0,
    couponId: row.coupon_id as string,
    code: normalised,
  }
}
