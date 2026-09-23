import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  ReturnReason,
  ReturnRequest,
  ReturnRequestStatus,
} from '@/lib/types'

/**
 * Return requests (public.return_requests, migration 0039).
 *
 * Every write here uses the service-role key. The table has an INSERT policy
 * for a signed-in customer and NO update policy at all — approving a refund is
 * the service role's alone — so the decision paths could not be a client call
 * even if we wanted them to be.
 *
 * THE ORDER AND THE REQUEST MOVE TOGETHER. `orders.return_status` is the
 * summary every order listing already reads (migration 0004); this table is
 * the detail. Each function below writes both, in that order: the request
 * first, because it carries the evidence, then the order. A failure between
 * the two leaves the request as the record of what happened, which is the
 * recoverable way round — an order flagged for a return nobody can find is
 * worse than a request whose order has not caught up.
 *
 * TOLERANT OF THE MIGRATION NOT BEING APPLIED. Until 0039 runs, the table does
 * not exist; the reads answer empty and the writes report it, rather than
 * throwing a Postgres error into a customer's checkout. The same pattern as
 * lib/server/order-locale.ts.
 */

let tableMissing = false

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /relation .*return_requests.* does not exist/i.test(error.message ?? '')
  )
}

function noteMissing(): void {
  if (tableMissing) return
  tableMissing = true
  console.warn('[returns] public.return_requests is missing — apply migration 0039.')
}

type Row = Record<string, unknown>

function rowToRequest(row: Row): ReturnRequest {
  const order = row.orders as { order_number?: string } | null
  return {
    id: row.id as string,
    orderNumber: (order?.order_number as string) ?? (row.order_number as string) ?? '',
    userId: (row.user_id as string | null) ?? undefined,
    reason: row.reason as ReturnReason,
    comment: (row.comment as string | null) ?? '',
    images: Array.isArray(row.images) ? (row.images as string[]) : [],
    status: row.status as ReturnRequestStatus,
    adminNotes: (row.admin_notes as string | null) ?? undefined,
    createdAt: Date.parse(row.created_at as string),
    decidedAt: row.decided_at ? Date.parse(row.decided_at as string) : undefined,
  }
}

// `orders` is joined so a manager reads the order's number, not its uuid.
const SELECT = 'id, order_id, user_id, reason, comment, images, status, admin_notes, created_at, decided_at, orders(order_number)'

export type CreateResult =
  | { ok: true; request: ReturnRequest }
  | { ok: false; reason: 'unavailable' | 'no_order' | 'already_open' }

/**
 * Files a request, and flags the order.
 *
 * The caller has already established that the order is the customer's and is
 * paid; this does not re-check ownership, it records the decision. What it
 * DOES enforce is one open request per order — and by catching the unique
 * index rather than reading first, so two taps on the button cannot both pass
 * a check and then both insert.
 */
export async function createReturnRequest(input: {
  /** The LV-XXXXXX number. The uuid the row is keyed on is resolved here
   *  rather than being carried through the application: `Order.id` is the
   *  number everywhere else, and widening that type for one insert would put
   *  a second identifier into every order the shop touches. */
  orderNumber: string
  userId?: string
  reason: ReturnReason
  comment: string
  images: string[]
}): Promise<CreateResult> {
  if (tableMissing) return { ok: false, reason: 'unavailable' }
  const admin = createAdminClient()

  const { data: orderRow, error: lookupError } = await admin
    .from('orders')
    .select('id')
    .eq('order_number', input.orderNumber)
    .maybeSingle()

  if (lookupError) throw new Error(`Failed to find the order: ${lookupError.message}`)
  if (!orderRow) return { ok: false, reason: 'no_order' }
  const orderUuid = (orderRow as { id: string }).id

  const { data, error } = await admin
    .from('return_requests')
    .insert({
      order_id: orderUuid,
      user_id: input.userId ?? null,
      reason: input.reason,
      comment: input.comment,
      images: input.images,
      status: 'pending',
    })
    .select(SELECT)
    .maybeSingle()

  if (error) {
    if (isMissingTable(error)) {
      noteMissing()
      return { ok: false, reason: 'unavailable' }
    }
    // 23505: the partial unique index — this order already has one open.
    if (error.code === '23505') return { ok: false, reason: 'already_open' }
    throw new Error(`Failed to file the return request: ${error.message}`)
  }
  if (!data) return { ok: false, reason: 'no_order' }

  // The order's own summary. Not conditional on return_status being 'none':
  // a rejected return may be re-requested, and the request above is what
  // guards against a duplicate open one.
  const { error: orderError } = await admin
    .from('orders')
    .update({
      return_status: 'requested',
      return_reason: input.reason,
      return_requested_at: new Date().toISOString(),
    })
    .eq('id', orderUuid)

  if (orderError) {
    // The request is filed and is the record that matters; the summary can be
    // repaired. Loud, because a listing that does not show it needs a human.
    console.error(`[returns] filed ${(data as Row).id} but could not flag ${input.orderNumber}: ${orderError.message}`)
  }

  return { ok: true, request: rowToRequest(data as Row) }
}

