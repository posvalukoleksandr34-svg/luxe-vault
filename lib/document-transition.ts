import { DOC_TRANSITION_KEY } from '@/lib/motion-boot'
import { motionReduced } from '@/lib/motion'

/**
 * A full page load that opens like an in-page transition: the next page grows
 * out of `from` (the button pressed) and its content settles in.
 *
 * For the pages that must be reached by a real navigation — the checkout and
 * its confirmation are served with their own Content-Security-Policy, which
 * belongs to the document (middleware.ts). It leaves a short note for the
 * browser's cross-document view transition and navigates; the handlers in
 * lib/motion-boot.ts play the transition only when the page that arrives is
 * the one the note names. Never delays or blocks the navigation: with no API,
 * reduced motion, a hidden tab or no storage, it is simply the page load.
 */
export function navigateWithTransition(href: string, options: { from?: Element | null; replace?: boolean } = {}): void {
  try {
    if (!motionReduced() && document.visibilityState === 'visible') {
      const path = new URL(href, window.location.href).pathname
      const box = options.from?.getBoundingClientRect()
      const origin = box && box.width > 0 ? { ox: Math.round(box.left + box.width / 2), oy: Math.round(box.top + box.height / 2) } : {}
      sessionStorage.setItem(DOC_TRANSITION_KEY, JSON.stringify({ path, at: Date.now(), ...origin }))
    }
  } catch {
    // No storage (private mode, blocked): no transition, same navigation.
  }
  if (options.replace) window.location.replace(href)
  else window.location.assign(href)
}
