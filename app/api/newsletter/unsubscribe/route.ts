import { NextResponse, type NextRequest } from 'next/server'
import { setStatusByToken } from '@/lib/server/newsletter-campaigns'
import { enforceLimit } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * The unsubscribe link's endpoint.
 *
 * Two callers:
 *   - the /newsletter/unsubscribe page, which posts JSON { token, action } —
 *     `action: 'resubscribe'` undoes a mistaken click from the same page;
 *   - a mail client's one-click unsubscribe (RFC 8058), which POSTs
 *     `List-Unsubscribe=One-Click` as a form to the URL in the email's
 *     List-Unsubscribe header, with the token in the query string.
 *
 * POST only. A GET that unsubscribed would be triggered by the link scanners
 * corporate mail servers run over every URL in an incoming message, silently
 * removing people who never clicked anything.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('newsletter.unsubscribe', request)
  if (limited) return limited

  let token = request.nextUrl.searchParams.get('token') ?? ''
  let action: 'unsubscribe' | 'resubscribe' = 'unsubscribe'

  const type = request.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    const body = (await request.json().catch(() => null)) as { token?: unknown; action?: unknown } | null
    if (typeof body?.token === 'string') token = body.token
    if (body?.action === 'resubscribe') action = 'resubscribe'
  }

  const status = action === 'resubscribe' ? 'active' : 'unsubscribed'
  const result = await setStatusByToken(token, status)
  if (result === 'ok') return NextResponse.json({ ok: true, status })
  if (result === 'not_found') return NextResponse.json({ error: 'INVALID_LINK' }, { status: 404 })
  return NextResponse.json({ error: 'FAILED' }, { status: 500 })
}
