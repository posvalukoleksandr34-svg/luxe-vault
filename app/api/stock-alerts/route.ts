import { NextResponse, type NextRequest } from 'next/server'
import { enforceLimit } from '@/lib/server/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/supabase/server'
import { isValidEmail } from '@/lib/validation'

export const dynamic = 'force-dynamic'

/**
 * "Tell me when this is back."
 *
 * Open to guests as well as signed-in customers: the person most likely to
 * want this is someone who came for one thing, found it gone, and has no
 * reason to make an account first.
 *
 * The email is taken from the SESSION when there is one, and only from the
 * body when there is not. Otherwise a signed-in visitor could subscribe
 * somebody else's address, and this endpoint would be a way to make the shop
 * email a stranger.
 *
 * Throttled, because it sends mail eventually and an unbounded version is a
 * queue anyone can fill.
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
  const email = user?.email ?? (typeof body.email === 'string' ? body.email.trim() : '')

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'INVALID_EMAIL' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Only for a variant that exists and is actually out of stock. Subscribing
  // to something already available would fire on the next sweep and read as a
  // spam email about a product the customer could simply have bought.
  const { data: variant } = await supabase
    .from('product_variants')
    .select('stock, products!inner ( slug )')
    .eq('products.slug', productId)
    .eq('size', size)
    .eq('color', color)
    .maybeSingle()

  if (!variant) {
    return NextResponse.json({ error: 'UNKNOWN_VARIANT' }, { status: 404 })
  }
  if (Number(variant.stock) > 0) {
    return NextResponse.json({ error: 'IN_STOCK' }, { status: 409 })
  }

  const { error } = await supabase.from('stock_alerts').insert({
    user_id: user?.id ?? null,
    email: email.toLowerCase(),
    product_id: productId,
    size,
    color,
  })

  if (error) {
    // 23505 is the one-live-alert-per-variant index. Already subscribed is a
    // success from the customer's point of view — they asked to be told, and
    // they will be.
    if (error.code === '23505') return NextResponse.json({ ok: true, already: true })

    console.error('[stock-alerts] insert failed:', error.message)
    return NextResponse.json({ error: 'Could not save the alert' }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
