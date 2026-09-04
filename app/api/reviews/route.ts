import { NextResponse, type NextRequest } from 'next/server'
import { addReview, readReviews } from '@/lib/server/reviews-store'
import type { Review } from '@/lib/types'

export const dynamic = 'force-dynamic'

const MAX_NAME_LENGTH = 60
const MAX_MESSAGE_LENGTH = 800

function generateReviewId() {
  return `rev-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

// Public — anyone can read the approved reviews shown on the storefront.
// Pending/rejected reviews never leave the server via this route; only the
// admin-protected /api/admin/reviews can see those.
export async function GET() {
  const reviews = await readReviews()
  const approved = reviews
    .filter((r) => r.status === 'approved')
    .sort((a, b) => b.createdAt - a.createdAt)
  return NextResponse.json({ reviews: approved })
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

  const name = body.name?.trim().slice(0, MAX_NAME_LENGTH)
  const message = body.message?.trim().slice(0, MAX_MESSAGE_LENGTH)
  const rating = Number(body.rating)

  if (!name || !message || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Malformed review' }, { status: 400 })
  }

  const review: Review = {
    id: generateReviewId(),
    name,
    rating,
    message,
    createdAt: Date.now(),
    status: 'pending',
  }

  await addReview(review)
  return NextResponse.json({ review }, { status: 201 })
}
