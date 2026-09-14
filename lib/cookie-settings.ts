/**
 * Reopening the cookie banner, kept apart from the banner itself.
 *
 * The footer's "Cookie settings" link needs only this; importing it from
 * components/cookie-consent.tsx used to pull the whole banner into every
 * page's first-load JS, which stopped the banner from being lazy-loaded.
 */

/** Event the footer link fires to reopen the banner for withdrawal. */
export const REOPEN_EVENT = 'lv:cookie-consent:reopen'

/** Call from anywhere to let a visitor change or withdraw their choice. */
export function openCookieSettings(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(REOPEN_EVENT))
}