/** One request, by id. */
export async function getReturnRequest(id: string): Promise<ReturnRequest | null> {
  if (tableMissing) return null
  const { data, error } = await createAdminClient()
    .from('return_requests')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    if (isMissingTable(error)) {
      noteMissing()
      return null
    }
    throw new Error(`Failed to read the return request: ${error.message}`)
  }
  return data ? rowToRequest(data as Row) : null
}

/** The manager's queue. `status` omitted returns every state, newest first. */
export async function listReturnRequests(
  status?: ReturnRequestStatus,
  limit = 100,
): Promise<ReturnRequest[]> {
  if (tableMissing) return []
  let query = createAdminClient()
    .from('return_requests')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500))

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) {
    if (isMissingTable(error)) {
      noteMissing()
      return []
    }
    throw new Error(`Failed to list return requests: ${error.message}`)
  }
  return (data ?? []).map((row) => rowToRequest(row as Row))
}

/** A customer's own requests, for the account page. */
export async function listReturnRequestsForUser(userId: string): Promise<ReturnRequest[]> {
  if (tableMissing) return []
  const { data, error } = await createAdminClient()
    .from('return_requests')
    .select(SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    if (isMissingTable(error)) {
      noteMissing()
      return []
    }
    throw new Error(`Failed to list return requests: ${error.message}`)
  }
  return (data ?? []).map((row) => rowToRequest(row as Row))
}

/**
 * Moves a request to a new state, only from the state it is expected to be in.
 *
 * `from` is what makes this safe to call from two places at once: a manager
 * approving while a colleague rejects, or a retried action. The update matches
 * nothing the second time, and the caller is told rather than overwriting a
 * decision that has already been made — and, for `completed`, rather than
 * refunding twice.
 */
export async function moveReturnRequest(
  id: string,
  from: ReturnRequestStatus | ReturnRequestStatus[],
  to: ReturnRequestStatus,
  adminNotes?: string,
): Promise<ReturnRequest | null> {
  if (tableMissing) return null
  const expected = Array.isArray(from) ? from : [from]

  const { data, error } = await createAdminClient()
    .from('return_requests')
    .update({
      status: to,
      ...(adminNotes === undefined ? {} : { admin_notes: adminNotes }),
      decided_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', expected)
    .select(SELECT)
    .maybeSingle()

  if (error) {
    if (isMissingTable(error)) {
      noteMissing()
      return null
    }
    throw new Error(`Failed to update the return request: ${error.message}`)
  }
  return data ? rowToRequest(data as Row) : null
}

/** The order's summary, kept in step with a decision. */
export async function setOrderReturnStatus(
  orderNumber: string,
  status: 'none' | 'requested' | 'approved' | 'refunded' | 'rejected',
): Promise<void> {
  const { error } = await createAdminClient()
    .from('orders')
    .update({ return_status: status })
    .eq('order_number', orderNumber)

  if (error) throw new Error(`Failed to set the order's return status: ${error.message}`)
}

/**
 * Short-lived URLs for a request's photographs.
 *
 * The bucket is private, so there is no public URL to store. Signing at read
 * time also means a link copied out of the admin panel stops working, which is
 * the point: these are pictures of a customer's property.
 */
export async function signReturnImages(paths: string[], seconds = 600): Promise<string[]> {
  if (paths.length === 0) return []
  const { data, error } = await createAdminClient()
    .storage.from('returns')
    .createSignedUrls(paths, seconds)

  if (error) {
    console.warn(`[returns] could not sign images: ${error.message}`)
    return []
  }
  // An entry can carry an error instead of a URL — a path that no longer
  // exists, say — so the nulls are dropped rather than rendered as broken
  // images in the manager's view.
  return (data ?? [])
    .map((entry) => entry.signedUrl)
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
}
