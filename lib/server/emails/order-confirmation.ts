import 'server-only'

import { escapeHtml } from '@/lib/server/resend'
import type { Order } from '@/lib/types'
import type { EmailLang } from './copy'
import {
  addressSection,
  copyFor,
  formatDate,
  itemsSection,
  metaSection,
  money as textMoney,
  orderHref,
  renderEmail,
  textEmail,
  totalsSection,
  type RenderedEmail,
} from './layout'

/**
 * Order confirmation email — sent the moment an order is placed, before it is
 * paid, in the language the customer checked out in.
 */
export function orderConfirmationEmail(order: Order, lang: EmailLang): RenderedEmail {
  const c = copyFor(lang)
  const firstName = order.customer.name.split(' ')[0] || ''
  const subject = c.confirm.subject(order.id)
  const date = formatDate(order.createdAt, lang)

  const html = renderEmail({
    lang,
    subject,
    preheader: `${order.id} · ${textMoney(order.total)}`,
    heading: c.confirm.heading(firstName),
    intro: c.confirm.intro,
    sections: [
      metaSection([
        [c.orderNumber, order.id],
        [c.orderDate, date],
      ]),
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
    `${c.orderDate}: ${date}`,
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
// The dark palette and helpers below are still used by the marketing emails
// in campaigns.ts (unpaid-order reminder, back-in-stock). The transactional
// emails moved to the light layout in ./layout.ts.
// ---------------------------------------------------------------------------

export const C = {
  bg: '#0b0b0b',
  card: '#131313',
  inset: '#0b0b0b',
  border: '#262626',
  heading: '#f5f3ef',
  body: '#d6d3cd',
  muted: '#6d6d6d',
  faint: '#4a4a4a',
  gold: '#c9a227',
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
          <span style="color:${C.heading};">${escapeHtml(item.name)}</span><br />
          <span style="font-size:12px; color:${C.muted};">
            ${escapeHtml(item.size)} &middot; ${escapeHtml(item.color)} &middot; &times;${item.qty}
          </span>
        </td>
        <td align="right" style="padding:12px 0; border-bottom:1px solid ${C.border}; font-family:${SANS}; font-size:14px; color:${C.heading}; white-space:nowrap;">
          ${money(item.price * item.qty)}
        </td>
      </tr>`,
    )
    .join('')
}

export function totalRow(label: string, value: string, emphasis = false): string {
  return `
    <tr>
      <td style="padding:${emphasis ? '14px 0 0 0' : '6px 0 0 0'}; font-family:${SANS}; font-size:${emphasis ? '14px' : '13px'}; color:${emphasis ? C.heading : C.muted};">
        ${escapeHtml(label)}
      </td>
      <td align="right" style="padding:${emphasis ? '14px 0 0 0' : '6px 0 0 0'}; font-family:${SANS}; font-size:${emphasis ? '18px' : '13px'}; font-weight:${emphasis ? 'bold' : 'normal'}; color:${emphasis ? C.gold : C.body}; white-space:nowrap;">
        ${escapeHtml(value)}
      </td>
    </tr>`
}
