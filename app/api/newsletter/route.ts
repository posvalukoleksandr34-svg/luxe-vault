import { NextResponse, type NextRequest } from 'next/server'
import { subscribeToNewsletter } from '@/lib/server/newsletter'
import { enforceLimit } from '@/lib/server/rate-limit'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Newsletter sign-up. JSON: { email, locale, consent: true }.
 *
 * `consent` must be true — the form sends it only from the submit that sits
 * beside the consent wording, so the stored consent time means something.
 * Throttled, because every accepted address is someone we may email.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('newsletter.subscribe', request)
  if (limited) return limited

  let body: { email?: unknown; locale?: unknown; consent?: unknown; source?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (body.consent !== true) {
    return NextResponse.json({ error: 'CONSENT_REQUIRED' }, { status: 400 })
  }

  let userId: string | undefined
  try {
    userId = (await getCurrentUser())?.id
  } catch {
    // Guests can subscribe too.
  }

  const result = await subscribeToNewsletter({
    email: typeof body.email === 'string' ? body.email : '',
    locale: typeof body.locale === 'string' ? body.locale : undefined,
    source: typeof body.source === 'string' ? body.source : undefined,
    userId,
  })
  if (result.ok) {
    return NextResponse.json({ ok: true, already: result.already }, { status: result.already ? 200 : 201 })
  }
  const status = { INVALID_EMAIL: 400, UNAVAILABLE: 503, FAILED: 500 }[result.error]
  return NextResponse.json({ error: result.error }, { status })
}
