// Server-only persistence for orders. Backed by a JSON file on disk rather
// than an external database — this project has no provisioned DB (the
// Supabase client is installed but never configured), so this file is the
// lightweight "database" the admin delete endpoint permanently writes to.
//
// Caveat: on a serverless deployment (Vercel/Netlify) the filesystem is
// read-only outside of /tmp, so writes won't durably survive across cold
// starts there. Locally (`npm run dev`) and on a persistent Node host, this
// file is the real, durable record. Swap this module for a hosted database
// (e.g. the already-installed @supabase/supabase-js client, once configured)
// before relying on it in a serverless production deployment.
import { promises as fs } from 'fs'
import path from 'path'
import { SEED_ORDERS } from '@/lib/data'
import type { Order, OrderStatus, PaymentStatus } from '@/lib/types'

const DATA_DIR = path.join(process.cwd(), 'data')
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json')

async function ensureFile(): Promise<void> {
  try {
    await fs.access(ORDERS_FILE)
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.writeFile(ORDERS_FILE, JSON.stringify(SEED_ORDERS, null, 2), 'utf-8')
  }
}

export async function readOrders(): Promise<Order[]> {
  await ensureFile()
  try {
    const raw = await fs.readFile(ORDERS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeOrders(orders: Order[]): Promise<void> {
  await ensureFile()
  await fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf-8')
}

export async function addOrder(order: Order): Promise<void> {
  const orders = await readOrders()
  await writeOrders([order, ...orders])
}

export async function getOrderById(id: string): Promise<Order | null> {
  const orders = await readOrders()
  return orders.find((o) => o.id === id) ?? null
}

/** Looks up several orders at once, returning only those whose lookup token
 * matches the one supplied by the caller. Used by the customer's own browser
 * to re-read the orders it placed without any server-side account. */
export async function getOrdersByCredentials(
  credentials: { id: string; token: string }[],
): Promise<Order[]> {
  const orders = await readOrders()
  const wanted = new Map(credentials.map((c) => [c.id, c.token]))
  return orders.filter((o) => {
    const token = wanted.get(o.id)
    return Boolean(token) && Boolean(o.lookupToken) && o.lookupToken === token
  })
}

/** Attaches a freshly created payment-gateway session to an existing order,
 * used both when the order is first placed and when the customer comes back
 * to pay it later. */
export async function setOrderPaymentSession(
  id: string,
  session: Pick<
    Order,
    | 'paymentStatus'
    | 'paymentProvider'
    | 'paymentId'
    | 'paymentCurrency'
    | 'paymentAddress'
    | 'paymentAmount'
    | 'payment'
  >,
): Promise<Order | null> {
  const orders = await readOrders()
  let updated: Order | null = null
  const next = orders.map((o) => {
    if (o.id !== id) return o
    updated = { ...o, ...session }
    return updated
  })
  if (updated) await writeOrders(next)
  return updated
}

export async function findOrderByPaymentId(paymentId: string): Promise<Order | null> {
  const orders = await readOrders()
  return orders.find((o) => o.paymentId === paymentId) ?? null
}

/** Advances a crypto order's payment lifecycle. Only ever called from the
 * signature-verified webhook handler — never trust a client-supplied
 * payment status. */
export async function setPaymentStatus(
  paymentId: string,
  paymentStatus: PaymentStatus,
): Promise<Order | null> {
  const orders = await readOrders()
  let updated: Order | null = null
  const next = orders.map((o) => {
    if (o.paymentId !== paymentId) return o
    updated = { ...o, paymentStatus }
    return updated
  })
  if (updated) await writeOrders(next)
  return updated
}

export async function setOrderStatus(
  id: string,
  status: OrderStatus,
): Promise<Order | null> {
  const orders = await readOrders()
  let updated: Order | null = null
  const next = orders.map((o) => {
    if (o.id !== id) return o
    updated = { ...o, status }
    return updated
  })
  if (updated) await writeOrders(next)
  return updated
}

/** Permanently removes the order from the store. Returns false if no order
 * with that id existed. */
export async function deleteOrder(id: string): Promise<boolean> {
  const orders = await readOrders()
  const next = orders.filter((o) => o.id !== id)
  const removed = next.length !== orders.length
  if (removed) await writeOrders(next)
  return removed
}
