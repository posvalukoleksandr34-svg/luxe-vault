import 'server-only'

import { orderCharge, orderChargeRate } from '@/lib/currency'
import type { Order } from '@/lib/types'
import type { EmailLang } from './copy'
import {
  copyFor,
  esc,
  formatDate,
  highlightSection,
  itemsSection,
  metaSection,
  money,
  orderHref,
  paragraphSection,
  renderEmail,
  textEmail,
  totalsSection,
  type RenderedEmail,
} from './layout'

/**
 * Payment receipt — sent when Stripe confirms the money actually moved.
 *
 * Distinct from the order confirmation, which fires before anything is paid:
 * one email for both moments would either promise a payment that had not
 * happened, or stay silent when the customer most wants confirmation.
 *
 * The amount is what the card was CHARGED, in that currency; for a payment in
 * EUR or USD the CHF price it was converted from is said beside it. The item
 * lines and totals stay in CHF, the currency the order is priced in.
 */
export function paymentReceiptEmail(order: Order, lang: EmailLang): RenderedEmail {
  const c = copyFor(lang)
  const subject = c.receipt.subject(order.id)
  const charge = orderCharge(order)
  const paid = money(charge.amount, charge.currency)
  const note = charge.converted
    ? c.receipt.convertedFrom(money(order.total), String(Number(orderChargeRate(order).toFixed(4))), charge.currency)
    : undefined
  const today = formatDate(Date.now(), lang)

  const html = renderEmail({
    lang,
    subject,
    preheader: `${c.receipt.paid}: ${paid} · ${order.id}`,
    heading: c.receipt.heading,
    intro: c.receipt.intro,
    sections: [
      highlightSection(c.receipt.paid, esc(paid), note),
      metaSection([
        [c.orderNumber, order.id],
        [c.orderDate, today],
      ]),
      itemsSection(order, c),
      totalsSection(order, c),
      order.paymentId ? paragraphSection(`${c.receipt.reference}: ${order.paymentId}`, true) : '',
    ],
    cta: { label: c.trackOrder, href: orderHref(order) },
  })

  const text = textEmail([
    'LUXE VAULT',
    '',
    c.receipt.heading,
    c.receipt.intro,
    '',
    `${c.receipt.paid}: ${paid}`,
    note ?? null,
    `${c.orderNumber}: ${order.id}`,
    order.paymentId ? `${c.receipt.reference}: ${order.paymentId}` : null,
    '',
    ...order.items.map((i) => `- ${i.name} (${i.size} / ${i.color}) x${i.qty}  ${money(i.price * i.qty)}`),
    '',
    `${c.total}: ${money(order.total)}`,
    '',
    `${c.trackOrder}: ${orderHref(order)}`,
  ])

  return { subject, html, text }
}
