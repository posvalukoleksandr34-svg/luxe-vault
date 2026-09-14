import 'server-only'

import { escapeHtml } from '@/lib/server/resend'
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
// The palette and helpers below are used by the prompted emails in
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

export const SANS = "Helvetica,Arial,sans-serif"
export const SERIF = "Georgia,'Times New Roman',serif"

/** Money is stored as a number; render it the way the storefront does. */
export function money(amount: number, currency = 'CHF'): string {
  return `${currency} ${amount.toFixed(2)}`
}

export function itemRows(order: Order): string {
  return order.items
    .map(
      (item) => `
      <tr>
        <td style="padding:12px 0; border-bottom:1px solid ${C.border}; font-family:${SANS}; font-size:14px; line-height:20px; color:${C.body};">
          <span style="color:${C.strong};">${escapeHtml(item.name)}</span><br />
          <span style="font-size:12px; color:${C.muted};">
            ${escapeHtml(item.size)} &middot; ${escapeHtml(item.color)} &middot; &times;${item.qty}
          </span>
        </td>
        <td align="right" style="padding:12px 0; border-bottom:1px solid ${C.border}; font-family:${SANS}; font-size:14px; color:${C.strong}; white-space:nowrap;">
          ${money(item.price * item.qty)}
        </td>
      </tr>`,
    )
    .join('')
}

export function totalRow(label: string, value: string, emphasis = false): string {
  return `
    <tr>
      <td style="padding:${emphasis ? '14px 0 0 0' : '6px 0 0 0'}; font-family:${SANS}; font-size:${emphasis ? '14px' : '13px'}; color:${emphasis ? C.strong : C.muted};">
        ${escapeHtml(label)}
      </td>
      <td align="right" style="padding:${emphasis ? '14px 0 0 0' : '6px 0 0 0'}; font-family:${SANS}; font-size:${emphasis ? '18px' : '13px'}; font-weight:${emphasis ? 'bold' : 'normal'}; color:${emphasis ? C.gold : C.body}; white-space:nowrap;">
        ${escapeHtml(value)}
      </td>
    </tr>`
}
