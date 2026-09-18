import { NextResponse } from 'next/server'
import { getExchangeRates } from '@/lib/server/exchange-rates'

export const dynamic = 'force-dynamic'

/**
 * The exchange rates the storefront converts prices with — the same snapshot
 * the server charges cards at (lib/server/exchange-rates.ts). Read once per
 * visit by the store.
 *
 * Public and cheap: served from the instance's memory cache, and cached at the
 * edge for 15 minutes on top of that, so page views never reach the feed.
 */
export async function GET() {
  const { rates, source, date } = await getExchangeRates()
  return NextResponse.json(
    { rates, source, date },
    { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' } },
  )
}
