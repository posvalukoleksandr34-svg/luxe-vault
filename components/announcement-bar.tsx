'use client'

import { FULFILMENT } from '@/lib/fulfilment'
import { formatPrice, useStore } from '@/lib/store'

/**
 * The black strip above the header: what a customer wants to know before
 * anything else — free shipping, how parcels travel, how long returns stay
 * open. The same facts, in the same words, as the product page's delivery
 * notes and the trust badges, and the free-shipping amount is the admin's
 * live setting.
 *
 * It scrolls away with the page; only the header below it stays. One line
 * on a phone, two from sm, all three from lg — never a wrapped second row.
 */
export function AnnouncementBar() {
  const { t, tf, shipping } = useStore()

  const items = [
    shipping.freeShippingThreshold > 0
      ? tf('product.freeShippingFrom', { amount: formatPrice(shipping.freeShippingThreshold) })
      : null,
    t('trust.trackedSwissPost'),
    tf('trust.returnsDays', { n: FULFILMENT.returnWindowDays }),
  ].filter((item): item is string => Boolean(item))

  return (
    <div className="announcement-bar theme-inverse">
      <ul className="announcement-bar__list">
        {items.map((item) => (
          <li key={item} className="announcement-bar__item">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
