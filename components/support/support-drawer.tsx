'use client'

import { useEffect, useRef } from 'react'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { usePresence } from '@/lib/use-presence'
import { SupportCenter } from '@/components/support/support-center'
import { useStore } from '@/lib/store'

/**
 * The support center as a drawer: wide on a desktop (it holds a form and a
 * conversation, not a list of four lines like the cart), the whole screen on
 * a phone. Opened with openSupport() from the launcher, the header and the
 * footer; the same center lives at /support.
 */
export function SupportDrawer() {
  const { panel, setPanel, supportEntry, t } = useStore()
  const open = panel === 'support'

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPanel(null)
    }
    window.addEventListener('keydown', onKey)
    // The page behind must not scroll along with the drawer.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, setPanel])

  const dialogRef = useRef<HTMLDivElement>(null)
  // Keyboard: Tab stays inside while open; closing returns focus to the
  // opener. Before the focusing effect, so the opener is still focused.
  useFocusTrap(dialogRef, open)
  useEffect(() => {
    if (open) dialogRef.current?.focus({ preventScroll: true })
  }, [open])

  // Mounted through its slide-out (lib/use-presence.ts); inert while leaving.
  const { mounted, state } = usePresence(open)
  if (!mounted) return null

  return (
    <>
      <div
        data-state={state}
        className="motion-scrim fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm"
        onClick={() => setPanel(null)}
        aria-hidden
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        data-state={state}
        inert={!open || undefined}
        className="motion-drawer-right fixed right-0 top-0 z-[100] flex h-full w-full flex-col border-l border-border bg-popover outline-none sm:max-w-xl lg:max-w-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('support.title')}
      >
        <SupportCenter initial={supportEntry} layout="drawer" onClose={() => setPanel(null)} />
      </div>
    </>
  )
}
