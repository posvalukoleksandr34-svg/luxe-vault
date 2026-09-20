'use client'

import { LifeBuoy } from 'lucide-react'
import { useStore } from '@/lib/store'

/** Floating support launcher, fixed bottom-left. Opens the support center
 * drawer (components/support/support-drawer.tsx): help, the request form, and
 * the customer's requests with our replies. The gold count is replies from the
 * team the customer has not read yet. */
export function SupportWidget() {
  const { t, openSupport, supportUnread } = useStore()
  const label = supportUnread > 0 ? `${t('support.title')} (${supportUnread})` : t('support.title')

  return (
    <button
      type="button"
      onClick={() => openSupport()}
      aria-label={label}
      className="hide-with-keyboard group fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-5 z-[40] md:bottom-5 flex items-center gap-2.5 border border-gold/40 bg-background px-4 py-3 text-gold shadow-2xl transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
    >
      <LifeBuoy className="size-[18px]" />
      <span className="hidden text-[11px] uppercase tracking-[0.2em] sm:inline">{t('support.title')}</span>
      {supportUnread > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold tabular-nums text-gold-foreground group-hover:bg-gold-foreground group-hover:text-gold">
          {supportUnread}
        </span>
      )}
    </button>
  )
}
