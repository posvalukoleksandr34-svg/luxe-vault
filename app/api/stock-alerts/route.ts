import { NextResponse, type NextRequest } from 'next/server'
import { enforceLimit } from '@/lib/server/rate-limit'
import { addToWaitlist } from '@/lib/server/waitlist'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * "Tell me when this is back" — the JSON entry point, kept for anything that
 * still posts here (an open tab from before the Server Action). It writes to
 * public.waitlist through the same helper as actions/waitlist.ts.
 *
 * Open to guests as well as signed-in customers. The email is taken from the
 * SESSION when there is one, and only from the body when there is not, so a
 * signed-in visitor cannot subscribe somebody else's address. Throttled,
 * because it ends in an email.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('stock.alert', request)
  if (limited) return limited

  let body: { productId?: unknown; size?: unknown; color?: unknown; email?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
  const size = typeof body.size === 'string' ? body.size.trim() : ''
  const color = typeof body.color === 'string' ? body.color.trim() : ''
  if (!productId || !size || !color) {
    return NextResponse.json({ error: 'Missing variant' }, { status: 400 })
  }

  const user = await getCurrentUser()
  const email = user?.email ?? (typeof body.email === 'string' ? body.email : '')

  const result = await addToWaitlist({ productSlug: productId, size, color, email, userId: user?.id })
  if (result.ok) return NextResponse.json({ ok: true, already: result.already }, { status: result.already ? 200 : 201 })

  const status = { INVALID_EMAIL: 400, UNKNOWN_VARIANT: 404, IN_STOCK: 409, FAILED: 500 }[result.error]
  return NextResponse.json({ error: result.error }, { status })
}
