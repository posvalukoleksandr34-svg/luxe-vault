'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * "We could not load this" — with a way out.
 *
 * This component exists because the app had no way to say it. Every list
 * fetched its data, swallowed any failure, and rendered its EMPTY state: a
 * customer whose request timed out was told they had no orders, no addresses,
 * no reviews. An empty state is a claim about the account; a failed request is
 * a claim about the network, and showing one for the other is the difference
 * between "you have nothing" and "we could not check".
 *
 * Always offers a retry. A dead end with an apology is only marginally better
 * than a dead end with a lie.
 */
export function LoadError({
  title,
  onRetry,
  compact = false,
  className,
}: {
  /** Defaults to the generic string; pass a specific one where it helps
   *  ("Could not load your orders" beats "Could not load this"). */
  title?: string
  onRetry: () => void | Promise<void>
  /** Tighter padding for the 448px account drawer. */
  compact?: boolean
  className?: string
}) {
  const { t } = useStore()
  const [retrying, setRetrying] = useState(false)

  async function retry() {
    if (retrying) return
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      // The component is usually unmounted by a successful retry; the guard
      // matters for the case where it is not.
      setRetrying(false)
    }
  }

  return (
    <div
      // Announced, because this replaces content the reader was waiting for.
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'py-10' : 'py-16',
        className,
      )}
    >
      <AlertTriangle className="size-8 text-gold/40" strokeWidth={1.25} />

      <p className="text-sm font-light text-foreground">{title || t('error.loadFailed')}</p>

      {/* The reassurance is the point: the most common worry when an order
          list fails to load is that the orders are gone. */}
      <p className="max-w-xs text-[12px] font-light leading-relaxed text-muted-foreground/70">
        {t('error.loadFailedHint')}
      </p>

      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying}
        className="mt-1 inline-flex items-center gap-2 border border-gold/40 bg-gold/5 px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className={cn('size-3.5', retrying && 'animate-spin')} />
        {t('common.retry')}
      </button>
    </div>
  )
}
