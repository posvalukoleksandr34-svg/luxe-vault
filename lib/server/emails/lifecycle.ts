import 'server-only'

import { orderCharge, orderChargeRate, roundMinor } from '@/lib/currency'
import { FULFILMENT, courierTrackingUrl, estimateDelivery } from '@/lib/fulfilment'
import { ORDER_STATUS_KEYS, UI, translate } from '@/lib/i18n'
import { getSiteUrl } from '@/lib/site-url'
import type { Order, OrderStatus } from '@/lib/types'
import type { EmailLang } from './copy'
import {
  copyFor,
  deliverySection,
  esc,
  formatDateRange,
  highlightSection,
  L,
  metaSection,
  money,
  orderHref,
  paragraphSection,
  renderEmail,
  SANS,
  textEmail,
  type RenderedEmail,
} from './layout'

/**
 * The order-lifecycle emails: status changes, the tracking number, the refund,
 * and the welcome.
 *
 * Every message hangs off a status transition the database already stamps
 * (the orders_stamp_status trigger in 0002), so nothing new has to be tracked
 * to know when to send. All share the one layout in ./layout.ts and speak the
 * order's language.
 */

type Lifecycle = Extract<OrderStatus, 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'>

const LIFECYCLE: OrderStatus[] = ['processing', 'shipped', 'delivered', 'cancelled', 'refunded']

/** The status's own name in the customer's language — the storefront's word. */
function statusLabel(status: OrderStatus, lang: EmailLang): string {
  return translate(UI[ORDER_STATUS_KEYS[status]], lang)
}

/** Returns null for a status with no customer-facing message. */
export function lifecycleEmail(order: Order, status: OrderStatus, lang: EmailLang): RenderedEmail | null {
  if (LIFECYCLE.indexOf(status) === -1) return null
  const c = copyFor(lang)
  const key = status as Lifecycle
  const copy = c[key]
  const subject = copy.subject(order.id)
  const sections: string[] = [
    metaSection([
      [c.orderNumber, order.id],
      [c.status, statusLabel(status, lang)],
    ]),
  ]
  const textExtra: (string | null)[] = []
  let cta: { label: string; href: string } =
    key === 'cancelled' || key === 'refunded'
      ? { label: c.shopNow, href: `${getSiteUrl()}/#shop` }
      : { label: c.trackOrder, href: orderHref(order) }
  let secondaryLink: { label: string; href: string } | undefined

  // "Order dispatched": the tracking number, the carrier's own tracking page
  // as the button, and when to expect it. Sent again if the admin adds or
  // changes the tracking number later (setOrderStatus in orders-store.ts), so
  // a parcel marked shipped before its label was printed still gets tracked.
  if (key === 'shipped') {
    if (order.trackingNumber) {
      const carrier = courierTrackingUrl(order.courierName, order.trackingNumber)
      const value = carrier
        ? `<a href="${esc(carrier.url)}" style="color:${L.heading}; text-decoration:underline;">${esc(order.trackingNumber)}</a>`
        : esc(order.trackingNumber)
      sections.push(highlightSection(c.shipped.tracking, value, order.courierName || undefined))
      textExtra.push(`${c.shipped.tracking}: ${order.trackingNumber}${order.courierName ? ` (${order.courierName})` : ''}`)
      if (carrier) {
        // The carrier's page is where the live scans are; the order page stays
        // one click away underneath.
        cta = { label: c.shipped.trackWith(carrier.label), href: carrier.url }
        secondaryLink = { label: c.viewOrder, href: orderHref(order) }
        textExtra.push(`${cta.label}: ${carrier.url}`)
      }
    }

    // Counted from the day it left (carrier transit, FULFILMENT.transit) —
    // the honest window now that the supplier leg is behind it.
    const eta = order.shippedAt ? estimateDelivery(order) : null
    if (eta) {
      const window = formatDateRange(eta.earliest.getTime(), eta.latest.getTime(), lang)
      sections.push(deliverySection(c.shipped.arrival, window, c.shipped.updates))
      textExtra.push(`${c.shipped.arrival}: ${window}`, c.shipped.updates)
    } else {
      sections.push(paragraphSection(c.shipped.updates, true))
      textExtra.push(c.shipped.updates)
    }
  }

  // The refund as the card will show it: in the currency charged, at the
  // rate it was charged at. refundedAmount itself is kept in CHF.
  let body = key === 'refunded' ? c.refunded.body(FULFILMENT.refund.min, FULFILMENT.refund.max) : (copy as { body: string }).body
  if (key === 'refunded') {
    const charge = orderCharge(order)
    const chf = order.refundedAmount ?? order.total
    const amount = charge.converted
      ? money(roundMinor(chf * orderChargeRate(order)), charge.currency)
      : money(chf)
    sections.push(highlightSection(c.refunded.amount, esc(amount)))
    textExtra.push(`${c.refunded.amount}: ${amount}`)
  }
  body = body.trim()

  const firstName = order.customer.name.split(' ')[0] || ''
  const intro = firstName ? `${firstName}, ${body.charAt(0).toLowerCase()}${body.slice(1)}` : body

  const html = renderEmail({
    lang,
    subject,
    preheader: `${order.id} · ${statusLabel(status, lang)}`,
    heading: copy.heading,
    intro,
    sections,
    cta,
    secondaryLink,
  })

  const text = textEmail([
    'LUXE VAULT',
    '',
    copy.heading,
    intro,
    '',
    `${c.orderNumber}: ${order.id}`,
    `${c.status}: ${statusLabel(status, lang)}`,
    ...textExtra,
    '',
    secondaryLink ? `${secondaryLink.label}: ${secondaryLink.href}` : `${cta.label}: ${cta.href}`,
  ])

  return { subject, html, text }
}

/**
 * Welcome email, sent once when an account is created.
 *
 * Deliberately does NOT double as email verification — Supabase owns that, and
 * two emails competing to be "the one with the link" is how a customer ends up
 * clicking the wrong one.
 */
export function welcomeEmail(name: string, lang: EmailLang): RenderedEmail {
  const c = copyFor(lang)
  const firstName = name.split(' ')[0] || ''
  const href = `${getSiteUrl()}/#shop`
  const html = renderEmail({
    lang,
    subject: c.welcome.subject,
    preheader: c.welcome.body,
    heading: c.welcome.heading(firstName),
    intro: c.welcome.body,
    sections: [
      `<tr><td class="lv-pad" style="padding:0 36px;"><div style="margin-top:22px; height:2px; width:48px; background:${L.rule}; font-family:${SANS};"></div></td></tr>`,
    ],
    cta: { label: c.shopNow, href },
  })
  return {
    subject: c.welcome.subject,
    html,
    text: textEmail(['LUXE VAULT', '', c.welcome.heading(firstName), c.welcome.body, '', `${c.shopNow}: ${href}`]),
  }
}
