import { NextResponse, type NextRequest } from 'next/server'
import { readCatalog } from '@/lib/server/catalog-store'
import { enforceLimit } from '@/lib/server/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/supabase/server'

/**
 * Saves a stylist look and returns its id — the key of /stylist/share/<id>.
 *
 * One endpoint serves both "Save look" and "Share capsule": both need the same
 * row, and a share link that could exist without a save (or vice versa) would
 * be two representations of one thing.
 *
 * Server-side, with the service role, for three reasons:
 *  - guests can save too, and they have no RLS identity to insert under;
 *  - user_id comes from the SESSION, never from the body, so nobody can file
 *    a look under someone else's account;
 *  - every product id is checked against the live catalogue first, so a
 *    capsule can only ever contain products that exist — the stylist's
 *    "never invent a product" rule, enforced at the point of storage too.
 */

export const dynamic = 'force-dynamic'

const MAX_ITEMS = 8

export async function POST(request: NextRequest) {
  const limited = await enforceLimit('looks.save', request)
  if (limited) return limited

  let body: { productIds?: unknown; title?: unknown; notes?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const requested = Array.isArray(body.productIds)
    ? body.productIds
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && id.length <= 120)
    : []

  // De-duplicated without spreading a Set (the project targets ES5).
  const unique = requested.filter((id, i) => requested.indexOf(id) === i).slice(0, MAX_ITEMS)
  if (!unique.length) {
    return NextResponse.json({ error: 'EMPTY_LOOK' }, { status: 400 })
  }

  let productIds: string[]
  try {
    const catalog = await readCatalog()
    const known: Record<string, true> = {}
    for (const p of catalog.products) known[p.id] = true
    productIds = unique.filter((id) => known[id])
  } catch (error) {
    console.error('[looks] catalogue read failed:', error)
    return NextResponse.json({ error: 'UNAVAILABLE' }, { status: 503 })
  }

  if (!productIds.length) {
    return NextResponse.json({ error: 'UNKNOWN_PRODUCTS' }, { status: 400 })
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : ''
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : ''
  const user = await getCurrentUser()

  const { data, error } = await createAdminClient()
    .from('saved_looks')
    .insert({ user_id: user?.id ?? null, product_ids: productIds, title, notes })
    .select('id')
    .single()

  if (error || !data) {
    // 42P01 / PGRST205: the table does not exist — 0024 has not been applied.
    // Said plainly in the log, and a 503 to the client rather than a 500, so
    // the UI can tell "not set up" from "something broke".
    const missing = error?.code === '42P01' || error?.code === 'PGRST205'
    console.error(
      missing
        ? '[looks] public.saved_looks is missing. Apply supabase/migrations/0024_saved_looks.sql.'
        : `[looks] insert failed: ${error?.message}`,
    )
    return NextResponse.json({ error: missing ? 'NOT_CONFIGURED' : 'SAVE_FAILED' }, { status: missing ? 503 : 500 })
  }

  return NextResponse.json({ id: data.id as string, productIds }, { status: 201 })
}
