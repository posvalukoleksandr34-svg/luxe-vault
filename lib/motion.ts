/**
 * The motion system's tokens, for the few places that need them in script.
 *
 * The CSS side is the source of truth: app/globals.css → "Motion system"
 * defines the same durations and curves as custom properties (--motion-*,
 * --ease-*), and every component styles its movement with those. Script only
 * needs durations for one thing: knowing when an exit animation has finished,
 * so the element can be unmounted (lib/use-presence.ts). Keep the two in step.
 *
 *   instant  120 ms  press feedback
 *   fast     180 ms  small state changes; anything leaving
 *   base     240 ms  popovers, scrims, results changing in place
 *   panel    320 ms  drawers and dialogs arriving
 *   page     300 ms  the incoming page (the outgoing one takes `fast`)
 *   shared   420 ms  a product photo travelling from its card to its page
 *
 * Phones run the larger ones a little shorter (globals.css, max-width 767px):
 * the distances are smaller and a mid-range phone should never feel behind.
 *
 * Curves:
 *   standard    cubic-bezier(0.2, 0, 0, 1)     most state changes
 *   emphasized  cubic-bezier(0.16, 1, 0.3, 1)  arrivals: fast start, long settle
 *   exit        cubic-bezier(0.4, 0, 1, 1)     departures: gentle start, quick finish
 */
export const MOTION_MS = {
  instant: 120,
  fast: 180,
  base: 240,
  panel: 320,
  page: 300,
  shared: 420,
} as const

/**
 * The visitor asked for less motion: in the OS, or with the switch in
 * their account settings.
 * Both are mirrored onto <html data-motion="reduce"> (lib/motion-preference.ts
 * and the boot script), which collapses every CSS animation and transition;
 * script-driven motion asks this.
 */
export function motionReduced(): boolean {
  if (typeof window === 'undefined') return false
  return (
    document.documentElement.dataset.motion === 'reduce' ||
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  )
}

/**
 * How long to keep an element mounted for its exit animation: the token, or
 * nothing at all when motion is reduced (the CSS has already collapsed it).
 */
export function exitDelay(ms: number = MOTION_MS.fast): number {
  return motionReduced() ? 0 : ms
}
