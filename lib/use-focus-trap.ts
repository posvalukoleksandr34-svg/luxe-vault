'use client'

import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert],[aria-hidden="true"]') && el.getClientRects().length > 0,
  )
}

/**
 * Keyboard behaviour for the shop's own modal drawers (cart, account,
 * support) — what Radix's Dialog gives the others:
 *
 *   - Tab and Shift+Tab cycle inside the open panel instead of wandering onto
 *     the dimmed page behind it (WCAG 2.4.3 Focus Order; aria-modal promises
 *     exactly this to screen readers);
 *   - closing returns focus to whatever opened it (the cart button), so a
 *     keyboard user is not dropped at the top of the document.
 *
 * Moving focus INTO the panel on open stays with each component, which knows
 * what should receive it.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = ref.current

    function onKeyDown(e: KeyboardEvent) {
      const root = ref.current
      if (e.key !== 'Tab' || !root) return
      const items = focusables(root)
      if (items.length === 0) {
        e.preventDefault()
        root.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      if (!root.contains(current)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && (current === first || current === root)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && current === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Back to the opener — unless focus has already been put somewhere on
      // purpose (a link inside the panel navigated, a toast took it).
      const current = document.activeElement
      if (opener && document.contains(opener) && (!current || current === document.body || panel?.contains(current))) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [active, ref])
}
