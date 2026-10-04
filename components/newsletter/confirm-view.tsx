'use client'

import { Loader2 } from 'lucide-react'
import { Link } from '@/components/locale-link'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useStore } from '@/lib/store'

type State = 'ready' | 'working' | 'confirmed' | 'invalid' | 'error'

/**
 * Where the newsletter's confirmation link lands (double opt-in).
 *
 * The subscription is confirmed by pressing the button, not by opening the
 * page: mail security scanners open every link in a message, and some run its
 * scripts too, so only a click is evidence that the owner of the address
 * agreed.
 */
export function ConfirmView() {
  const { t } = useStore()
  const token = useSearchParams().get('token') ?? ''
  const [state, setState] = useState<State>(token ? 'ready' : 'invalid')

  async function confirm() {
    setState('working')
    try {
      const res = await fetch('/api/newsletter/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      setState(res.ok ? 'confirmed' : res.status === 404 ? 'invalid' : 'error')
    } catch {
      setState('error')
    }
  }

  const button =
    'inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border px-7 text-[11px] uppercase tracking-[0.2em] transition-colors disabled:opacity-60'

  const title = {
    ready: t('newsConfirm.title'),
    working: t('newsConfirm.title'),
    confirmed: t('newsConfirm.doneTitle'),
    invalid: t('unsub.invalidTitle'),
    error: t('unsub.error'),
  }[state]

  return (
    <div role="status" className="w-full text-center">
      <h1 className="text-balance font-serif text-[32px] font-normal leading-tight tracking-tight text-foreground sm:text-[40px]">
        {title}
      </h1>
      <p className="mx-auto mt-4 max-w-md text-[14px] font-light leading-relaxed text-muted-foreground">
        {state === 'confirmed' ? t('newsConfirm.doneBody') : state === 'invalid' ? t('newsConfirm.invalidBody') : t('newsConfirm.body')}
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        {(state === 'ready' || state === 'working' || state === 'error') && (
          <button
            type="button"
            disabled={state === 'working'}
            onClick={() => void confirm()}
            className={`${button} border-gold bg-gold text-gold-foreground hover:bg-gold/90`}
          >
            {state === 'working' && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t('newsConfirm.button')}
          </button>
        )}
        <Link href="/" className={`${button} border-border/60 text-foreground hover:border-foreground/40`}>
          {t('unsub.home')}
        </Link>
      </div>
    </div>
  )
}
