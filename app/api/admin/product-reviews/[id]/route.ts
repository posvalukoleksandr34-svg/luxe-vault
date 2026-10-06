import { NextResponse, type NextRequest } from 'next/server'
import { deleteProductReview, setProductReviewStatus } from '@/lib/server/product-reviews'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Approve (publish) or reject (keep hidden) one product review. */
export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  const { id } = await props.params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Review not found' }, { status: 404 })

  const body = await readJsonObject<{ status?: unknown }>(request)
  if (!body || (body.status !== 'approved' && body.status !== 'rejected')) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  try {
    const updated = await setProductReviewStatus(id, body.status)
    if (!updated) return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[admin] product review status:', error)
    return NextResponse.json({ error: 'Could not update the review' }, { status: 500 })
  }
}

/** Delete one product review; its author may then write a new one. */
export async function DELETE(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  const { id } = await props.params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  try {
    const removed = await deleteProductReview(id)
    if (!removed) return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[admin] product review delete:', error)
    return NextResponse.json({ error: 'Could not delete the review' }, { status: 500 })
  }
}
