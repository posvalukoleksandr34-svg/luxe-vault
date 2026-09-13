'use client'

import { useStore } from '@/lib/store'

/**
 * "Skip to content", in the visitor's language. Visually hidden until focused
 * — `sr-only focus:not-sr-only` — so it costs sighted visitors nothing and
 * appears the moment it is reachable. Kept first in the tab order: the header
 * carries a logo, the nav, search, the language menu and four icon buttons,
 * which a keyboard user would otherwise tab through on every page.
 */
export function SkipLink() {
  const { t } = useStore()
  return (
    <a
      href="#main"
      className="sr-only left-4 top-4 z-[200] border border-gold bg-background px-4 py-2 text-[12px] uppercase tracking-[0.12em] text-gold focus:not-sr-only focus:absolute"
    >
      {t('a11y.skipToContent')}
    </a>
  )
}
