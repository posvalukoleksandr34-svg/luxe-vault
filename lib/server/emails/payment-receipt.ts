import 'server-only'

import { escapeHtml } from '@/lib/server/resend'
import type { Order } from '@/lib/types'
import { C, SANS, SERIF, itemRows, money, totalRow } from './order-confirmation'

/**
 * Payment receipt — sent when Stripe confirms the money actually moved.
 *
 * Distinct from the order-confirmation email, which fires the moment an order
 * is created and before anything is paid. Sending one email for both moments
 * would either promise payment that had not happened, or stay silent at the
 * point the customer most wants confirmation. Card and expiry are shown
 * because a receipt has to be reconcilable against a bank statement.
 *
 * Table layout with inline styles, matching the other templates: Outlook
 * renders with the Word engine and supports neither flexbox nor external
 * stylesheets.
 */

export function paymentReceiptSubject(order: Order): string {
  return `Payment received for ${order.id} — Luxe Vault`
}

function paidLine(order: Order): string {
  const when = new Date().toLocaleDateString('en-CH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  return `Paid ${money(order.total, order.paymentCurrency || 'CHF')} on ${when}`
}

/** Plain-text alternative. HTML-only mail scores worse with spam filters and
 *  renders as nothing in a text-only client. */
export function paymentReceiptText(order: Order): string {
  // `null` marks a row that did not apply and is dropped; `''` is a deliberate
  // blank separator and is kept. Filtering on falsiness would collapse both and
  // leave an unreadable wall of text.
  const lines: (string | null)[] = [
    `LUXE VAULT — payment receipt`,
    ``,
    `Thank you, ${order.customer.name}.`,
    `We have received your payment. Your order is now being prepared.`,
    ``,
    `Order:   ${order.id}`,
    paidLine(order),
    order.paymentId ? `Payment: ${order.paymentId}` : null,
    ``,
    ...order.items.map(
      (i) => `- ${i.name} (${i.size} / ${i.color}) x${i.qty}  ${money(i.price * i.qty)}`,
    ),
    ``,
    `Subtotal: ${money(order.subtotal)}`,
    order.discount > 0 ? `Discount: -${money(order.discount)}` : null,
    `Total:    ${money(order.total)}`,
    ``,
    `Delivery to: ${order.customer.address}`,
    ``,
    `Track your order: https://luxe-vault.store/order/${order.id}`,
    `Questions: support@luxe-vault.store`,
  ]
  return lines.filter((l): l is string => l !== null).join('\n')
}

export function paymentReceiptHtml(order: Order): string {
  const discountRow = order.discount > 0 ? totalRow('Discount', `-${money(order.discount)}`) : ''

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>${escapeHtml(paymentReceiptSubject(order))}</title>
    <style>
      @media only screen and (max-width: 600px) {
        .lv-shell { padding: 20px 12px !important; }
        .lv-pad   { padding-left: 22px !important; padding-right: 22px !important; }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:${C.bg}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
    <div style="display:none; font-size:1px; color:${C.bg}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
      ${escapeHtml(paidLine(order))}
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
                  Payment received
                </h1>
                <p style="margin:0; font-family:${SANS}; font-size:14px; line-height:22px; color:${C.body};">
                  Thank you, ${escapeHtml(order.customer.name)}. Your payment has cleared and
                  your order is now being prepared for dispatch.
                </p>
              </td>
            </tr>

            <!-- Paid banner. The single fact the customer opened the mail for. -->
            <tr>
              <td class="lv-pad" style="padding:24px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.inset}; border:1px solid ${C.gold};">
                  <tr>
                    <td align="center" style="padding:20px 16px;">
                      <p style="margin:0 0 6px 0; font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">
                        Amount paid
                      </p>
                      <div style="font-family:${SERIF}; font-size:30px; line-height:36px; color:${C.gold};">
                        ${escapeHtml(money(order.total, order.paymentCurrency || 'CHF'))}
                      </div>
                      <p style="margin:8px 0 0 0; font-family:${SANS}; font-size:12px; color:${C.muted};">
                        Order ${escapeHtml(order.id)}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="lv-pad" style="padding:26px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${itemRows(order)}
                  ${totalRow('Subtotal', money(order.subtotal))}
                  ${discountRow}
                  ${totalRow('Total', money(order.total), true)}
                </table>
              </td>
            </tr>

            <tr>
              <td class="lv-pad" style="padding:24px 32px 0 32px;">
                <p style="margin:0 0 4px 0; font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">
                  Delivery to
                </p>
                <p style="margin:0; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.body};">
                  ${escapeHtml(order.customer.name)}<br />
                  ${escapeHtml(order.customer.address)}
                </p>
              </td>
            </tr>

            <tr>
              <td class="lv-pad" style="padding:24px 32px 0 32px;">
                <a href="https://luxe-vault.store/order/${encodeURIComponent(order.id)}"
                   style="display:inline-block; padding:12px 26px; border:1px solid ${C.gold}; font-family:${SANS}; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:${C.gold}; text-decoration:none;">
                  Track your order
                </a>
              </td>
            </tr>

            ${
              order.paymentId
                ? `<tr>
              <td class="lv-pad" style="padding:22px 32px 0 32px;">
                <p style="margin:0; font-family:${SANS}; font-size:11px; line-height:18px; color:${C.faint};">
                  Payment reference: ${escapeHtml(order.paymentId)}
                </p>
              </td>
            </tr>`
                : ''
            }

            <tr>
              <td class="lv-pad" style="padding:22px 32px 30px 32px;">
                <p style="margin:0; font-family:${SANS}; font-size:13px; line-height:22px; color:${C.muted};">
                  Questions about this order?
                  <a href="mailto:support@luxe-vault.store" style="color:${C.gold}; text-decoration:none;">support@luxe-vault.store</a>
                </p>
              </td>
            </tr>

            <tr>
              <td class="lv-pad" style="padding:16px 32px; border-top:1px solid ${C.border};">
                <p style="margin:0; font-family:${SANS}; font-size:11px; line-height:18px; color:${C.faint};">
                  Luxe Vault &middot; Zurich, Switzerland &middot; This receipt was sent automatically.
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
