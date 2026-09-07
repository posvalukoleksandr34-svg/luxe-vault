import type { CartItem, Product } from '@/lib/types'

/**
 * The shopping cart, kept in this browser across reloads.
 *
 * Until now the cart lived only in React state, so a refresh, a tab restore or
 * following a link out to the legal pages and coming back emptied it. That is
 * the single most expensive bug a shop can have: the customer has already
 * chosen, and is asked to choose again.
 *
 * WHY localStorage AND NOT A COOKIE
 *
 * A cookie is sent on every single request — page, image, API call — so a
 * five-item cart would add a kilobyte to each of them for the sole benefit of
 * being readable on the server. Nothing here needs to be read on the server:
 * the cart is rendered by client components, and the *authoritative* prices
 * are re-read from the catalogue at order time by repriceItems() in
 * lib/server/order-drafts.ts. localStorage costs nothing per request and
 * survives a browser restart, which a session cookie does not.
 *
 * WHY THIS IS NOT A SECURITY CONCERN
 *
 * Everything here is attacker-controlled by definition — it is a text file on
 * the customer's own disk, and anyone can edit it to say a coat costs CHF 1.
 * That is fine, and it is fine for exactly one reason: the server never
 * believes it. Order creation looks every line item up by `productId` and uses
 * the catalogue's price, quantity clamp and promo table. This file therefore
 * validates only enough to keep a malformed blob from crashing the UI.
 *
 * Every access is wrapped in try/catch: localStorage throws outright in some
 * contexts (Safari private mode, embedded webviews, storage disabled by
 * policy) rather than merely returning null, and a shop must not be taken
 * down by a storage preference.
 */

const STORAGE_KEY = 'lv.cart.v1'

/** Cross-tab change signal. See subscribeToCart(). */
export const CART_STORAGE_KEY = STORAGE_KEY

/**
 * A cart older than this is noise, not intent — the prices have moved and the
 * customer has long since forgotten. Refreshed on every write, so an actively
 * used cart never expires.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** Matches the clamp the server applies in repriceItems(). */
const MAX_QTY = 20

/** Keeps a hand-edited record from filling the page with junk rows. */
const MAX_ITEMS = 50

type StoredCart = {
  v: 1
  savedAt: number
  items: CartItem[]
}

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.key === 'string' &&
    typeof v.productId === 'string' &&
    typeof v.name === 'string' &&
    typeof v.image === 'string' &&
    typeof v.price === 'number' &&
    Number.isFinite(v.price) &&
    typeof v.size === 'string' &&
    typeof v.color === 'string' &&
    typeof v.qty === 'number' &&
    Number.isFinite(v.qty)
  )
}

export function readCart(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []

    const record = parsed as Partial<StoredCart>
    if (record.v !== 1 || !Array.isArray(record.items)) return []

    // A stale cart is dropped rather than shown with month-old prices.
    if (typeof record.savedAt === 'number' && Date.now() - record.savedAt > MAX_AGE_MS) {
      clearStoredCart()
      return []
    }

    return record.items
      .filter(isCartItem)
      .slice(0, MAX_ITEMS)
      .map((item) => ({
        ...item,
        qty: Math.min(MAX_QTY, Math.max(1, Math.floor(item.qty))),
      }))
  } catch {
    // Unparseable, or storage unavailable. An empty cart is wrong but safe;
    // a thrown error on mount would take the whole shop down.
    return []
  }
}

export function writeCart(items: CartItem[]): void {
  if (typeof window === 'undefined') return
  try {
    if (items.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    const payload: StoredCart = { v: 1, savedAt: Date.now(), items }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Quota exceeded, or storage blocked. The cart still works for this page
    // view; it simply will not survive the next reload.
  }
}

export function clearStoredCart(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing useful to do — the caller has already updated its own state.
  }
}

/**
 * Reconcile a restored cart against the live catalogue.
 *
 * Persistence introduces a problem that an in-memory cart never had: the saved
 * copy is a snapshot, and the catalogue moves underneath it. Without this, a
 * customer who left a coat in their cart last week sees last week's price in
 * the drawer and the *current* one on their receipt, because the server
 * reprices at order time. Nobody is overcharged, but it reads as a
 * bait-and-switch, which is worse.
 *
 * Three things are refreshed, and only three:
 *
 *   price  — realigned with the catalogue, so the drawer agrees with the
 *            receipt. This is the whole point of the function.
 *   name   — re-localised, because the cart stores the name in whatever
 *            language it was added in and a restored cart outlives a language
 *            switch.
 *   gone   — products deleted since are dropped, rather than being carried to
 *            a checkout that would reject them with "Unknown product".
 *
 * Deliberately NOT touched: `image`, `size` and `color`. The image is the one
 * for the colour variant the customer picked, not the product's default, and
 * overwriting it would quietly show them a different coat.
 *
 * Returns the same array instance when nothing changed, so the caller can skip
 * a pointless re-render.
 */
export function reconcileCart(
  items: CartItem[],
  products: Product[],
  localizeName: (name: Product['name']) => string,
): CartItem[] {
  if (items.length === 0 || products.length === 0) return items

  const byId = new Map(products.map((p) => [p.id, p]))
  let changed = false

  const next: CartItem[] = []
  for (const item of items) {
    const product = byId.get(item.productId)
    if (!product) {
      changed = true
      continue
    }

    const name = localizeName(product.name)
    if (product.price !== item.price || name !== item.name) {
      changed = true
      next.push({ ...item, price: product.price, name })
      continue
    }

    next.push(item)
  }

  return changed ? next : items
}
