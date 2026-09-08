import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

/**
 * Stock across the whole catalogue, in one view.
 *
 * The product form can edit one product's grid, which is the right place to
 * set up a new product but the wrong place to answer "what am I about to run
 * out of" — that needs every variant of every product on one screen, sorted by
 * urgency.
 */
export async function GET() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('product_variants')
    .select('id, size, color, stock, low_stock_at, sku, product:products ( slug, name, image )')
    .order('stock', { ascending: true })
    .limit(2000)

  if (error) {
    // The table does not exist until 0012. Answering with an empty list and a
    // flag lets the tab explain itself rather than showing a broken panel.
    console.error('[admin/inventory] read failed:', error.message)
    return NextResponse.json({ variants: [], unavailable: true })
  }

  type ProductRef = { slug: string; name: Record<string, string>; image: string | null }

  const variants = (data ?? []).map((v) => {
    // PostgREST returns an embedded one-to-one as an object, but some versions
    // return a single-element array. Accept both rather than crash on one.
    const raw = v.product as unknown
    const product = (Array.isArray(raw) ? raw[0] : raw) as ProductRef | null

    const stock = Number(v.stock) || 0
    const lowAt = Number(v.low_stock_at) || 0

    return {
      id: v.id as string,
      slug: product?.slug ?? '',
      name: product?.name?.ru || product?.name?.en || product?.slug || '',
      image: product?.image ?? '',
      size: v.size as string,
      color: v.color as string,
      sku: (v.sku as string | null) ?? undefined,
      stock,
      lowStockAt: lowAt,
      // Precomputed so the table sorts and filters on one field rather than
      // re-deriving the same comparison in three places.
      state: stock === 0 ? 'out' : stock <= lowAt ? 'low' : 'ok',
    }
  })

  return NextResponse.json({ variants })
}

/**
 * Adjusts one variant's stock.
 *
 * An absolute value, not a delta. The admin is looking at a shelf and typing
 * what is on it; a delta would need them to do arithmetic against a number
 * that may have changed since the page loaded.
 *
 * This is the only path that can RAISE stock outside a restock — it bypasses
 * nothing, because the check constraint still refuses a negative.
 */
export async function PATCH(request: NextRequest) {
  let body: { id?: unknown; stock?: unknown; lowStockAt?: unknown; sku?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'Missing variant id' }, { status: 400 })

  const patch: Record<string, unknown> = {}

  if (body.stock !== undefined) {
    const stock = Math.trunc(Number(body.stock))
    if (!Number.isFinite(stock) || stock < 0) {
      return NextResponse.json({ error: 'Stock must be zero or more' }, { status: 400 })
    }
    patch.stock = stock
  }

  if (body.lowStockAt !== undefined) {
    const low = Math.trunc(Number(body.lowStockAt))
    if (!Number.isFinite(low) || low < 0) {
      return NextResponse.json({ error: 'Threshold must be zero or more' }, { status: 400 })
    }
    patch.low_stock_at = low
  }

  if (body.sku !== undefined) {
    patch.sku = typeof body.sku === 'string' && body.sku.trim() ? body.sku.trim() : null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await createAdminClient()
    .from('product_variants')
    .update(patch)
    .eq('id', id)

  if (error) {
    // 23505 is the unique SKU index — a duplicate code is an admin typo, not
    // a server fault, and saying so is more useful than "could not save".
    const duplicate = error.code === '23505'
    console.error('[admin/inventory] update failed:', error.message)
    return NextResponse.json(
      { error: duplicate ? 'That SKU is already used by another variant' : 'Could not update stock' },
      { status: duplicate ? 409 : 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
