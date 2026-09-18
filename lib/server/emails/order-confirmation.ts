import 'server-only'

import type { Order } from '@/lib/types'
import type { EmailLang } from './copy'
import {
  addressSection,
  copyFor,
  itemsSection,
  L,
  metaSection,
  money as textMoney,
  orderHref,
  renderEmail,
  textEmail,
  totalsSection,
  type RenderedEmail,
} from './layout'

/**
 * Order confirmation — "Thank you for your order" — sent the moment an order
 * is placed, before it is paid, in the language the customer checked out in.
 *
 * Kept to what the customer needs at that moment: the order number, what they
 * bought, the total, where it is going, and a way back to the order. No
 * delivery estimate: it is a promise made before payment has even cleared,
 * and the shipping email carries the real one — the carrier, the tracking
 * number and an arrival window counted from the day the parcel left.
 */
export function orderConfirmationEmail(order: Order, lang: EmailLang): RenderedEmail {
  const c = copyFor(lang)
  const firstName = order.customer.name.split(' ')[0] || ''
  const subject = c.confirm.subject(order.id)

  const html = renderEmail({
    lang,
    subject,
    preheader: `${order.id} · ${textMoney(order.total)}`,
    heading: c.confirm.heading(firstName),
    intro: c.confirm.intro,
    sections: [
      metaSection([[c.orderNumber, order.id]]),
      itemsSection(order, c),
      totalsSection(order, c),
      addressSection(order, c),
    ],
    cta: { label: c.viewOrder, href: orderHref(order) },
  })

  const text = textEmail([
    'LUXE VAULT',
    '',
    c.confirm.heading(firstName),
    c.confirm.intro,
    '',
    `${c.orderNumber}: ${order.id}`,
    '',
    ...order.items.map((i) => `- ${i.name} (${i.size}, ${i.color}) x${i.qty}  ${textMoney(i.price * i.qty)}`),
    '',
    `${c.subtotal}: ${textMoney(order.subtotal)}`,
    order.discount > 0 ? `${c.discount}: -${textMoney(order.discount)}` : null,
    `${c.shipping}: ${order.shippingCost ? textMoney(order.shippingCost) : c.free}`,
    (order.tax ?? 0) > 0 ? `${c.tax}: ${textMoney(order.tax ?? 0)}` : null,
    `${c.total}: ${textMoney(order.total)}`,
    '',
    `${c.shippingTo}: ${order.customer.name}, ${order.customer.address}`,
    '',
    `${c.viewOrder}: ${orderHref(order)}`,
  ])

  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// The palette below (and the re-exported fonts and money) is used by the prompted emails in
// campaigns.ts (unpaid-order reminder, back-in-stock). The palette is the
// layout's own (./layout.ts), so every email the shop sends looks the same.
// ---------------------------------------------------------------------------

export const C = {
  bg: L.ground,
  card: L.card,
  inset: L.inset,
  border: L.border,
  heading: L.heading,
  strong: L.strong,
  body: L.body,
  muted: L.muted,
  faint: L.muted,
  gold: L.rule,
  button: L.button,
  buttonText: L.buttonText,
}

// Same values as the layout's; re-exported so campaigns.ts keeps one import.
export { SANS, SERIF, money } from './layout'
