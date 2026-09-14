'use client'

import { DatabaseZap, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useTransition } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/** The props Next passes to every `error.tsx` boundary. */
export type ErrorBoundaryProps = {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * What an error boundary shows when a page could not be rendered — in
 * practice, the catalogue's database (Supabase) unreachable or timing out.
 *
 * Shared by app/error.tsx and app/catalog/error.tsx so the two cannot drift.
 * The Dark Luxury palette is pinned to its exact values (#000000 ground,
 * #D4AF37 gold, #CCCCCC text) rather than the theme tokens, per the design
 * spec for this screen.
 *
 * "Try again" refreshes the router BEFORE calling reset(). reset() alone only
 * re-renders the segment from the client's cached server payload — the one
 * that failed — so a server-side database error would simply throw again.
 * The refresh re-requests the page from the server; both run in a transition
 * so the button can show it is working until the new payload arrives.
 *
 * The error itself goes to the console only; no stack trace on the page.
 */
export function CatalogUnavailable({ error, reset }: ErrorBoundaryProps) {
  const { t } = useStore()
  const router = useRouter()
  const [retrying, startRetry] = useTransition()

  useEffect(() => {
    console.error('[catalog unavailable]', error.digest ?? '', error.message)
  }, [error])

  const retry = () => {
    startRetry(() => {
      router.refresh()
      reset()
    })
  }

  return (
    <main
      id="main"
      className="flex min-h-[100svh] w-full items-center justify-center bg-[#000000] px-6 py-16 text-[#CCCCCC]"
    >
      <div role="alert" className="flex max-w-md flex-col items-center text-center">
        <DatabaseZap aria-hidden strokeWidth={1.25} className="size-9 text-[#D4AF37]" />
        <span aria-hidden className="mt-6 h-px w-12 bg-[#D4AF37]/60" />
        <h1 className="mt-6 font-serif text-2xl tracking-wide text-[#CCCCCC] sm:text-3xl">
          {t('state.catalogUnavailableTitle')}
        </h1>
        <p className="mt-4 max-w-sm text-sm font-light leading-relaxed text-[#CCCCCC]">
          {t('state.catalogUnavailableHint')}
        </p>
        {/* no-juice: the global hover rule (globals.css) forces gold ink, which
            would sink the label into this button's own gold hover fill. */}
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          aria-busy={retrying}
          className="tap-safe no-juice mt-10 inline-flex items-center justify-center gap-2 border border-[#D4AF37] bg-transparent px-8 py-3 text-[11px] uppercase tracking-[0.2em] text-[#D4AF37] transition-colors duration-300 enabled:hover:bg-[#D4AF37] enabled:hover:text-[#000000] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2 focus-visible:ring-offset-[#000000] disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw
            aria-hidden
            strokeWidth={1.5}
            className={cn('size-3.5', retrying && 'animate-spin')}
          />
          {t('common.retry')}
        </button>
      </div>
    </main>
  )
}
