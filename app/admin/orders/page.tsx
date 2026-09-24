import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { OrdersManager } from '@/components/admin/orders-manager'
import { isAdminRequest } from '@/lib/server/admin-guard'
import { readOrders } from '@/lib/server/orders-store'

// Always the live list: statuses are changed here, and a cached render would
// show a colleague's shipped order as still waiting.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Заказы',
  robots: { index: false, follow: false },
}

/**
 * /admin/orders — every order as a table, and where each is processed:
 * status and tracking, refund, invoice and packing slip, deletion.
 *
 * `?order=LV-XXXXXX` opens that order (the dashboard links here that way).
 */
export default async function AdminOrdersPage({ searchParams }: { searchParams: { order?: string } }) {
  // Second gate behind middleware.ts (lib/server/admin-guard.ts explains why).
  if (!(await isAdminRequest())) redirect('/')

  let orders: Awaited<ReturnType<typeof readOrders>> = []
  let loadError = false
  try {
    orders = await readOrders()
  } catch (e) {
    console.error('[admin/orders] read failed:', (e as Error).message)
    loadError = true
  }

  const requested = typeof searchParams.order === 'string' ? searchParams.order.trim().toUpperCase() : ''
  const initialOrderId = orders.some((o) => o.id === requested) ? requested : null

  return <OrdersManager initialOrders={orders} initialOrderId={initialOrderId} loadError={loadError} />
}
