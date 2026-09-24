import 'server-only'

import type { ReferralStatus } from '@/lib/referral-program'
import { createAdminClient } from '@/lib/supabase/admin'
import type { OrderStatus, PaymentStatus } from '@/lib/types'

/**
 * The referral programme as /admin/referrals sees it: every invited friend,
 * who invited them, the order that came of it, and whether the referrer's
 * reward has been handed over.
 *
 * Full names and emails, unlike the customer's own page (which masks them):
 * this is the service role reading for the shop's staff, behind the admin
 * gate, and paying someone requires knowing who they are.
 */

export type AdminReferralRow = {
  id: string
  createdAt: string
  referrer: { id: string; name: string; email: string; code: string | null }
  friend: { name: string | null; email: string; hasAccount: boolean }
  status: ReferralStatus
  order: {
    number: string
    status: OrderStatus | null
    paymentStatus: PaymentStatus | null
    total: number | null
  } | null
  reward: number
  rewardedAt: string | null
  paidOutAt: string | null
  payoutNote: string | null
}

export type AdminReferralData =
  | { available: false }
  | {
      available: true
      /** False until migration 0041 adds the payout columns. */
      payoutsEnabled: boolean
      rows: AdminReferralRow[]
    }

const LIMIT = 500

// Undefined table / column, and PostgREST's "not in the schema cache".
const MISSING_TABLE = new Set(['42P01', 'PGRST205'])
const MISSING_COLUMN = new Set(['42703', 'PGRST204'])

type ReferralRecord = {
  id: string
  created_at: string
  referrer_id: string
  referee_user_id: string | null
  referee_email: string
  status: ReferralStatus
  order_number: string | null
  reward_amount: number | string
  rewarded_at: string | null
  paid_out_at?: string | null
  payout_note?: string | null
}

const BASE_COLUMNS =
  'id, created_at, referrer_id, referee_user_id, referee_email, status, order_number, reward_amount, rewarded_at'

export async function listReferralsForAdmin(): Promise<AdminReferralData> {
  const supabase = createAdminClient()

  // With the payout columns first; without them if 0041 is not applied yet,
  // so the table still shows everything 0036 records.
  const read = (columns: string) =>
    supabase.from('referrals').select(columns).order('created_at', { ascending: false }).limit(LIMIT)

  let payoutsEnabled = true
  let result = await read(`${BASE_COLUMNS}, paid_out_at, payout_note`)
  if (result.error && MISSING_COLUMN.has(result.error.code ?? '')) {
    payoutsEnabled = false
    result = await read(BASE_COLUMNS)
  }
  if (result.error) {
    if (!MISSING_TABLE.has(result.error.code ?? '')) {
      console.error('[referral-admin] list failed:', result.error.message)
    }
    return { available: false }
  }

  const records = (result.data ?? []) as unknown as ReferralRecord[]
  if (records.length === 0) return { available: true, payoutsEnabled, rows: [] }

  const userIds = Array.from(
    new Set(records.flatMap((r) => [r.referrer_id, r.referee_user_id].filter((v): v is string => Boolean(v)))),
  )
  const referrerIds = Array.from(new Set(records.map((r) => r.referrer_id)))
  const orderNumbers = Array.from(new Set(records.map((r) => r.order_number).filter((v): v is string => Boolean(v))))

  const [profiles, codes, orders] = await Promise.all([
    supabase.from('profiles').select('id, name, email').in('id', userIds),
    supabase.from('referral_codes').select('user_id, code').in('user_id', referrerIds),
    orderNumbers.length
      ? supabase
          .from('orders')
          .select('order_number, status, payment_status, customer_name, total')
          .in('order_number', orderNumbers)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const r of [profiles, codes, orders]) {
    if (r.error) console.error('[referral-admin] lookup failed:', r.error.message)
  }

  const profileById = new Map((profiles.data ?? []).map((p) => [p.id as string, p as { name: string; email: string }]))
  const codeByUser = new Map((codes.data ?? []).map((c) => [c.user_id as string, c.code as string]))
  const orderByNumber = new Map(
    ((orders.data ?? []) as {
      order_number: string
      status: OrderStatus
      payment_status: PaymentStatus | null
      customer_name: string
      total: number | string
    }[]).map((o) => [o.order_number, o]),
  )

  const rows: AdminReferralRow[] = records.map((r) => {
    const referrer = profileById.get(r.referrer_id)
    const friendProfile = r.referee_user_id ? profileById.get(r.referee_user_id) : undefined
    const order = r.order_number ? orderByNumber.get(r.order_number) : undefined
    return {
      id: r.id,
      createdAt: r.created_at,
      referrer: {
        id: r.referrer_id,
        name: referrer?.name ?? '—',
        email: referrer?.email ?? '',
        code: codeByUser.get(r.referrer_id) ?? null,
      },
      friend: {
        // A guest friend has no profile; the name they gave at checkout is
        // on the order.
        name: friendProfile?.name ?? order?.customer_name ?? null,
        email: r.referee_email,
        hasAccount: Boolean(r.referee_user_id),
      },
      status: r.status,
      order: r.order_number
        ? {
            number: r.order_number,
            status: order?.status ?? null,
            paymentStatus: order?.payment_status ?? null,
            total: order ? Number(order.total) : null,
          }
        : null,
      reward: Number(r.reward_amount) || 0,
      rewardedAt: r.rewarded_at,
      paidOutAt: r.paid_out_at ?? null,
      payoutNote: r.payout_note ?? null,
    }
  })

  return { available: true, payoutsEnabled, rows }
}

export type PayoutResult = 'paid' | 'already' | 'not_payable' | 'unavailable' | 'failed'

/** Records that a reward has been handed over by hand. Idempotent. */
export async function markReferralPaidOut(referralId: string, note: string | null): Promise<PayoutResult> {
  const { data, error } = await createAdminClient().rpc('mark_referral_paid_out', {
    p_referral_id: referralId,
    p_note: note,
  })
  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') return 'unavailable'
    console.error(`[referral-admin] payout of ${referralId} failed:`, error.message)
    return 'failed'
  }
  return data === 'paid' || data === 'already' || data === 'not_payable' ? data : 'failed'
}
