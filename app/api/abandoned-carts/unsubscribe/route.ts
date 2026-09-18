import { NextResponse, type NextRequest } from 'next/server'
import { isCartToken, optOutCart } from '@/lib/server/abandoned-carts'
import { enforceLimit } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Stops cart reminders for the address behind a token.
 *
 * POST only. It is both the RFC 8058 one-click target named in the reminder's
 * List-Unsubscribe header (mail clients POST `List-Unsubscribe=One-Click` to
 * it) and what the button on /cart/unsubscribe/[token] calls. A GET would be
 * followed by link scanners and unsubscribe people who never asked.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('cart.unsubscribe', request)
  if (limited) return limited

  const token = request.nextUrl.searchParams.get('token')
  if (!isCartToken(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }
  const ok = await optOutCart(token)
  return NextResponse.json({ ok }, { status: ok ? 200 : 503 })
}
