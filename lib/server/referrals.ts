// The referral programme's server side (migration 0036). Every function here
// is tolerant of the migration not being applied yet: reads report
// `available: false`, and the order hooks log and carry on — a referral must
// never be the reason an order, a payment or a refund fails.
import 'server-only'

import { randomInt } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteUrl } from '@/lib/site-url'
import { getReferralSettings } from '@/lib/server/referral-settings'
import {
  REFERRAL_CODE_RE,
  type ReferralHistoryRow,
  type ReferralOverview,
  type ReferralStatus,
} from '@/lib/referral-program'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Postgres "undefined table/function" and PostgREST "not in the schema cache".
const MISSING = new Set(['42P01', '42883', 'PGRST202', 'PGRST205'])

function isMissing(error: { code?: string } | null): boolean {
  return Boolean(error?.code && MISSING.has(error.code))
}

function newCode(): string {
  let s = 'REF-'
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return s
}

export function normaliseReferralCode(value: string | undefined | null): string | null {
  const code = (value ?? '').trim().toUpperCase()
  return REFERRAL_CODE_RE.test(code) ? code : null
}

export function referralLink(code: string): string {
  return `${getSiteUrl().replace(/\/$/, '')}/r/${code}`
}

/** The customer's code, minted on first request. Null when the tables are
 *  missing or the write failed. */
export async function ensureReferralCode(userId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('referral_codes').select('code').eq('user_id', userId).maybeSingle()
  if (error) {
    if (!isMissing(error)) console.error('[referrals] code lookup failed:', error.message)
    return null
  }
  if (data?.code) return data.code as string

  // A collision on the code (1 in ~10^9 per try) or a concurrent first view
  // (the primary key) both resolve by reading again.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error: insertError } = await supabase.from('referral_codes').insert({ user_id: userId, code: newCode() })
    if (!insertError || insertError.code === '23505') {
      const { data: row } = await supabase.from('referral_codes').select('code').eq('user_id', userId).maybeSingle()
      if (row?.code) return row.code as string
      continue
    }
    console.error('[referrals] code insert failed:', insertError.message)
    return null
  }
  return null
}

export async function referrerForCode(code: string): Promise<string | null> {
  const normalised = normaliseReferralCode(code)
  if (!normalised) return null
  const { data, error } = await createAdminClient()
    .from('referral_codes')
    .select('user_id')
    .eq('code', normalised)
    .maybeSingle()
  if (error) {
    if (!isMissing(error)) console.error('[referrals] code resolve failed:', error.message)
    return null
  }
  return (data?.user_id as string | undefined) ?? null
}

/** A visit through the referral link. Never throws. */
export async function recordReferralClick(referrerId: string): Promise<void> {
  const { error } = await createAdminClient().from('referral_clicks').insert({ referrer_id: referrerId })
  if (error && !isMissing(error)) console.error('[referrals] click insert failed:', error.message)
}

/** True when this buyer has a previous order that stood — not cancelled, not
 *  left unpaid to expire. The discount is for a first order only. */
