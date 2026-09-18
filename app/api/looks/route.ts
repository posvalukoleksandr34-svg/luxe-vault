import { NextResponse, type NextRequest } from 'next/server'
import { readCatalog } from '@/lib/server/catalog-store'
import { enforceLimit } from '@/lib/server/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/supabase/server'
import { readJsonObject } from '@/lib/server/http'

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

  const body = await readJsonObject<{ productIds?: unknown; title?: unknown; notes?: unknown; matchScore?: unknown }>(request)
  if (!body) {
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
  // How much of the brief the look matched, for the Curated Vaults card.
  // Clamped and rounded here rather than trusted: it arrives from the browser,
  // and the column has a 0-100 check constraint that a stray value would trip.
  const matchScore =
    typeof body.matchScore === 'number' && Number.isFinite(body.matchScore)
      ? Math.max(0, Math.min(100, Math.round(body.matchScore)))
      : null

  const user = await getCurrentUser()
  const supabase = createAdminClient()
  const row = { user_id: user?.id ?? null, product_ids: productIds, title, notes }

  let { data, error } = await supabase
    .from('saved_looks')
    .insert({ ...row, match_score: matchScore })
    .select('id')
    .single()

  // 0025 adds match_score. Without it PostgREST rejects the whole insert for
  // an unknown column, which would break saving entirely on a database that
  // is one migration behind — so drop the column and save the look anyway.
  // The card just shows no score until 0025 is applied.
  if (error && (error.code === 'PGRST204' || error.code === '42703')) {
    console.warn('[looks] saved_looks.match_score is missing. Apply 0025 to record match scores.')
    ;({ data, error } = await supabase.from('saved_looks').insert(row).select('id').single())
  }

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
