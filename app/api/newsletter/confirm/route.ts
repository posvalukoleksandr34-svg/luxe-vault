import { NextResponse, type NextRequest } from 'next/server'
import { confirmNewsletter } from '@/lib/server/newsletter'
import { enforceLimit } from '@/lib/server/rate-limit'
import { readJsonObject } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/**
 * Confirms a newsletter sign-up (double opt-in, migration 0051). POSTed by
 * /newsletter/confirm when the visitor presses its button — never done by
 * the GET that opens the link, which mail scanners make on their own.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('newsletter.unsubscribe', request)
  if (limited) return limited

  const body = await readJsonObject<{ token?: unknown }>(request)
  const token = typeof body?.token === 'string' ? body.token : ''
  const result = await confirmNewsletter(token)
  if (result === 'ok') return NextResponse.json({ ok: true })
  if (result === 'not_found') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ error: 'FAILED' }, { status: 500 })
}
