import { NextResponse, type NextRequest } from 'next/server'
import { addReview, readReviews } from '@/lib/server/reviews-store'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const MAX_NAME_LENGTH = 60
const MAX_MESSAGE_LENGTH = 800

// Public — anyone can read the approved reviews shown on the storefront.
// Pending/rejected reviews never leave the server via this route; only the
// admin-protected /api/admin/reviews can see those.
export async function GET() {
  try {
    const reviews = await readReviews()
    const approved = reviews
      .filter((r) => r.status === 'approved')
      .sort((a, b) => b.createdAt - a.createdAt)
    return NextResponse.json({ reviews: approved })
  } catch (e) {
    // An empty list degrades far better than a broken reviews section.
    console.error('[reviews] read failed:', e)
    return NextResponse.json({ reviews: [] })
  }
}

// Public — anyone can submit a review, but it starts out `pending` and only
// becomes visible on the storefront once an admin approves it.
export async function POST(request: NextRequest) {
  let body: { name?: string; rating?: number; message?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const str = (v: unknown, max: number) =>
    typeof v === 'string' ? v.trim().slice(0, max) : ''

  const name = str(body.name, MAX_NAME_LENGTH)
  const message = str(body.message, MAX_MESSAGE_LENGTH)
  const rating = Number(body.rating)

  // Name which field is wrong instead of one opaque "Malformed review".
  const missing = [!name && 'name', !message && 'message'].filter(Boolean)
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required field(s): ${missing.join(', ')}` },
      { status: 400 },
    )
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be 1-5' }, { status: 400 })
  }

  let userId: string | undefined
  try {
    userId = (await getCurrentUser())?.id
  } catch {
    // Anonymous testimonial — expected and fine.
  }

  try {
    // id/createdAt are assigned by Postgres; status is pinned to 'pending'
    // inside addReview so a client can never publish straight to the site.
    const review = await addReview(
      { id: '', name, rating, message, createdAt: Date.now(), status: 'pending' },
      userId,
    )
    return NextResponse.json({ review }, { status: 201 })
  } catch (e) {
    console.error('[reviews] failed to store review:', e)
    return NextResponse.json({ error: 'Could not save your review' }, { status: 500 })
  }
}
