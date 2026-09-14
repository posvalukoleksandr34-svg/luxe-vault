'use client'

import { BellOff, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/lib/store'

/**
 * The reminder email's "Don't remind me again" page. A button, not an
 * automatic action on load: mail-security scanners open every link in a
 * message, and an opt-out that fired on GET would unsubscribe people who never
 * clicked it.
 */
export function CartReminderOptOut({ token }: { token: string }) {
  const { t } = useStore()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  async function optOut() {
    setState('busy')
    try {
      const res = await fetch(`/api/abandoned-carts/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      })
      setState(res.ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <main id="main" className="flex min-h-[100svh] items-center justify-center bg-[#000000] px-6 py-16">
      <div className="flex max-w-md flex-col items-center text-center">
        <BellOff aria-hidden strokeWidth={1.25} className="size-9 text-[#D4AF37]" />
        <span aria-hidden className="mt-6 h-px w-12 bg-[#D4AF37]" />
        <h1 className="mt-6 font-serif text-2xl tracking-wide text-[#E5E5E5]">{t('cartReminder.unsubTitle')}</h1>
        <p className="mt-4 text-sm font-light leading-relaxed text-[#CCCCCC]">
          {state === 'done' ? t('cartReminder.unsubDone') : t('cartReminder.unsubHint')}
        </p>
        {state !== 'done' && (
          <button
            type="button"
            onClick={optOut}
            disabled={state === 'busy'}
            className="tap-safe mt-10 inline-flex items-center gap-2 border border-[#D4AF37] px-8 py-3 text-[11px] uppercase tracking-[0.2em] text-[#D4AF37] transition-colors enabled:hover:bg-[#D4AF37] enabled:hover:text-[#000000] disabled:opacity-60"
          >
            {state === 'busy' && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
            {state === 'error' ? t('pay.tryAgain') : t('cartReminder.unsubButton')}
          </button>
        )}
        <a href="/" className="mt-6 text-[11px] uppercase tracking-[0.15em] text-[#8c8c8c] hover:text-[#CCCCCC]">
          {t('state.goToCatalog')}
        </a>
      </div>
    </main>
  )
}
