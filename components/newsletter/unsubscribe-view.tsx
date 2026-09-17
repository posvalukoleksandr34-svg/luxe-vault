'use client'

import { Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SUPPORT_EMAIL } from '@/lib/data'
import { useStore } from '@/lib/store'

type State = 'working' | 'unsubscribed' | 'resubscribed' | 'invalid' | 'error'

/**
 * Where the unsubscribe link in every newsletter lands.
 *
 * The unsubscribe is a POST made from this page once it loads, not the GET
 * that opened it: mail security scanners fetch every link in a message but do
 * not run scripts, so a scanner opening the link unsubscribes nobody. A person
 * who clicked by mistake can subscribe again from the same page.
 */
export function UnsubscribeView() {
  const { t } = useStore()
  const token = useSearchParams().get('token') ?? ''
  const [state, setState] = useState<State>('working')
  const [busy, setBusy] = useState(false)
  // The token this page last acted on — once per token, even under React's
  // double-invoked effects in development.
  const handled = useRef<string | null>(null)

  const call = useCallback(
    async (action: 'unsubscribe' | 'resubscribe') => {
      setBusy(true)
      try {
        const res = await fetch('/api/newsletter/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, action }),
        })
        if (res.status === 404) setState('invalid')
        else if (!res.ok) setState('error')
        else setState(action === 'resubscribe' ? 'resubscribed' : 'unsubscribed')
      } catch {
        setState('error')
      } finally {
        setBusy(false)
      }
    },
    [token],
  )

  useEffect(() => {
    if (handled.current === token) return
    handled.current = token
    setState('working')
    if (!token) {
      setState('invalid')
      return
    }
    void call('unsubscribe')
  }, [token, call])

  const button =
    'inline-flex min-h-[46px] items-center justify-center gap-2 border px-7 text-[11px] uppercase tracking-[0.2em] transition-colors disabled:opacity-60'

  if (state === 'working') {
    return (
      <p role="status" className="flex w-full items-center justify-center gap-3 text-[14px] font-light text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t('unsub.working')}
      </p>
    )
  }

  const title = {
    unsubscribed: t('unsub.doneTitle'),
    resubscribed: t('unsub.resubscribedTitle'),
    invalid: t('unsub.invalidTitle'),
    error: t('unsub.error'),
  }[state]

  return (
    <div role="status" className="w-full text-center">
      <h1 className="text-balance font-serif text-[32px] font-normal leading-tight tracking-tight text-foreground sm:text-[40px]">
        {title}
      </h1>

      {state === 'unsubscribed' && (
        <p className="mx-auto mt-4 max-w-md text-[14px] font-light leading-relaxed text-muted-foreground">{t('unsub.doneBody')}</p>
      )}
      {state === 'resubscribed' && (
        <p className="mx-auto mt-4 max-w-md text-[14px] font-light leading-relaxed text-muted-foreground">{t('unsub.resubscribedBody')}</p>
      )}
      {state === 'invalid' && (
        <p className="mx-auto mt-4 max-w-md text-[14px] font-light leading-relaxed text-muted-foreground">
          {t('unsub.invalidBody')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=unsubscribe`} className="text-foreground underline underline-offset-4">
            {SUPPORT_EMAIL}
          </a>
        </p>
      )}

      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        {state === 'unsubscribed' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void call('resubscribe')}
            className={`${button} border-border/60 text-foreground hover:border-foreground/40`}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t('unsub.resubscribe')}
          </button>
        )}
        {state === 'error' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void call('unsubscribe')}
            className={`${button} border-border/60 text-foreground hover:border-foreground/40`}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t('common.retry')}
          </button>
        )}
        <Link href="/" className={`${button} border-gold bg-gold text-gold-foreground hover:bg-gold/90`}>
          {t('unsub.home')}
        </Link>
      </div>
    </div>
  )
}
