import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { ReturnsManager, type ReturnRow } from '@/components/admin/returns-manager'
import { returnsFilterSchema } from '@/lib/returns/schema'
import { isAdminRequest } from '@/lib/server/admin-guard'
import { getOrderById } from '@/lib/server/orders-store'
import { listReturnRequests, signReturnImages } from '@/lib/server/returns-store'
import type { ReturnRequestStatus } from '@/lib/types'

// Always the live queue: this is where decisions are made, and a cached render
// would show a request as pending after a colleague had already decided it.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Возвраты',
  robots: { index: false, follow: false },
}

/**
 * /admin/returns — the queue of return requests, and where they are decided.
 *
 * The whole list is read once and filtered here rather than queried per tab:
 * one round trip gives both the rows for the chosen filter and the count on
 * every tab, and a returns queue is tens of rows, not thousands. Capped at 500
 * all the same, so a shop that grows past that degrades to "the newest 500"
 * rather than to a page that times out.
 *
 * Photographs are SIGNED here, on the server, for ten minutes. The bucket is
 * private — these are pictures of a customer's property — so there is no
 * public URL to hand the browser, and a signed one copied out of this page
 * stops working shortly after.
 */
export default async function AdminReturnsPage({
  searchParams,
}: {
  searchParams: { status?: string }
}) {
  // Second gate behind middleware.ts (lib/server/admin-guard.ts explains why).
  if (!(await isAdminRequest())) redirect('/')

  // An unknown ?status= falls back to the pending queue rather than to "all":
  // a typo in a bookmark should land where the work is.
  const filter = returnsFilterSchema.safeParse(searchParams.status).success
    ? returnsFilterSchema.parse(searchParams.status)
    : 'pending'

  const all = await listReturnRequests(undefined, 500)

  const counts: Record<'all' | ReturnRequestStatus, number> = {
    all: all.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    completed: 0,
  }
  for (const r of all) counts[r.status] += 1

  const visible = filter === 'all' ? all : all.filter((r) => r.status === filter)

  // The order behind each request, and its photographs. In parallel — each is
  // independent — and per row rather than batched, because the store already
  // has getOrderById and the queue is short.
  const rows: ReturnRow[] = await Promise.all(
    visible.map(async (request) => {
      const [order, imageUrls] = await Promise.all([
        getOrderById(request.orderNumber).catch(() => null),
        signReturnImages(request.images),
      ])
      return {
        request,
        imageUrls,
        order: order
          ? {
              id: order.id,
              createdAt: order.createdAt,
              customerName: order.customer.name,
              customerEmail: order.customer.email ?? '',
              total: order.total,
              refundedAmount: order.refundedAmount ?? 0,
              paymentProvider: order.paymentProvider ?? '',
              paymentStatus: order.paymentStatus ?? '',
              items: order.items.map((item) => ({
                key: item.key,
                name: item.name,
                image: item.image,
                size: item.size,
                color: item.color,
                qty: item.qty,
                price: item.price,
              })),
            }
          : null,
      }
    }),
  )

  return <ReturnsManager filter={filter} counts={counts} rows={rows} />
}
