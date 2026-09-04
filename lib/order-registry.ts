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

/** Fetches the full, current server-side record for every order this browser
 * knows about. */
export async function fetchMyOrders(): Promise<import('@/lib/types').Order[]> {
  const credentials = readOrderRegistry()
  if (credentials.length === 0) return []
  try {
    const res = await fetch('/api/orders/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: credentials }),
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data.orders) ? data.orders : []
  } catch {
    return []
  }
}

export function tokenFor(id: string): string | null {
  return readOrderRegistry().find((entry) => entry.id === id)?.token ?? null
}
