import 'server-only'

import type { DeliveryTimeframe } from '@/config/shipping'
import { businessToCalendarDays, describeBusinessDays, describeDeliveryDays } from '@/lib/fulfilment'
import { escapeHtml } from '@/lib/server/resend'
import type { Order } from '@/lib/types'
import type { EmailCopy, EmailLang } from './copy'
import {
  addressSection,
  copyFor,
  deliverySection,
  formatDate,
  formatDateRange,
  itemsSection,
  metaSection,
  money as textMoney,
  orderHref,
  renderEmail,
  textEmail,
  totalsSection,
  type RenderedEmail,
} from './layout'

const DAY_MS = 86_400_000

/**
 * The delivery line: this order's own date window — stamped at creation from
 * its slowest piece — and the timeframe in words.
 *
 * The words are the admin's business-day timeframe ("10–14 business days")
 * when the order's window was stamped from it, otherwise the order's own span
 * in days (a piece with its own, longer window). So the email never quotes a
 * timeframe its own dates contradict. An order without stamped dates (none
 * are created that way now) falls back to the timeframe alone.
 */
function deliveryEstimate(
  order: Order,
  c: EmailCopy,
  lang: EmailLang,
  timeframe?: DeliveryTimeframe,
): { value: string; note?: string } | null {
  if (order.deliveryEstimateMin && order.deliveryEstimateMax) {
    const days = {
      min: Math.max(1, Math.round((order.deliveryEstimateMin - order.createdAt) / DAY_MS)),
      max: Math.max(1, Math.round((order.deliveryEstimateMax - order.createdAt) / DAY_MS)),
    }
    const store = timeframe && businessToCalendarDays(timeframe)
    const span =
      timeframe && store && store.min === days.min && store.max === days.max
        ? describeBusinessDays(timeframe, lang)
        : describeDeliveryDays(days, lang)
    return {
      value: formatDateRange(order.deliveryEstimateMin, order.deliveryEstimateMax, lang),
      note: c.delivery.note(span),
    }
  }
  if (timeframe) return { value: c.delivery.note(describeBusinessDays(timeframe, lang)) }
  return null
}

/**
 * Order confirmation email — sent the moment an order is placed, before it is
 * paid, in the language the customer checked out in.
 *
 * `timeframe` is the admin's current delivery timeframe (getShippingSettings),
 * passed in by the mailer so this stays a pure function of its inputs.
 */
export function orderConfirmationEmail(
  order: Order,
  lang: EmailLang,
  timeframe?: DeliveryTimeframe,
): RenderedEmail {
  const c = copyFor(lang)
  const firstName = order.customer.name.split(' ')[0] || ''
  const subject = c.confirm.subject(order.id)
  const date = formatDate(order.createdAt, lang)
  const delivery = deliveryEstimate(order, c, lang, timeframe)

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
      delivery ? deliverySection(c.delivery.label, delivery.value, delivery.note) : '',
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
    delivery ? `${c.delivery.label}: ${delivery.value}${delivery.note ? ` (${delivery.note})` : ''}` : null,
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
// The palette and helpers below are used by the marketing emails in
// campaigns.ts (unpaid-order reminder, back-in-stock). The transactional
// emails use the shared layout in ./layout.ts — dark too, in the brand's
// exact values.
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
