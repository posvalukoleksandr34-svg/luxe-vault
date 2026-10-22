import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_ORDERS_LIMIT, readOrders } from '@/lib/server/orders-store'
import { requireAdmin } from '@/lib/server/admin-guard'

// Must always read the live store, never a build-time snapshot — without
// this, Next statically optimizes this route (it takes no request input)
// and would keep serving whatever orders existed at build time.
export const dynamic = 'force-dynamic'

// Auth is already enforced by middleware.ts for every /api/admin/* path —
// this route only runs for a request carrying a valid admin session cookie.
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  // `?limit=5`: the newest few (the dashboard), not the whole list.
  const asked = Number(request.nextUrl.searchParams.get('limit'))
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, ADMIN_ORDERS_LIMIT) : ADMIN_ORDERS_LIMIT
  const orders = await readOrders(limit)
  // `capped`: there may be older orders than these (see readOrders).
  return NextResponse.json({ orders, capped: orders.length >= limit, limit })
}
