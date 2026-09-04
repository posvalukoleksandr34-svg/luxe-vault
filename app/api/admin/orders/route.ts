import { NextResponse } from 'next/server'
import { readOrders } from '@/lib/server/orders-store'

// Must always read the live store, never a build-time snapshot — without
// this, Next statically optimizes this route (it takes no request input)
// and would keep serving whatever orders existed at build time.
export const dynamic = 'force-dynamic'

// Auth is already enforced by middleware.ts for every /api/admin/* path —
// this route only runs for a request carrying a valid admin session cookie.
export async function GET() {
  const orders = await readOrders()
  return NextResponse.json({ orders })
}
