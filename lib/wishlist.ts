/**
 * Saved products ("Избранное"), kept in this browser.
 *
 * Product ids only — never prices, names or photos. The catalogue is the
 * source of truth for all of that, so a saved item always shows today's price
 * and quietly disappears from the list once it leaves the shop.
 *
 * localStorage rather than the account, deliberately: a guest can save
 * something the moment they see it, without being asked to sign in first,
 * which is the whole point of a wishlist on a shop someone is browsing for the
 * first time. (Syncing it to the account on sign-in would be a server feature;
 * the storage shape here — a plain id list — is what that would upload.)
 *
 * Every access is wrapped: localStorage throws outright in Safari private
 * mode and in some embedded webviews rather than returning null, and a
 * wishlist must never take a page down.
 */

const STORAGE_KEY = 'lv.wishlist.v1'

/** Cross-tab change signal — the `storage` event carries this key. */
export const WISHLIST_STORAGE_KEY = STORAGE_KEY

/** Same-tab change signal: `storage` does not fire in the tab that wrote. */
export const WISHLIST_EVENT = 'lv:wishlist'

/** More than anyone curates by hand; keeps a malformed blob bounded too. */
const MAX_ITEMS = 200

function parse(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    const ids: string[] = []
    for (const entry of value) {
      if (typeof entry === 'string' && entry && ids.indexOf(entry) === -1) ids.push(entry)
      if (ids.length >= MAX_ITEMS) break
    }
    return ids
  } catch {
    return []
  }
}

export function readWishlist(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

export function writeWishlist(ids: string[]): void {
  if (typeof window === 'undefined') return
  const next = ids.slice(0, MAX_ITEMS)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage full or blocked: the list still holds for this page view.
  }
  try {
    window.dispatchEvent(new CustomEvent(WISHLIST_EVENT, { detail: next }))
  } catch {
    // CustomEvent unavailable (very old webview): same-tab listeners miss it.
  }
}

/** Adds or removes one id, newest first, and returns the new list. */
/**
 * Empties this browser's list.
 *
 * Called once, after a sign-in has copied it into the account: the items are
 * safe on the server, and a copy left here would surface on the next sign-out
 * — which on a shared computer means showing a stranger what the previous
 * person had been saving.
 */
export function clearWishlist(): void {
  writeWishlist([])
}

export function toggleWishlistItem(id: string): string[] {
  const current = readWishlist()
  const next = current.indexOf(id) === -1 ? [id].concat(current) : current.filter((entry) => entry !== id)
  writeWishlist(next)
  return next
}

/**
 * Calls `listener` whenever the list changes — in this tab (WISHLIST_EVENT)
 * or another one (`storage`). Returns the unsubscribe function.
 */
export function subscribeToWishlist(listener: (ids: string[]) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onLocal = (event: Event) => {
    const detail = (event as CustomEvent<string[]>).detail
    listener(Array.isArray(detail) ? detail : readWishlist())
  }
  const onStorage = (event: StorageEvent) => {
    // A null key is localStorage.clear().
    if (event.key !== null && event.key !== STORAGE_KEY) return
    listener(readWishlist())
  }
  window.addEventListener(WISHLIST_EVENT, onLocal)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(WISHLIST_EVENT, onLocal)
    window.removeEventListener('storage', onStorage)
  }
}

// ------------------------------------------------------------ account cache

/**
 * A signed-in customer's list, as this browser last saw it.
 *
 * The account's list lives in the database, and before this nothing of it was
 * kept here: every full page load started from the (deliberately empty) guest
 * list, so the wishlist page said "empty" until the server answered — and for
 * good if it did not. The store now shows this copy the moment the session is
 * restored and replaces it with the server's answer.
 *
 * Keyed by user id, so it is only ever shown to the account it belongs to, and
 * removed on sign-out (forgetAccountWishlists) for the reason the guest list is
 * cleared at sign-in: a shared computer must not show the next person what the
 * previous one was saving.
 */
const ACCOUNT_PREFIX = 'lv.wishlist.account.'

/** The cached list for this account, or null when there is none. */
export function readAccountWishlist(userId: string): string[] | null {
  if (typeof window === 'undefined' || !userId) return null
  try {
    const raw = window.localStorage.getItem(ACCOUNT_PREFIX + userId)
    return raw === null ? null : parse(raw)
  } catch {
    return null
  }
}

export function writeAccountWishlist(userId: string, ids: string[]): void {
  if (typeof window === 'undefined' || !userId) return
  try {
    window.localStorage.setItem(ACCOUNT_PREFIX + userId, JSON.stringify(ids.slice(0, MAX_ITEMS)))
  } catch {
    // Storage full or blocked: the next page load waits for the server.
  }
}

/** Every account's cached list, gone — at sign-out. */
export function forgetAccountWishlists(): void {
  if (typeof window === 'undefined') return
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith(ACCOUNT_PREFIX)) keys.push(key)
    }
    keys.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // Blocked storage holds nothing to forget.
  }
}
