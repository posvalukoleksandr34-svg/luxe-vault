'use client'

/**
 * The browser's own record of the orders it placed: an { id, token } pair per
 * order, kept in local storage. The store has no server-side customer
 * accounts, so this registry is what lets the personal-account panel pull a
 * shopper's orders back from the server — including unpaid ones placed days
 * earlier — without exposing anybody else's order to a guessed id.
 */
export const ORDER_REGISTRY_KEY = 'luxe-vault-orders'

export type OrderCredential = { id: string; token: string }

const MAX_ENTRIES = 50

export function readOrderRegistry(): OrderCredential[] {
  try {
    const raw = window.localStorage.getItem(ORDER_REGISTRY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is OrderCredential =>
        Boolean(entry) && typeof entry.id === 'string' && typeof entry.token === 'string',
    )
  } catch {
    return []
  }
}

export function rememberOrder(credential: OrderCredential): void {
  if (!credential.id || !credential.token) return
  try {
    const existing = readOrderRegistry().filter((entry) => entry.id !== credential.id)
    const next = [credential, ...existing].slice(0, MAX_ENTRIES)
    window.localStorage.setItem(ORDER_REGISTRY_KEY, JSON.stringify(next))
  } catch {
    // Local storage unavailable (private mode, quota) — the order still
    // exists server-side, it just won't be listed in this browser.
  }
}

export function forgetOrder(id: string): void {
  try {
    const next = readOrderRegistry().filter((entry) => entry.id !== id)
    window.localStorage.setItem(ORDER_REGISTRY_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

/**
 * Fetches the full, current server-side record for every order this browser
 * knows about, plus every order bound to the signed-in account.
 *
 * Note there is no early return on an empty registry: a customer signed in on
 * a new device holds no local tokens, but the endpoint still resolves their
 * order history from the session.
 */
export async function fetchMyOrders(): Promise<import('@/lib/types').Order[]> {
  const result = await loadMyOrders()
  if (!result.ok) throw new Error('order lookup failed')
  return result.orders
}

/**
 * The same lookup, but it says whether it WORKED.
 *
 * This exists because the version above returned `[]` on any failure, and
 * every caller rendered that as an empty state. A dropped connection or a 500
 * therefore told a customer with a dozen orders "you have no orders yet" — and
 * on /order/[id], that their order could not be found. Both are assertions
 * about their account that the app had no evidence for; the only thing that
 * had actually happened was a failed request.
 *
 * `ok: false` is not the same as `orders: []`, and callers must render them
 * differently: one is a fact, the other is an apology with a retry button.
 */
export async function loadMyOrders(): Promise<
  { ok: true; orders: import('@/lib/types').Order[] } | { ok: false; orders: [] }
> {
  const credentials = readOrderRegistry()
  try {
    const res = await fetch('/api/orders/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: credentials }),
    })
    if (!res.ok) return { ok: false, orders: [] }
    const data = await res.json()
    // A 200 whose body is not the expected shape is still a failure — better
    // to offer a retry than to report an empty history on malformed JSON.
    if (!Array.isArray(data.orders)) return { ok: false, orders: [] }
    return { ok: true, orders: data.orders }
  } catch {
    return { ok: false, orders: [] }
  }
}

export function tokenFor(id: string): string | null {
  return readOrderRegistry().find((entry) => entry.id === id)?.token ?? null
}
