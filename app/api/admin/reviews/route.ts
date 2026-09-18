import { NextResponse } from 'next/server'
import { readReviews } from '@/lib/server/reviews-store'
import { requireAdmin } from '@/lib/server/admin-guard'

export const dynamic = 'force-dynamic'

// Auth is already enforced by middleware.ts for every /api/admin/* path.
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  const reviews = (await readReviews()).sort((a, b) => b.createdAt - a.createdAt)
  return NextResponse.json({ reviews })
}
