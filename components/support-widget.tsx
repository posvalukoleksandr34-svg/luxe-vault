'use client'

import { LifeBuoy } from 'lucide-react'
import { useStore } from '@/lib/store'

/**
 * Floating launcher, bottom left: opens the QUICK-ANSWERS BOT
 * (components/support/chat-bot.tsx) on the right.
 *
 * The other entry point — the header's icon, top right — opens the support
 * centre itself, where a request is written by hand. Two buttons, two jobs:
 * this one is for "how long is delivery", that one is for "my parcel is
 * missing". The gold count is replies from the team the customer has not read
 * yet, which live in the support centre, so a waiting reply sends them there
 * rather than into the bot.
 */
export function SupportWidget() {
  const { t, openChat, openSupport, supportUnread } = useStore()
  const label = supportUnread > 0 ? `${t('support.title')} (${supportUnread})` : t('support.title')

  return (
    <button
      type="button"
      onClick={() => (supportUnread > 0 ? openSupport({ view: 'tickets' }) : openChat())}
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
