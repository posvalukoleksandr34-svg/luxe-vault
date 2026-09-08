'use client'

import { Check, Copy, ExternalLink, Truck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { courierTrackingUrl } from '@/lib/fulfilment'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Order } from '@/lib/types'

/**
 * Courier and tracking number for a shipped order.
 *
 * Renders NOTHING without a tracking number. An order marked shipped before
 * the admin has entered one is a normal intermediate state, and a "Tracking:
 * —" row reads as a fault rather than as "not yet".
 *
 * The deep-link comes from the carrier registry in lib/fulfilment.ts. An
 * unrecognised carrier still shows its name and the code — just without a
 * link, because a guessed URL that 404s is worse than no link at all.
 */
export function TrackingDetails({
  order,
  compact = false,
  prominent = false,
}: {
  order: Pick<Order, 'trackingNumber' | 'courierName'>
  /** Tighter layout for the 448px account drawer. */
  compact?: boolean
  /**
   * The dedicated /order page, where tracking is the reason the page exists —
   * larger code, and the breathing glow that marks the one thing worth
   * looking at. Same behaviour, more emphasis.
   */
  prominent?: boolean
}) {
  const { t } = useStore()
  const [copied, setCopied] = useState(false)

  const code = order.trackingNumber?.trim()
  const carrier = order.courierName?.trim()
  const link = courierTrackingUrl(carrier, code)

  // Reset the "copied" tick after a moment. Cleared on unmount so a drawer
  // closed mid-timeout does not set state on a gone component.
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  if (!code) return null

  async function copy() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      // Clipboard access is refused in some contexts (an insecure origin, a
      // browser policy). The number is selectable on screen either way, so
      // failing quietly is better than an error about a convenience.
    }
  }

  return (
    <div
      className={cn(
        'border',
        prominent
          ? 'glow-breathe border-gold/45 bg-gold/[0.05] p-5 sm:p-6'
          : 'border-gold/30 bg-gold/[0.04]',
        !prominent && (compact ? 'p-3' : 'p-4'),
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        <Truck className="size-3 text-gold" strokeWidth={1.5} />
        {carrier || t('track.parcel')}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* select-all: the number's whole value is that it can be pasted into
            the carrier's own site, and a tap that selects all of it is the
            fallback when the clipboard API is unavailable. */}
        <code
          className={cn(
            'select-all break-all font-mono text-foreground',
            prominent ? 'text-lg tracking-wide sm:text-xl' : 'text-[13px]',
          )}
        >
          {code}
        </code>

        <button
          type="button"
          onClick={copy}
          aria-label={t('track.copyCode')}
          title={t('track.copyCode')}
          className="flex items-center gap-1 border border-border px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground transition hover:border-gold/50 hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="size-3 text-gold" />
              {t('track.copied')}
            </>
          ) : (
            <>
              <Copy className="size-3" />
              {t('track.copyCode')}
            </>
          )}
        </button>
      </div>

      {link ? (
        <a
          href={link.url}
          target="_blank"
          // noopener because the carrier's page is opened with a reference to
          // this window otherwise; noreferrer keeps the order URL out of their
          // logs.
          rel="noopener noreferrer"
          className="mt-2.5 inline-flex items-center gap-1.5 border border-gold/40 bg-gold/5 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
        >
          <ExternalLink className="size-3" />
          {t('track.trackPackage')}
        </a>
      ) : (
        // Named carriers we have no URL for, and orders where the admin typed
        // a number but no carrier. Saying where to take the code is more use
        // than a dead button.
        <p className="mt-2 text-[11px] font-light text-muted-foreground/70">
          {t('track.noCarrierLink')}
        </p>
      )}
    </div>
  )
}
