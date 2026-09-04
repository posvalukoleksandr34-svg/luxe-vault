import { NextResponse } from 'next/server'
import { readReviews } from '@/lib/server/reviews-store'

export const dynamic = 'force-dynamic'

// Auth is already enforced by middleware.ts for every /api/admin/* path.
export async function GET() {
  const reviews = (await readReviews()).sort((a, b) => b.createdAt - a.createdAt)
  return NextResponse.json({ reviews })
}
