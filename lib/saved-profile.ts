/**
 * Remembered checkout details, stored in this browser.
 *
 * WHAT IS AND IS NOT KEPT HERE
 *
 * Kept: name, email, phone (+ its country), street, postcode, city, country.
 * These are the customer's own contact details, on the customer's own device,
 * and are exactly what a browser's built-in autofill would hold anyway.
 *
 * NOT kept, ever: card number, expiry, CVC, or anything else that could be
 * used to charge a card. `localStorage` is plain text on disk and is readable
 * by any script that reaches the page, so a single XSS would hand an attacker
 * every saved card at once. Holding a PAN also drags the whole site into
 * PCI-DSS scope. Saved *cards* are therefore held by Stripe against a Customer
 * object — see lib/server/stripe.ts — and this app only ever sees a brand and
 * the last four digits, which cannot be used to pay.
 *
 * Every access is wrapped in try/catch: localStorage throws outright in some
 * contexts (Safari private mode, embedded webviews, storage disabled by
 * policy) rather than merely returning null, and a checkout form must not be
 * taken down by a storage preference.
 */

const STORAGE_KEY = 'lv.checkout.profile.v1'

export type SavedProfile = {
  name: string
  email: string
  phone: string
  phoneCountry: string
  street: string
  postalCode: string
  city: string
  country: string
}

/** Guards against a hand-edited or half-written record. */
function isSavedProfile(value: unknown): value is SavedProfile {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.name === 'string' &&
    typeof v.email === 'string' &&
    typeof v.phone === 'string' &&
    typeof v.phoneCountry === 'string' &&
    typeof v.street === 'string' &&
    typeof v.postalCode === 'string' &&
    typeof v.city === 'string' &&
    typeof v.country === 'string'
  )
}

export function readSavedProfile(): SavedProfile | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isSavedProfile(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeSavedProfile(profile: SavedProfile): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // Quota exceeded, or storage blocked. The order still goes through; the
    // customer simply types their address again next time.
  }
}

export function clearSavedProfile(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing useful to do — the caller has already updated its own state.
  }
}
