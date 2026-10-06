// What is left of the referral programme (migrations 0036, 0041).
//
// The programme was switched off in October 2026: no codes, links, invites
// or discounts any more, and nothing in the account or the admin. Its tables
// stay, as the record of what was earned and paid.
//
// Two hooks remain, for orders placed BEFORE the switch-off with a friend's
// code: when such an order is paid, the referrer's reward is still granted —
// the friend had the discount, the promise was made — and when it is
// cancelled or refunded, a reward is reversed. After the last of those
// orders is settled both are no-ops: the database functions only act on a
// referral already attached to that order number.
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

// Postgres "undefined table/function" and PostgREST "not in the schema cache".
const MISSING = new Set(['42P01', '42883', 'PGRST202', 'PGRST205'])

function isMissing(error: { code?: string } | null): boolean {
  return Boolean(error?.code && MISSING.has(error.code))
}

/** The reward last set in the admin (referral_settings), else the launch
 *  default the programme ran on before that table existed. */
async function rewardAmount(): Promise<number> {
  const fallback = Math.min(1000, Math.max(0, Number(process.env.NEXT_PUBLIC_REFERRAL_REWARD) || 50))
  const { data, error } = await createAdminClient()
    .from('referral_settings')
    .select('referrer_reward_amount')
    .eq('id', true)
    .maybeSingle()
  if (error || !data) return fallback
  const amount = Number(data.referrer_reward_amount)
  return Number.isFinite(amount) ? amount : fallback
}

/** A referred order from before the switch-off was paid: credit the
 *  referrer. Idempotent; never throws. */
export async function grantReferralReward(orderNumber: string): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc('grant_referral_reward', {
      p_order_number: orderNumber,
      p_amount: await rewardAmount(),
    })
    if (error && !isMissing(error)) console.error(`[referrals] reward for ${orderNumber} failed:`, error.message)
  } catch (e) {
    console.error('[referrals] reward failed:', e)
  }
}

/** The order was cancelled, expired or refunded. Idempotent; never throws. */
export async function reverseReferralReward(orderNumber: string): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc('reverse_referral_reward', { p_order_number: orderNumber })
    if (error && !isMissing(error)) console.error(`[referrals] reversal for ${orderNumber} failed:`, error.message)
  } catch (e) {
    console.error('[referrals] reversal failed:', e)
  }
}
