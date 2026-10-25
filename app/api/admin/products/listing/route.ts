import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/server/admin-guard'
import {
  ListingUnavailableError,
  PublishBlockedError,
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
 *   { slug, action: 'withdraw' }
 *
 * Publishing needs the owner's rights record (basis + reference + an explicit
 * confirmation) and a complete product (lib/listing.ts publishBlockers); the
 * server checks both on the stored product, never on what the browser shows.
 * Answers in Russian, like the console.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const body = await readJsonObject<{ slug?: unknown; action?: unknown; basis?: unknown; reference?: unknown; confirmed?: unknown }>(request)
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
      product = await setProductListing(slug, { action: 'withdraw' })
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
