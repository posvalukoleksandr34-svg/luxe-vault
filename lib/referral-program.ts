// The referral programme's terms, shared by the account page, checkout and the
// server. Configurable per deployment; the defaults are the launch offer.
//
//   NEXT_PUBLIC_REFERRAL_DISCOUNT_PERCENT  the friend's discount on their first
//                                          order (whole percent, 1–50)
//   NEXT_PUBLIC_REFERRAL_REWARD            the referrer's bonus per friend's
//                                          first PAID order, in the store's
//                                          base currency (CHF), 0–1000
//
// NEXT_PUBLIC_ because the page states the offer; the server applies the same
// numbers, so what the customer reads is what the order does.

function numberFrom(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export const REFERRAL_DISCOUNT_PERCENT = Math.round(
  numberFrom(process.env.NEXT_PUBLIC_REFERRAL_DISCOUNT_PERCENT, 10, 1, 50),
)

export const REFERRAL_REWARD_AMOUNT =
  Math.round(numberFrom(process.env.NEXT_PUBLIC_REFERRAL_REWARD, 50, 0, 1000) * 100) / 100

/** Set by /r/<code>; read at checkout to pre-fill the friend's code. Not
 *  httpOnly on purpose — it holds only the public code. */
export const REFERRAL_COOKIE = 'lv_ref'
export const REFERRAL_COOKIE_DAYS = 30

/** REF- and six characters without the look-alikes 0/O, 1/I. */
export const REFERRAL_CODE_RE = /^REF-[A-HJ-NP-Z2-9]{6}$/

export type ReferralStatus = 'pending' | 'order_placed' | 'reward_paid' | 'void'

export type ReferralHistoryRow = {
  id: string
  friend: string
  status: ReferralStatus
  date: string
  reward: number
}

export type ReferralOverview =
  | { available: false }
  | {
      available: true
      code: string
      link: string
      discountPercent: number
      rewardAmount: number
      stats: { invited: number; clicks: number; purchases: number; earned: number }
      history: ReferralHistoryRow[]
    }

/** The referral code from the cookie, if the browser has a valid one. */
export function readReferralCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${REFERRAL_COOKIE}=([^;]*)`))
  const value = match ? decodeURIComponent(match[1]).toUpperCase() : ''
  return REFERRAL_CODE_RE.test(value) ? value : null
}
