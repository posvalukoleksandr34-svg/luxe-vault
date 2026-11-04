import { NextResponse } from 'next/server'
import { resolveAvailableOptions } from '@/lib/server/crypto-options'
import { fetchAvailableTickers, isCheckoutReady } from '@/lib/server/nowpayments'

export const dynamic = 'force-dynamic'

// Public — the checkout flow needs this before an order (and therefore any
// session) exists.
export async function GET() {
  // Not "configured" until a payment can be confirmed as well as created.
  if (!isCheckoutReady()) {
    return NextResponse.json({ configured: false, options: [] })
  }

  const tickers = await fetchAvailableTickers()
  const options = resolveAvailableOptions(tickers)
  // The same for every visitor and changes only when the merchant edits their
  // NOWPayments account: the CDN answers repeat visits. An empty list (the
  // gateway failed) is not cached, so it is retried on the next request.
  return NextResponse.json(
    { configured: true, options },
    { headers: { 'Cache-Control': options.length > 0 ? 'public, s-maxage=600, stale-while-revalidate=3600' : 'no-store' } },
  )
}
