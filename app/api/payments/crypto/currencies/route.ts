import { NextResponse } from 'next/server'
import { resolveAvailableOptions } from '@/lib/server/crypto-options'
import { fetchAvailableTickers, isConfigured } from '@/lib/server/nowpayments'

export const dynamic = 'force-dynamic'

// Public — the checkout flow needs this before an order (and therefore any
// session) exists.
export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json({ configured: false, options: [] })
  }

  const tickers = await fetchAvailableTickers()
  const options = resolveAvailableOptions(tickers)
  return NextResponse.json({ configured: true, options })
}
