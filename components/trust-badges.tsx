'use client'

import { BadgeCheck, ShieldCheck, Truck } from 'lucide-react'
import { useStore } from '@/lib/store'

/** Subtle reassurance row shown directly beneath the cart/checkout action
 * buttons — never louder than the CTA above it. */
export function TrustBadges() {
  const { t } = useStore()

  const items = [
    { icon: BadgeCheck, label: t('trust.swissQuality') },
    { icon: ShieldCheck, label: t('trust.securePayments') },
    { icon: Truck, label: t('trust.priorityDelivery') },
  ]

  return (
    <div className="mt-4 flex items-center justify-center gap-x-5 gap-y-2 border-t border-border/40 pt-4">
      {items.map(({ icon: Icon, label }, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-gold/60" strokeWidth={1.5} />
          <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground/70">
            {label}
          </span>
        </div>
      ))}
    </div>
  )
}
