import { NextResponse, type NextRequest } from 'next/server'
import { captureCheckoutCart } from '@/lib/server/abandoned-cart-flow'
import { readJsonObject } from '@/lib/server/http'
import { enforceLimit } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Captures a cart for the abandoned-cart reminder. The checkout now logs carts
 * through its server action (actions/abandoned-cart.ts); this route stays for
 * other callers and for requests sent with fetch keepalive.
 *
 * Public by necessity, so it is careful about what it accepts — the reminder
 * is an email from this domain to whatever address arrives here:
 *
 *  - same-origin requests only, and rate-limited per client;
 *  - every line must be a real catalogue product in one of its real sizes and
 *    colours, re-priced from the catalogue, so no free text a caller supplies
 *    can end up in an email the shop sends;
 *  - at most one reminder per address per week, and none after an opt-out
 *    (enforced where they are sent — claim_abandoned_carts, migration 0029).
 *
 * Always answers 204 with no body: the checkout never waits on this, and the
 * response says nothing about whether an address is known.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('cart.capture', request)
  if (limited) return limited

  // Same-origin: the page's Origin must name the host this request reached.
  // Compared with the Host header (X-Forwarded-Host behind Vercel's proxy)
  // rather than nextUrl, which can carry the server's own hostname instead.
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (origin) {
    let originHost = ''
    try {
      originHost = new URL(origin).host
    } catch {
      // Unparseable Origin: treated as foreign.
    }
    if (!host || originHost !== host) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const body = await readJsonObject<{ email?: unknown; items?: unknown; locale?: unknown }>(request)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Validation, re-pricing and storage are shared with the checkout's server
  // action (lib/server/abandoned-cart-flow.ts).
  const outcome = await captureCheckoutCart(body)
  if (outcome === 'invalid_email') {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }
  return new NextResponse(null, { status: 204 })
}
