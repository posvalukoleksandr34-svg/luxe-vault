'use client'

import { RotateCcw, ShieldCheck, Truck } from 'lucide-react'
import { FULFILMENT } from '@/lib/fulfilment'
import { useStore } from '@/lib/store'

/**
 * Subtle reassurance row beneath the cart and checkout buttons — never louder
 * than the CTA above it.
 *
 * Three facts, each true of every order: Stripe processes card payments,
 * Swiss Post carries every parcel with tracking, and the Refund Policy gives
 * 14 days. It used to say "Swiss Quality" (the pieces are replicas, not Swiss
 * made) and "Priority Delivery" (no such service is bought).
 */
export function TrustBadges() {
  const { t, tf } = useStore()

  const items = [
    { icon: ShieldCheck, label: t('trust.secureStripe') },
    { icon: Truck, label: t('trust.trackedSwissPost') },
    { icon: RotateCcw, label: tf('trust.returnsDays', { n: FULFILMENT.returnWindowDays }) },
  ]

  return (
    <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-border/40 pt-4">
      {items.map(({ icon: Icon, label }) => (
        <li key={label} className="flex items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-gold" strokeWidth={1.5} aria-hidden />
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
        </li>
      ))}
    </ul>
  )
}
