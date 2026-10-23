import { NextResponse, type NextRequest } from 'next/server'

import { enforceLimit } from '@/lib/server/rate-limit'
import { unsubscribeViaLink } from '@/lib/server/review-requests/links'
import { isTokenShape } from '@/lib/server/review-requests/tokens'

export const dynamic = 'force-dynamic'

/**
 * Stops review requests for the address behind a token.
 *
 * POST only: the RFC 8058 one-click target in the email's List-Unsubscribe
 * header (mail clients POST `List-Unsubscribe=One-Click` here, token in the
 * query) and what the button on /review/[token]/unsubscribe calls. A GET
 * would be followed by link scanners and unsubscribe people who never asked.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('review.link', request)
  if (limited) return limited
  const token = request.nextUrl.searchParams.get('token')
  if (!isTokenShape(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  try {
    const result = await unsubscribeViaLink(token)
    return NextResponse.json({ ok: result === 'done' }, { status: result === 'done' ? 200 : 404 })
  } catch (e) {
    console.error('[review-requests] unsubscribe failed:', (e as Error).message)
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
