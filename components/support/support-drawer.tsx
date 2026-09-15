'use client'

import { useEffect } from 'react'
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

  if (!open) return null

  return (
    <>
      <div
        className="animate-fade-in fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm"
        onClick={() => setPanel(null)}
        aria-hidden
      />
      <div
        className="animate-slide-in-right fixed right-0 top-0 z-[100] flex h-full w-full flex-col border-l border-border bg-popover sm:max-w-xl lg:max-w-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('support.title')}
      >
        <SupportCenter initial={supportEntry} layout="drawer" onClose={() => setPanel(null)} />
      </div>
    </>
  )
}
