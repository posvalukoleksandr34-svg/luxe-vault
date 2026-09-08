import { NextResponse, type NextRequest } from 'next/server'
import { createClient, getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const MAX_ITEMS = 100

/**
 * The customer's wishlist.
 *
 * Uses the REQUEST-SCOPED Supabase client throughout, so the RLS policies from
 * 0021 decide which rows are visible and writable. A bug in this file cannot
 * hand one customer another's list, because the database would refuse to
 * return it.
 *
 * Returns slugs only. The storefront already holds the full catalogue in its
 * store, so sending product rows here would duplicate data the client has and
 * risk the two disagreeing about a price.
 */
export async function GET() {
  const user = await getCurrentUser()
  // Not an error: a signed-out visitor has an empty wishlist, and answering
  // 401 would make the account page render a failure for a normal state.
  if (!user) return NextResponse.json({ productIds: [] })

  const { data, error } = await createClient()
    .from('wishlist_items')
    .select('product_id')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[wishlist] read failed:', error.message)
    return NextResponse.json({ productIds: [] })
  }

  return NextResponse.json({ productIds: (data ?? []).map((r) => r.product_id as string) })
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { productId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
  if (!productId) return NextResponse.json({ error: 'Missing product' }, { status: 400 })

  const supabase = createClient()

  const { count } = await supabase
    .from('wishlist_items')
    .select('id', { count: 'exact', head: true })
  if ((count ?? 0) >= MAX_ITEMS) {
    return NextResponse.json(
      { error: `A wishlist holds up to ${MAX_ITEMS} products.` },
      { status: 409 },
    )
  }

  const { error } = await supabase
    .from('wishlist_items')
    .insert({ user_id: user.id, product_id: productId })

  if (error) {
    // 23505 is the unique index. Already saved is a success from the
    // customer's point of view — they wanted it on the list, and it is.
    if (error.code === '23505') return NextResponse.json({ ok: true, already: true })
    console.error('[wishlist] insert failed:', error.message)
    return NextResponse.json({ error: 'Could not save the product' }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const productId = new URL(request.url).searchParams.get('productId')
  if (!productId) return NextResponse.json({ error: 'Missing product' }, { status: 400 })

  // No user_id filter: RLS already restricts the delete to the caller's own
  // rows, and adding one here would imply it does not.
  const { error } = await createClient()
    .from('wishlist_items')
    .delete()
    .eq('product_id', productId)

  if (error) {
    console.error('[wishlist] delete failed:', error.message)
    return NextResponse.json({ error: 'Could not remove the product' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
