// Promo codes as the admin and the app see them — shared by the server and
// the browser (no secrets, no database access here). The codes themselves are
// rows of `coupons` (migrations 0015 and 0043).

export type PromoKind = 'percent' | 'fixed'
export type PromoSource = 'admin' | 'app_welcome'

export type PromoCode = {
  id: string
  code: string
  kind: PromoKind
  /** Percent (1–100) or CHF, by `kind`. */
  value: number
  active: boolean
  createdAt: string
  expiresAt: string | null
  /** Null = no limit. */
  maxUses: number | null
  used: number
  validForDays: number | null
  minOrderTotal: number | null
  source: PromoSource
  /** Issued to one customer only (app codes), else null. */
  userId: string | null
}

/** Where a code stands, for the admin's status badge. */
export type PromoState = 'active' | 'inactive' | 'expired' | 'exhausted'

export function promoState(p: PromoCode, now: number = Date.now()): PromoState {
  if (!p.active) return 'inactive'
  if (p.expiresAt && Date.parse(p.expiresAt) <= now) return 'expired'
  if (p.maxUses !== null && p.used >= p.maxUses) return 'exhausted'
  return 'active'
}

/** Upper-case letters, digits and hyphens; 3–32 long (the table's check). */
export const PROMO_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$/

export const PROMO_LIMITS = {
  percent: { min: 1, max: 100 },
  fixed: { min: 0.01, max: 10000 },
  maxUses: { min: 1, max: 1_000_000 },
  days: { min: 1, max: 3650 },
} as const
