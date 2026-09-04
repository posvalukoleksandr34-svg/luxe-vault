import { NextResponse, type NextRequest } from 'next/server'
import { deleteReview, setReviewStatus } from '@/lib/server/reviews-store'
import type { ReviewStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: ReviewStatus[] = ['pending', 'approved', 'rejected']

// Auth is already enforced by middleware.ts for every /api/admin/* path.

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let body: { status?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.status || !VALID_STATUSES.includes(body.status as ReviewStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const updated = await setReviewStatus(params.id, body.status as ReviewStatus)
  if (!updated) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }
  return NextResponse.json({ review: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const removed = await deleteReview(params.id)
  if (!removed) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
