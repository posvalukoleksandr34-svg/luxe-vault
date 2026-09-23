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

  /** Crash reports from the browser (/api/monitoring/report). Unauthenticated
   *  by necessity — a crash in the root layout means there is no session — so
   *  this is what stops a route that relays text into the operators' chat from
   *  being a spam pipe. Ten is far more than one broken page needs and far
   *  fewer than an abuser wants. */
  'monitoring.report': { max: 10, windowSeconds: 600 },

  /** Photographs for a return request. Six are allowed per request, and a
   *  customer may remove and re-add a few; beyond this a route that accepts
   *  files is being used as free storage. */
  'returns.upload': { max: 20, windowSeconds: 600 },

  /** Password recovery. Sends mail, so this is also spend control. */
  'auth.recovery': { max: 5, windowSeconds: 900 },

  /** Support tickets. */
  'support.create': { max: 5, windowSeconds: 900 },

  /** Newsletter sign-ups. Every accepted address is someone we may email, so
   *  an unbounded version would be a way to subscribe strangers in bulk. */
  'newsletter.subscribe': { max: 5, windowSeconds: 900 },

  /** The unsubscribe link. Generous — a real person clicks it once — but
   *  bounded, since tokens are the only thing standing behind it. */
  'newsletter.unsubscribe': { max: 20, windowSeconds: 600 },

  /** Referral-link visits that count as clicks. Beyond this the visitor is
   *  still redirected; the visit just is not counted. */
  'referral.click': { max: 20, windowSeconds: 600 },

  /** Linking a new account to the friend who invited it. */
  'referral.claim': { max: 10, windowSeconds: 600 },

  /** Product reviews and site testimonials. */
  'review.create': { max: 10, windowSeconds: 3600 },

  /** Back-in-stock subscriptions. Sends mail eventually, so an unbounded
   *  version is a queue anyone can fill. */
  'stock.alert': { max: 10, windowSeconds: 900 },

  /** Abandoned-cart capture from the checkout's email field. Debounced on the
   *  client, so a real customer sends a handful; it can lead to one reminder
   *  email, so an unbounded version would be a way to mail strangers. */
  'cart.capture': { max: 20, windowSeconds: 600 },

  /** Stock checks on add-to-cart, "+" and opening the basket. Generous —
   *  every press is one — but bounded, since each reads the database. */
  'cart.validate': { max: 120, windowSeconds: 300 },

  /** Replies inside an existing support ticket, and its attachments. */
  'support.reply': { max: 20, windowSeconds: 900 },

  /** "My tickets" and the unread badge. Polled about once a minute while the
   *  site is open, so it is generous. */
  'support.mine': { max: 120, windowSeconds: 600 },

  /** Opening one ticket's conversation — guarded by the ticket's token, and
   *  bounded so the token cannot be guessed at volume. */
  'support.read': { max: 60, windowSeconds: 600 },

  /** Catalogue search. Generous — typing is iterative — but bounded, because
   *  an unthrottled search endpoint is a cheap way to make the database work. */
  'search': { max: 60, windowSeconds: 300 },

  /** AI Stylist. Each call reads the whole catalogue and may spend a model
   *  token budget, so it is bounded — but generously, because pressing "try
   *  another" repeatedly is the intended way to use the feature. */
  'stylist': { max: 40, windowSeconds: 300 },

  /** Starting or re-pricing a payment (Stripe intent, crypto invoice). Each
   *  call reaches a paid provider API and is gated only by the order's lookup
   *  token, so it is bounded — generously, since switching currency or coin
   *  re-prices the same order. */
  'payment.start': { max: 30, windowSeconds: 600 },

  /** Saved looks / share links. Guests can create them (a link has to work for
   *  whoever receives it), so this is what keeps an anonymous script from
   *  filling the table. Generous for a person: nobody saves twenty looks in
   *  ten minutes by hand. */
  'looks.save': { max: 20, windowSeconds: 600 },

  /** Coupon validation. An oracle: without a limit a script can discover every
   *  valid code by trying strings. */
  'coupon.validate': { max: 15, windowSeconds: 600 },

  /** Admin login. Replaces the in-memory throttle this module supersedes. */
  'admin.login': { max: 8, windowSeconds: 300 },

  /** Signed-in account writes: addresses, saved cards, profile, notification
   *  read-marks, order cancellation and refund requests, the welcome email.
   *  Keyed by user id, not IP. Generous for a person editing their account;
   *  what it stops is a stolen session being driven by a script. */
  'account.write': { max: 60, windowSeconds: 600 },

  /** Payment-status polling during a crypto payment: every 4 s while the
   *  checkout waits, so ~150 per 10 minutes for one real customer. */
  'payment.status': { max: 300, windowSeconds: 600 },

  /** Address autocomplete. A proxy to a geocoder — paid, when Google Places
   *  is configured — so it is bounded even though typing is iterative. */
  'geo.lookup': { max: 90, windowSeconds: 300 },

  /** The abandoned-cart unsubscribe button and its RFC 8058 one-click POST. */
  'cart.unsubscribe': { max: 20, windowSeconds: 600 },

  /** CSP violation reports. A page with a broken policy can fire dozens at
   *  once; past this they are dropped, not logged. */
  'csp.report': { max: 50, windowSeconds: 600 },

  /** Internal Telegram dispatch (bearer-authenticated). Bounds a leaked
   *  secret or a looping script to a readable number of messages. */
  'internal.telegram': { max: 30, windowSeconds: 600 },
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
  return result.allowed ? null : tooManyRequests(result.retryAfter)
}

/**
 * Throttles a signed-in customer by account rather than by address — for
 * handlers that have already resolved the user, so a shared office IP never
 * throttles colleagues and a rotating-IP script is still counted as one.
 *
 *   const limited = await enforceUserLimit('account.write', user.id)
 *   if (limited) return limited
 */
export async function enforceUserLimit(name: LimitName, userId: string): Promise<NextResponse | null> {
  const result = await checkLimit(name, `user:${userId}`)
  return result.allowed ? null : tooManyRequests(result.retryAfter)
}

function tooManyRequests(retryAfter: number): NextResponse {
  return NextResponse.json(
    {
      error: 'RATE_LIMITED',
      retryAfter,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Remaining': '0',
      },
    },
  )
}
