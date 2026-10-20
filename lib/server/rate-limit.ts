import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { clientIp } from '@/lib/server/client-ip'
import { securityEvent } from '@/lib/server/security-events'

/**
 * Request throttling, counted in Postgres.
 *
 * See migration 0013 for why the counter cannot live in process memory: on
 * serverless each instance keeps its own map, a second concurrent instance
 * starts empty, and everything is forgotten on recycle. The database is the
 * one piece of state every instance already shares.
 *
 * FAIL OPEN BY DEFAULT — CLOSED WHERE A GUESS IS THE ATTACK
 *
 * If the limiter itself errors — the migration is not applied, the database is
 * briefly unreachable — most requests are allowed through and the failure is
 * logged. A throttle that takes browsing or checkout down when it has a bad
 * minute causes more damage than the abuse it exists to prevent; those
 * endpoints have their own authorisation and validation, and the limit there
 * is a volume control.
 *
 * Not so for the buckets marked `failClosed` below: the admin password, the
 * password-reset mail, the order-lookup, support-ticket and coupon oracles and
 * the start of a card payment. On those the limit IS the defence against
 * guessing — a password, a token, a code, a stolen card number — and a limiter
 * that waves everything through while it is down is exactly the window a
 * brute-force script needs. They answer 503 instead. Each of them reads or
 * writes the same database the limiter does, so when the limiter is down
 * because the database is, they could not have succeeded anyway.
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
  'order.lookup': { max: 20, windowSeconds: 600, failClosed: true },

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
  'auth.recovery': { max: 5, windowSeconds: 900, failClosed: true },

  /** Support tickets. */
  /** The chat concierge (/api/support/assistant). Each message is one model
   *  call, so this is also the cost ceiling per visitor: a real conversation
   *  is a dozen messages, not forty in ten minutes. */
  'support.assistant': { max: 40, windowSeconds: 600 },

  /** "Was this helpful?" on a concierge answer: one tap per answer, so a
   *  generous ceiling that still keeps a script from filling the log. */
  'support.feedback': { max: 30, windowSeconds: 600 },

  'support.create': { max: 5, windowSeconds: 900 },

  /** Newsletter sign-ups. Every accepted address is someone we may email, so
   *  an unbounded version would be a way to subscribe strangers in bulk. */
  'newsletter.subscribe': { max: 5, windowSeconds: 900 },

  /** The unsubscribe link. Generous — a real person clicks it once — but
   *  bounded, since tokens are the only thing standing behind it. */
  'newsletter.unsubscribe': { max: 20, windowSeconds: 600 },

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
  'support.read': { max: 60, windowSeconds: 600, failClosed: true },

  /** Catalogue search. Generous — typing is iterative — but bounded, because
   *  an unthrottled search endpoint is a cheap way to make the database work. */
  'search': { max: 60, windowSeconds: 300 },

  /** Products by id (/api/search?ids=): the cart, recently viewed. One per
   *  screen that shows them, and each id is asked for once per visit, so a
   *  person browsing stays far below this; its own bucket so browsing never
   *  eats the search budget. */
  'catalog.lookup': { max: 120, windowSeconds: 300 },

  /** Starting or re-pricing a payment (Stripe intent, crypto invoice). Each
   *  call reaches a paid provider API and is gated only by the order's lookup
   *  token, so it is bounded — generously, since switching currency or coin
   *  re-prices the same order. */
  'payment.start': { max: 30, windowSeconds: 600, failClosed: true },

  /** Coupon validation. An oracle: without a limit a script can discover every
   *  valid code by trying strings. */
  'coupon.validate': { max: 15, windowSeconds: 600, failClosed: true },

  /** Admin login. Replaces the in-memory throttle this module supersedes. */
  'admin.login': { max: 8, windowSeconds: 300, failClosed: true },

  /** Signed-in account writes: addresses, saved cards, profile, notification
   *  read-marks, order cancellation and refund requests, the welcome email.
   *  Keyed by user id, not IP. Generous for a person editing their account;
   *  what it stops is a stolen session being driven by a script. */
  'account.write': { max: 60, windowSeconds: 600 },
  /** Account deletion: irreversible, so a handful of attempts per hour. */
  'account.delete': { max: 5, windowSeconds: 3600 },

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

  /** A customer's refund requests: reading their cases and an order's
   *  eligibility. Keyed by account. */
  'refunds.read': { max: 120, windowSeconds: 600 },
  /** Filing a request, replying, appealing. Keyed by account; a person files
   *  a handful, a script hundreds. */
  'refunds.write': { max: 20, windowSeconds: 600 },
  /** A staff member confirming who they are (their own passphrase, after the
   *  console login). A guess is the attack, so it fails closed. */
  'admin.staff_bind': { max: 10, windowSeconds: 600, failClosed: true },
} as const

type LimitConfig = { max: number; windowSeconds: number; failClosed?: boolean }

export type LimitResult = {
  allowed: boolean
  remaining: number
  retryAfter: number
  /** The limiter could not be consulted and this bucket fails closed. */
  unavailable?: boolean
}

/** Seconds a fail-closed caller is asked to wait while the limiter is down. */
const UNAVAILABLE_RETRY_SECONDS = 30

/**
 * Identifies the caller for throttling.
 *
 * The address comes from lib/server/client-ip.ts, which reads Cloudflare's
 * CF-Connecting-IP when the request is proven to have come through the edge
 * and the platform's X-Forwarded-For otherwise. Behind Cloudflare without that
 * proof, X-Forwarded-For is a Cloudflare server's address — see that file.
 *
 * Falls back to a shared bucket rather than to "unlimited": an unidentifiable
 * caller should be throttled with the other unidentifiable callers, not exempt.
 */
export function clientKey(request: NextRequest): string {
  return clientIp(request.headers) || 'unidentified'
}

export async function checkLimit(
  name: LimitName,
  subject: string,
): Promise<LimitResult> {
  const { max, windowSeconds, failClosed } = LIMITS[name] as LimitConfig

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
    if (failClosed) {
      console.error(`[rate-limit] ${name} check failed, refusing request (fail closed):`, e)
      return { allowed: false, remaining: 0, retryAfter: UNAVAILABLE_RETRY_SECONDS, unavailable: true }
    }
    console.error(`[rate-limit] ${name} check failed, allowing request:`, e)
    return { allowed: true, remaining: max, retryAfter: 0 }
  }
}

/** Whether a bucket refuses requests while the limiter is down (for tests and docs). */
export function failsClosed(name: LimitName): boolean {
  return Boolean((LIMITS[name] as LimitConfig).failClosed)
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
  if (result.unavailable) {
    securityEvent('rate_limiter_unavailable', { bucket: name, route: request.nextUrl.pathname })
    return temporarilyUnavailable(result.retryAfter)
  }
  if (result.allowed) return null
  securityEvent('rate_limited', { bucket: name, route: request.nextUrl.pathname, ip: clientKey(request) })
  return tooManyRequests(result.retryAfter)
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
  if (result.unavailable) {
    securityEvent('rate_limiter_unavailable', { bucket: name })
    return temporarilyUnavailable(result.retryAfter)
  }
  if (result.allowed) return null
  securityEvent('rate_limited', { bucket: name })
  return tooManyRequests(result.retryAfter)
}

function temporarilyUnavailable(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: 'TEMPORARILY_UNAVAILABLE', retryAfter },
    { status: 503, headers: { 'Retry-After': String(retryAfter) } },
  )
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
