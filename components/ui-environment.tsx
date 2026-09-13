'use client'

import { useEffect } from 'react'
import { applyMotionPreference } from '@/lib/motion-preference'

/**
 * Two small facts about the visitor's environment, written onto <html> where
 * CSS can act on them. Renders nothing.
 *
 * data-motion="reduce" — the "reduce animations" preference (also set before
 * paint by the boot script in the layout; re-applied here after hydration).
 *
 * data-keyboard="open" — a field has focus on a touch device, so the on-screen
 * keyboard is up. Bottom-fixed furniture (the support launcher, the cookie
 * banner, the product page's buy bar) is then hidden via .hide-with-keyboard:
 * with the keyboard shrinking the viewport, those bars otherwise sit on top of
 * the very field being typed into.
 */
const EDITABLE =
  'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=reset]), textarea, select, [contenteditable="true"]'

export function UiEnvironment() {
  useEffect(() => {
    applyMotionPreference()

    const root = document.documentElement
    // A touch device either way: some report a coarse pointer, some only that
    // nothing can hover (and emulators often report just one of the two).
    const coarse = window.matchMedia?.('(pointer: coarse), (hover: none)')
    let timer: ReturnType<typeof setTimeout> | undefined

    function onFocusIn(e: FocusEvent) {
      if (!coarse?.matches) return
      const target = e.target as Element | null
      if (target?.matches?.(EDITABLE)) root.setAttribute('data-keyboard', 'open')
    }

    function onFocusOut() {
      // Focus often moves field -> field; only clear once nothing editable
      // holds it, or the bars would flash between two inputs.
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const active = document.activeElement
        if (!active || !active.matches?.(EDITABLE)) root.removeAttribute('data-keyboard')
      }, 80)
    }

    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  return null
}
