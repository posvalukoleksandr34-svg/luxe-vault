import 'server-only'

import { escapeHtml } from '@/lib/server/resend'
import type { Order } from '@/lib/types'

/**
 * Order confirmation email.
 *
 * Table-based with fully inline styles: Outlook renders with the Word engine,
 * which supports neither flexbox/grid nor external stylesheets. The only
 * <style> block carries media queries, which Outlook ignores harmlessly.
 */

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

export function orderConfirmationSubject(order: Order): string {
  return `Order ${order.id} confirmed — Luxe Vault`
}

/** Plain-text alternative. Sending HTML alone scores worse with spam filters
 *  and renders as nothing in a text-only client. */
export function orderConfirmationText(order: Order): string {
  const lines = [
    `Thank you for your order, ${order.customer.name}.`,
    '',
    `Order number: ${order.id}`,
    '',
    'Items:',
    ...order.items.map(
      (i) => `  - ${i.name} (${i.size}, ${i.color}) x${i.qty}  ${money(i.price * i.qty)}`,
    ),
    '',
    `Subtotal: ${money(order.subtotal)}`,
    ...(order.discount > 0 ? [`Discount: -${money(order.discount)}`] : []),
    `Shipping: ${order.shippingCost ? money(order.shippingCost) : 'Free'}`,
    ...((order.tax ?? 0) > 0 ? [`Tax: ${money(order.tax ?? 0)}`] : []),
    `Total: ${money(order.total)}`,
    '',
    `Shipping to: ${order.customer.address}`,
    '',
    'We will email you again as soon as the parcel ships.',
    'Luxe Vault',
  ]
  return lines.join('\n')
}

export function orderConfirmationHtml(order: Order): string {
  const discountRow =
    order.discount > 0 ? totalRow('Discount', `-${money(order.discount)}`) : ''

  // Always on a receipt: "Free" is a line the customer earned, and an invoice
  // that omits delivery entirely invites a support ticket asking what the
  // difference between the subtotal and the total was.
  const shippingRow = totalRow(
    'Shipping',
    order.shippingCost ? money(order.shippingCost) : 'Free',
  )

  // Only when actually charged. A "Tax: CHF 0.00" line on a receipt from an
  // unregistered private seller turns a non-question into a tax question.
  const taxRow = (order.tax ?? 0) > 0 ? totalRow('Tax', money(order.tax ?? 0)) : ''

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>${escapeHtml(orderConfirmationSubject(order))}</title>
    <style>
      @media only screen and (max-width: 600px) {
        .lv-shell { padding: 20px 12px !important; }
        .lv-pad   { padding-left: 22px !important; padding-right: 22px !important; }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:${C.bg}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
    <!-- Preheader: the grey preview line clients show beside the subject. -->
    <div style="display:none; font-size:1px; color:${C.bg}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
      ${escapeHtml(order.id)} &middot; ${escapeHtml(money(order.total))}
      &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.bg};">
      <tr>
        <td align="center" class="lv-shell" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px; width:100%; background-color:${C.card}; border:1px solid ${C.border};">

            <tr>
              <td class="lv-pad" style="padding:28px 32px 20px 32px; border-bottom:1px solid ${C.border};">
                <span style="font-family:${SANS}; font-size:15px; font-weight:bold; letter-spacing:4px; color:${C.heading};">LUXE</span><span style="font-family:${SANS}; font-size:15px; font-weight:bold; letter-spacing:4px; color:${C.gold};">VAULT</span>
              </td>
            </tr>

            <tr>
              <td class="lv-pad" style="padding:30px 32px 0 32px;">
                <h1 style="margin:0 0 12px 0; font-family:${SERIF}; font-size:22px; font-weight:normal; color:${C.heading};">
                  Thank you, ${escapeHtml(order.customer.name)}
                </h1>
                <p style="margin:0; font-family:${SANS}; font-size:14px; line-height:24px; color:${C.body};">
                  Your order is confirmed. We will email you again as soon as it ships.
                </p>
              </td>
            </tr>

            <!-- Order number, given its own block so it is findable at a glance -->
            <tr>
              <td class="lv-pad" style="padding:22px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.inset}; border:1px solid ${C.border};">
                  <tr>
                    <td style="padding:14px 18px;">
                      <span style="font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">Order number</span><br />
                      <span style="font-family:'SFMono-Regular',Consolas,Menlo,Courier,monospace; font-size:17px; color:${C.heading};">${escapeHtml(order.id)}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Items -->
            <tr>
              <td class="lv-pad" style="padding:26px 32px 0 32px;">
                <p style="margin:0 0 4px 0; font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">
                  Items
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${itemRows(order)}
                </table>
              </td>
            </tr>

            <!-- Totals -->
            <tr>
              <td class="lv-pad" style="padding:6px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${totalRow('Subtotal', money(order.subtotal))}
                  ${discountRow}
                  ${shippingRow}
                  ${taxRow}
                  ${totalRow('Total', money(order.total), true)}
                </table>
              </td>
            </tr>

            <!-- Delivery -->
            <tr>
              <td class="lv-pad" style="padding:26px 32px 0 32px;">
                <p style="margin:0 0 6px 0; font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">
                  Shipping to
                </p>
                <p style="margin:0; font-family:${SANS}; font-size:14px; line-height:22px; color:${C.body};">
                  <span style="color:${C.heading};">${escapeHtml(order.customer.name)}</span><br />
                  ${escapeHtml(order.customer.address)}<br />
                  ${escapeHtml(order.customer.phone)}
                </p>
              </td>
            </tr>

            <tr>
              <td class="lv-pad" style="padding:26px 32px 30px 32px;">
                <p style="margin:0; font-family:${SANS}; font-size:13px; line-height:22px; color:${C.muted};">
                  Questions about this order? Reply to this email and quote
                  <span style="color:${C.body};">${escapeHtml(order.id)}</span>.
                </p>
              </td>
            </tr>

            <tr>
              <td class="lv-pad" style="padding:16px 32px; border-top:1px solid ${C.border};">
                <p style="margin:0; font-family:${SANS}; font-size:11px; line-height:18px; color:${C.faint};">
                  Luxe Vault &middot; This confirmation was sent automatically.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
