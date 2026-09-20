import { NextResponse } from 'next/server'
import { readSizeStat } from '@/lib/server/size-stats'

export const dynamic = 'force-dynamic'

/**
 * The most-bought size for one product, for the fit finder's social proof.
 *
 * Public, and deliberately thin: a size and a percentage, or nothing at all
 * when too few have been sold to mean anything (lib/server/size-stats.ts).
 * Nothing here identifies a buyer.
 *
 * Cached at the edge for an hour — purchase history does not move minute to
 * minute, and a product page should never wait on this.
 */
export async function GET(_request: Request, { params }: { params: { slug: string } }) {
  const stat = await readSizeStat(params.slug)
  return NextResponse.json(
    { stat },
    { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
  )
}
