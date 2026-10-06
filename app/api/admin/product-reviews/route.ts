import { NextResponse } from 'next/server'
import { readPendingProductReviews } from '@/lib/server/product-reviews'
import { requireAdmin } from '@/lib/server/admin-guard'

export const dynamic = 'force-dynamic'

/**
 * The product-review quarantine: reviews the automatic filter held
 * (lib/server/review-moderation.ts), with the reasons. Published and rejected
 * reviews are not listed — this is a to-do list, not an archive.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    return NextResponse.json({ reviews: await readPendingProductReviews() })
  } catch (error) {
    console.error('[admin] product reviews:', error)
    return NextResponse.json({ error: 'Could not load reviews' }, { status: 500 })
  }
}
