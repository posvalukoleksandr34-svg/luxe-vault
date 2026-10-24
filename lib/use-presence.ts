import { useEffect, useState } from 'react'
import { MOTION_MS, exitDelay } from '@/lib/motion'

/**
 * Keeps an overlay in the document while it animates out.
 *
 * `if (!open) return null` removes a drawer or dialog the instant it closes,
 * so it can only ever appear, never leave. This keeps it mounted until its
 * exit has played:
 *
 *   mounted  render the overlay at all
 *   state    'open' | 'closed' — put it on the element as data-state; the
 *            .motion-* classes in globals.css animate between the two
 *
 * On open the element is first rendered closed and switched to open two
 * frames later, so the browser has a starting position to transition from.
 * On close it switches to closed at once and unmounts after `exitMs`, or
 * immediately when motion is reduced (globals.css has already made the
 * change instant).
 *
 * Focus and focus traps should follow `state === 'open'`, not `open`: on the
 * render where `open` turns true the element is not in the document yet.
 *
 * The cart drawer introduced this pattern (components/cart-panel.tsx); this is
 * the same thing, shared.
 */
export function usePresence(open: boolean, exitMs: number = MOTION_MS.base): { mounted: boolean; state: 'open' | 'closed' } {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      let second = 0
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(first)
        cancelAnimationFrame(second)
      }
    }
    setShown(false)
    const timer = setTimeout(() => setMounted(false), exitDelay(exitMs))
    return () => clearTimeout(timer)
  }, [open, exitMs])

  return { mounted: mounted || open, state: open && shown ? 'open' : 'closed' }
}
