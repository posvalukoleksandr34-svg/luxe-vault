/**
 * The wishlist ("Избранное") was retired in 2026-10: the hearts, the saved
 * products page and the account sync are gone.
 *
 * What it kept in browsers is cleared here once per page load, so a device
 * holds nothing the shop no longer uses — the guest list (lv.wishlist.v1) and
 * the per-account copies (lv.wishlist.account.<user id>). The account rows in
 * the database (wishlist_items, migration 0021) stay until the account is
 * deleted, which removes them with everything else.
 */

const GUEST_KEY = 'lv.wishlist.v1'
const ACCOUNT_PREFIX = 'lv.wishlist.account.'

export function forgetSavedProducts(): void {
  if (typeof window === 'undefined') return
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && (key === GUEST_KEY || key.startsWith(ACCOUNT_PREFIX))) keys.push(key)
    }
    keys.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // Blocked storage holds nothing to forget.
  }
}