async function hasPreviousOrder(userId: string | undefined, email: string | undefined): Promise<boolean> {
  const supabase = createAdminClient()
  const filters: string[] = []
  if (userId) filters.push(`user_id.eq.${userId}`)
  const cleanEmail = email?.trim().toLowerCase()
  // Quoted for PostgREST's or() syntax; an address cannot contain a quote
  // that EMAIL_RE-validated checkout would have let through.
  if (cleanEmail && !/["\\,()]/.test(cleanEmail)) filters.push(`customer_email.eq."${cleanEmail}"`)
  if (filters.length === 0) return false

  const { data, error } = await supabase
    .from('orders')
    .select('order_number, status, payment_status')
    .or(filters.join(','))
    .limit(20)
  if (error) {
    console.error('[referrals] order history check failed:', error.message)
    // Unknown history: refuse the discount rather than grant it wrongly.
    return true
  }
  return (data ?? []).some(
    (o) => o.status !== 'cancelled' && o.payment_status !== 'expired' && o.payment_status !== 'failed',
  )
}

export type ReferralCheck =
  | { ok: true; referrerId: string; discount: number }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_APPLICABLE' }

/**
 * Whether this buyer may use a referral code, and what it takes off.
 *
 * Preview (the cart, where the email may not be known yet) checks the code and
 * self-referral. At order creation the email is known, and the first-order and
 * one-referrer-per-friend rules are checked too.
 */
export async function checkReferralCode(
  code: string,
  subtotal: number,
  buyer: { userId?: string; email?: string },
): Promise<ReferralCheck> {
  const referrerId = await referrerForCode(code)
  if (!referrerId) return { ok: false, reason: 'NOT_FOUND' }
  if (buyer.userId && buyer.userId === referrerId) return { ok: false, reason: 'NOT_APPLICABLE' }

  const supabase = createAdminClient()
  const email = buyer.email?.trim().toLowerCase()

  if (email) {
    const { data: referrer } = await supabase.from('profiles').select('email').eq('id', referrerId).maybeSingle()
    if ((referrer?.email as string | undefined)?.toLowerCase() === email) return { ok: false, reason: 'NOT_APPLICABLE' }
  }

  if (buyer.userId || email) {
    if (await hasPreviousOrder(buyer.userId, email)) return { ok: false, reason: 'NOT_APPLICABLE' }

    // Already someone's referral, or already used one.
    const filters = [buyer.userId ? `referee_user_id.eq.${buyer.userId}` : '', email ? `referee_email.eq."${email}"` : '']
      .filter(Boolean)
      .join(',')
    const { data: existing, error } = await supabase
      .from('referrals')
      .select('referrer_id, status')
      .or(filters)
      .limit(2)
    if (error && !isMissing(error)) {
      console.error('[referrals] referee lookup failed:', error.message)
      return { ok: false, reason: 'NOT_APPLICABLE' }
    }
    if ((existing ?? []).some((r) => r.referrer_id !== referrerId || r.status !== 'pending')) {
      return { ok: false, reason: 'NOT_APPLICABLE' }
    }
  }

  // The percentage as the admin set it NOW (/admin/referrals). The cart
  // preview and the order both come through here, so they agree unless the
  // setting changes in between — and then the order uses the new one.
  const { friendDiscountPercent } = await getReferralSettings()
  return { ok: true, referrerId, discount: Math.round(subtotal * friendDiscountPercent) / 100 }
}

/**
 * A signed-in customer who arrived through a referral link: recorded as the
 * referrer's pending invite. Only for new customers — an account older than
 * `maxAgeDays`, or one with an order, is not "invited" by clicking a link.
 */
export async function claimReferral(input: {
  code: string
  userId: string
  email: string
  accountCreatedAt: string | undefined
  maxAgeDays?: number
}): Promise<'claimed' | 'already' | 'ineligible' | 'unavailable'> {
  const referrerId = await referrerForCode(input.code)
  if (!referrerId) return 'ineligible'
  if (referrerId === input.userId) return 'ineligible'

  const created = input.accountCreatedAt ? Date.parse(input.accountCreatedAt) : NaN
  const maxAge = (input.maxAgeDays ?? 7) * 24 * 60 * 60 * 1000
  if (!Number.isFinite(created) || Date.now() - created > maxAge) return 'ineligible'

  const email = input.email.trim().toLowerCase()
  if (await hasPreviousOrder(input.userId, email)) return 'ineligible'

  const { error } = await createAdminClient().from('referrals').insert({
    referrer_id: referrerId,
    referee_user_id: input.userId,
    referee_email: email,
    status: 'pending',
  })
  if (!error) return 'claimed'
  if (error.code === '23505') return 'already'
  if (isMissing(error)) return 'unavailable'
  console.error('[referrals] claim failed:', error.message)
  return 'unavailable'
}

/** Called once the order exists. Never throws. */
export async function attachReferralOrder(input: {
  referrerId: string
  userId?: string
  email: string
  orderNumber: string
}): Promise<void> {
  const { error } = await createAdminClient().rpc('attach_referral_order', {
    p_referrer_id: input.referrerId,
    p_referee_user_id: input.userId ?? null,
    p_referee_email: input.email,
    p_order_number: input.orderNumber,
  })
  if (error) console.error(`[referrals] attach to ${input.orderNumber} failed:`, error.message)
}

/** The friend's order was paid: credit the referrer. Idempotent; never throws.
 *  The amount is the reward in force at the moment of payment, and is stored
 *  on the referral — a later change of the setting does not touch it. */
export async function grantReferralReward(orderNumber: string): Promise<void> {
  try {
    const { referrerRewardAmount } = await getReferralSettings()
    const { error } = await createAdminClient().rpc('grant_referral_reward', {
      p_order_number: orderNumber,
      p_amount: referrerRewardAmount,
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

/** "an•••@g•••.com" — enough to recognise a friend, not enough to harvest. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  const dot = domain.lastIndexOf('.')
  const host = dot > 0 ? domain.slice(0, dot) : domain
  const tld = dot > 0 ? domain.slice(dot) : ''
  const head = local.slice(0, Math.min(2, Math.max(1, local.length - 1)))
  return `${head}•••@${host.slice(0, 1)}•••${tld}`
}

export async function creditBalance(userId: string): Promise<{ available: boolean; balance: number }> {
  const { data, error } = await createAdminClient().from('account_credits').select('amount').eq('user_id', userId)
  if (error) {
    if (!isMissing(error)) console.error('[referrals] balance read failed:', error.message)
    return { available: false, balance: 0 }
  }
  const balance = (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0)
  return { available: true, balance: Math.round(balance * 100) / 100 }
}

export async function referralOverview(userId: string): Promise<ReferralOverview> {
  const code = await ensureReferralCode(userId)
  if (!code) return { available: false }

  const supabase = createAdminClient()
  const [referrals, clicks, credits, settings] = await Promise.all([
    supabase
      .from('referrals')
      .select('id, created_at, referee_email, status, reward_amount')
      .eq('referrer_id', userId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('referral_clicks').select('id', { count: 'exact', head: true }).eq('referrer_id', userId),
    supabase.from('account_credits').select('amount, reason').eq('user_id', userId),
    getReferralSettings(),
  ])

  if (referrals.error || clicks.error || credits.error) {
    const error = referrals.error ?? clicks.error ?? credits.error
    if (!isMissing(error)) console.error('[referrals] overview read failed:', error?.message)
    return { available: false }
  }

  const rows = referrals.data ?? []
  const history: ReferralHistoryRow[] = rows.map((r) => ({
    id: r.id as string,
    friend: maskEmail(r.referee_email as string),
    status: r.status as ReferralStatus,
    date: r.created_at as string,
    reward: r.status === 'reward_paid' ? Number(r.reward_amount) : 0,
  }))

  // Earned from referrals, net of reversals.
  const earned = (credits.data ?? [])
    .filter((c) => c.reason === 'referral_reward' || c.reason === 'referral_reversal')
    .reduce((sum, c) => sum + Number(c.amount), 0)

  return {
    available: true,
    code,
    link: referralLink(code),
    discountPercent: settings.friendDiscountPercent,
    rewardAmount: settings.referrerRewardAmount,
    stats: {
      invited: rows.length,
      clicks: clicks.count ?? 0,
      purchases: rows.filter((r) => r.status === 'reward_paid').length,
      earned: Math.round(earned * 100) / 100,
    },
    history,
  }
}
