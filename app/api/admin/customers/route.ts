import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

/**
 * The customer list, with what each is worth.
 *
 * Aggregated from orders rather than stored on the profile: a
 * `lifetime_value` column would be a cache that goes stale the moment an order
 * is refunded, and nothing here is hot enough to need one.
 *
 * REFUNDS ARE SUBTRACTED. A customer who ordered CHF 2000 and was refunded
 * CHF 1800 is not a CHF 2000 customer, and a list that says otherwise will be
 * used to make decisions about who to look after.
 *
 * Cancelled orders are excluded from both the count and the total — they are
 * things that did not happen.
 */
export async function GET() {
  const supabase = createAdminClient()

  const [profilesRes, ordersRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, email, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('orders')
      .select('user_id, customer_email, total, refunded_amount, status, payment_status, created_at')
      .limit(5000),
  ])

  if (profilesRes.error) {
    console.error('[admin/customers] profiles read failed:', profilesRes.error.message)
    return NextResponse.json({ error: 'Could not load customers' }, { status: 500 })
  }
  if (ordersRes.error) {
    console.error('[admin/customers] orders read failed:', ordersRes.error.message)
    return NextResponse.json({ error: 'Could not load orders' }, { status: 500 })
  }

  type Agg = { orders: number; spent: number; lastOrderAt: number | null; paid: number }
  const byUser = new Map<string, Agg>()
  const byEmail = new Map<string, Agg>()

  const bump = (map: Map<string, Agg>, key: string, row: Record<string, unknown>) => {
    const existing = map.get(key) ?? { orders: 0, spent: 0, lastOrderAt: null, paid: 0 }

    const cancelled = row.status === 'cancelled'
    const total = Number(row.total) || 0
    const refunded = Number(row.refunded_amount) || 0

    if (!cancelled) {
      existing.orders += 1
      // Net of refunds, and never negative — an over-refund is a data problem,
      // not a customer who owes money.
      existing.spent += Math.max(0, total - refunded)
      if (row.payment_status === 'paid') existing.paid += 1
    }

    const at = new Date(row.created_at as string).getTime()
    if (!existing.lastOrderAt || at > existing.lastOrderAt) existing.lastOrderAt = at

    map.set(key, existing)
  }

  for (const row of ordersRes.data ?? []) {
    if (row.user_id) bump(byUser, row.user_id as string, row)
    // Guest orders have no user_id. Keyed by email so they still appear, and
    // so a customer who bought as a guest before registering is matched to
    // their account below.
    else if (row.customer_email) bump(byEmail, String(row.customer_email).toLowerCase(), row)
  }

  const customers = (profilesRes.data ?? []).map((p) => {
    const email = String(p.email ?? '').toLowerCase()
    const own = byUser.get(p.id as string)
    const guest = byEmail.get(email)

    return {
      id: p.id as string,
      name: (p.name as string) ?? '',
      email: (p.email as string) ?? '',
      registeredAt: new Date(p.created_at as string).getTime(),
      orders: (own?.orders ?? 0) + (guest?.orders ?? 0),
      paidOrders: (own?.paid ?? 0) + (guest?.paid ?? 0),
      spent: Math.round(((own?.spent ?? 0) + (guest?.spent ?? 0)) * 100) / 100,
      lastOrderAt:
        Math.max(own?.lastOrderAt ?? 0, guest?.lastOrderAt ?? 0) || null,
    }
  })

  // Most valuable first: the list exists to answer "who matters", and sorting
  // by registration date answers a question nobody asked.
  customers.sort((a, b) => b.spent - a.spent)

  return NextResponse.json({ customers })
}
