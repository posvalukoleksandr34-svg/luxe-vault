'use client'

import { Link } from '@/components/locale-link'
import { BellOff, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/lib/store'

/**
 * The review-request email's "Do not send me review requests" page. A
 * button, not an automatic action on load: mail-security scanners open every
 * link in a message, and an opt-out that fired on GET would unsubscribe
 * people who never clicked it.
 */
export function ReviewRequestOptOut({ token }: { token: string }) {
  const { t } = useStore()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'invalid' | 'error'>('idle')

  async function optOut() {
    setState('busy')
    try {
      const res = await fetch(`/api/review-requests/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      })
      setState(res.ok ? 'done' : res.status === 400 || res.status === 404 ? 'invalid' : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <main id="main" className="flex min-h-[100svh] items-center justify-center bg-background px-6 py-16">
      <div className="flex max-w-md flex-col items-center text-center">
        <BellOff aria-hidden strokeWidth={1.25} className="size-9 text-gold" />
        <span aria-hidden className="mt-6 h-px w-12 bg-gold" />
        <h1 className="mt-6 font-serif text-2xl tracking-wide text-foreground">
          {state === 'invalid' ? t('reviewLink.invalidTitle') : t('reviewLink.unsubTitle')}
        </h1>
        <p className="mt-4 text-sm font-light leading-relaxed text-foreground/80">
          {state === 'done' ? t('reviewLink.unsubDone') : state === 'invalid' ? t('reviewLink.invalidHint') : t('reviewLink.unsubHint')}
        </p>
        {state !== 'done' && state !== 'invalid' && (
          <button
            type="button"
            onClick={optOut}
            disabled={state === 'busy'}
            className="tap-safe mt-10 inline-flex items-center gap-2 rounded-xl border border-gold px-8 py-3 text-[11px] uppercase tracking-[0.2em] text-gold transition-colors enabled:hover:bg-gold enabled:hover:text-gold-foreground disabled:opacity-60"
          >
            {state === 'busy' && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
            {state === 'error' ? t('pay.tryAgain') : t('reviewLink.unsubButton')}
          </button>
        )}
        <Link
          href="/" className="mt-6 text-[11px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground/80">
          {t('state.goToCatalog')}
        </Link>
      </div>
    </main>
  )
}
