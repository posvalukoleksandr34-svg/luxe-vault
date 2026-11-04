import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/server/admin-guard'
import {
  ListingUnavailableError,
  PublishBlockedError,
  readListingEvents,
  setProductListing,
} from '@/lib/server/catalog-store'
import { readJsonObject } from '@/lib/server/http'
import { revalidateStorefront } from '@/lib/server/revalidate'
import { PUBLISH_BLOCKER_LABELS, rightsProblem, type RightsBasis } from '@/lib/listing'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/products/listing — put a product on sale, or take it off.
 *
 *   { slug, action: 'publish', basis, reference, confirmed: true }
 *   { slug, action: 'withdraw', reason? }
 *
 * With 0065 each change is one transaction that also writes the audit trail
 * (product_listing_events); GET ?slug= reads that trail.
 *
 * Publishing needs the owner's rights record (basis + reference + an explicit
 * confirmation) and a complete product (lib/listing.ts publishBlockers); the
 * server checks both on the stored product, never on what the browser shows.
 * Answers in Russian, like the console.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const body = await readJsonObject<{ slug?: unknown; action?: unknown; basis?: unknown; reference?: unknown; confirmed?: unknown; reason?: unknown }>(request)
  if (!body || typeof body.slug !== 'string' || !body.slug.trim()) {
    return NextResponse.json({ error: 'Не указан товар' }, { status: 400 })
  }
  const slug = body.slug.trim()

  try {
    let product
    if (body.action === 'publish') {
      const problem = rightsProblem(body)
      if (problem) return NextResponse.json({ error: problem }, { status: 400 })
      product = await setProductListing(slug, {
        action: 'publish',
        basis: body.basis as RightsBasis,
        reference: String(body.reference),
      })
    } else if (body.action === 'withdraw') {
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (reason.length > 500) return NextResponse.json({ error: 'Причина — не больше 500 символов' }, { status: 400 })
      product = await setProductListing(slug, { action: 'withdraw', reason })
    } else {
      return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
    }
    if (!product) return NextResponse.json({ error: 'Товар не найден' }, { status: 404 })
    revalidateStorefront()
    return NextResponse.json({ product })
  } catch (e) {
    if (e instanceof PublishBlockedError) {
      return NextResponse.json(
        { error: e.message, blockers: e.blockers, details: e.blockers.map((b) => PUBLISH_BLOCKER_LABELS[b]) },
        { status: 422 },
      )
    }
    if (e instanceof ListingUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 })
    console.error('[admin/products/listing]', (e as Error).message)
    return NextResponse.json({ error: 'Не удалось изменить статус товара' }, { status: 500 })
  }
}

/**
 * GET /api/admin/products/listing?slug= — the product's sale-state history,
 * newest first. `events: null` means the database keeps no history yet
 * (migration 0065 not applied).
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const slug = request.nextUrl.searchParams.get('slug')?.trim()
  if (!slug) return NextResponse.json({ error: 'Не указан товар' }, { status: 400 })
  try {
    return NextResponse.json({ events: await readListingEvents(slug) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[admin/products/listing] history', (e as Error).message)
    return NextResponse.json({ error: 'Не удалось прочитать историю' }, { status: 500 })
  }
}
