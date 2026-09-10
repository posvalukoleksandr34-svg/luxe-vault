import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Request throttling, counted in Postgres.
 *
 * See migration 0013 for why the counter cannot live in process memory: on
 * serverless each instance keeps its own map, a second concurrent instance
 * starts empty, and everything is forgotten on recycle. The database is the
 * one piece of state every instance already shares.
 *
 * FAIL OPEN, DELIBERATELY
 *
 * If the limiter itself errors — the migration is not applied, the database is
 * briefly unreachable — the request is allowed through and the failure is
 * logged. A throttle that takes checkout down when it has a bad minute causes
 * more damage than the abuse it exists to prevent. The endpoints behind it all
 * have their own authorisation and validation; this is a volume control, not
 * an access control, and it must never become a single point of failure.
 */

export type LimitName = keyof typeof LIMITS

/**
 * Per-endpoint budgets.
 *
 * Chosen so a real person never meets them. Someone placing four orders in ten
 * minutes is doing something unusual; someone placing forty is a script. The
 * lookup budget is the tightest relative to its cost, because that endpoint is
 * the enumeration target.
 */
const LIMITS = {
  /** Order creation. Generous — a customer may legitimately retry. */
  'order.create': { max: 10, windowSeconds: 600 },

  /** Order lookup. The enumeration surface: LV- plus six characters. */
  'order.lookup': { max: 20, windowSeconds: 600 },

  /** Password recovery. Sends mail, so this is also spend control. */
  'auth.recovery': { max: 5, windowSeconds: 900 },

  /** Support tickets. */
  'support.create': { max: 5, windowSeconds: 900 },

  /** Product reviews and site testimonials. */
  'review.create': { max: 10, windowSeconds: 3600 },

  /** Back-in-stock subscriptions. Sends mail eventually, so an unbounded
   *  version is a queue anyone can fill. */
  'stock.alert': { max: 10, windowSeconds: 900 },

  /** Catalogue search. Generous — typing is iterative — but bounded, because
   *  an unthrottled search endpoint is a cheap way to make the database work. */
  'search': { max: 60, windowSeconds: 300 },

  /** AI Stylist. Each call reads the whole catalogue and may spend a model
   *  token budget, so it is bounded — but generously, because pressing "try
   *  another" repeatedly is the intended way to use the feature. */
  'stylist': { max: 40, windowSeconds: 300 },

  /** Coupon validation. An oracle: without a limit a script can discover every
   *  valid code by trying strings. */
  'coupon.validate': { max: 15, windowSeconds: 600 },

  /** Admin login. Replaces the in-memory throttle this module supersedes. */
  'admin.login': { max: 8, windowSeconds: 300 },
} as const

export type LimitResult = {
  allowed: boolean
  remaining: number
  retryAfter: number
}

/**
 * Identifies the caller for throttling.
 *
 * `x-forwarded-for` is set by the platform's proxy and is the only client
 * address a serverless function sees. It is spoofable on a self-hosted setup
 * behind an untrusted proxy, which is worth knowing but does not change the
 * calculus here — the alternative is no limit at all.
 *
 * Falls back to a shared bucket rather than to "unlimited": an unidentifiable
 * caller should be throttled with the other unidentifiable callers, not exempt.
 */
export function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip =
    forwarded?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    ''
  return ip || 'unidentified'
}

export async function checkLimit(
  name: LimitName,
  subject: string,
): Promise<LimitResult> {
  const { max, windowSeconds } = LIMITS[name]

  try {
    const { data, error } = await createAdminClient().rpc('check_rate_limit', {
      p_bucket: name,
      p_subject: subject.slice(0, 200),
      p_limit: max,
      p_window_seconds: windowSeconds,
    })

    if (error) throw new Error(error.message)

    // The function returns a single row; PostgREST hands it back as an array.
    const row = Array.isArray(data) ? data[0] : data
    if (!row) throw new Error('check_rate_limit returned no row')

    return {
      allowed: Boolean(row.allowed),
      remaining: Number(row.remaining) || 0,
      retryAfter: Number(row.retry_after) || windowSeconds,
    }
  } catch (e) {
    console.error(`[rate-limit] ${name} check failed, allowing request:`, e)
    return { allowed: true, remaining: max, retryAfter: 0 }
  }
}

/**
 * Throttles a request, returning a ready 429 when the budget is spent.
 *
 * Usage at the top of a route handler:
 *
 *   const limited = await enforceLimit('order.create', request)
 *   if (limited) return limited
 *
 * `Retry-After` is a real header browsers and well-behaved clients honour, so
 * it is sent alongside the JSON body rather than only in the message.
 */
export async function enforceLimit(
  name: LimitName,
  request: NextRequest,
  subject?: string,
): Promise<NextResponse | null> {
  const result = await checkLimit(name, subject ?? clientKey(request))
  if (result.allowed) return null

  return NextResponse.json(
    {
      error: 'RATE_LIMITED',
      retryAfter: result.retryAfter,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfter),
        'X-RateLimit-Remaining': '0',
      },
    },
  )
}
