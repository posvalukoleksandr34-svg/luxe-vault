import 'server-only'

import { C, SANS, SERIF, money } from '@/lib/server/emails/order-confirmation'
import { escapeHtml, FROM_ADDRESS, isMailConfigured, sendEmail } from '@/lib/server/resend'
import { getSiteUrl } from '@/lib/site-url'
import type { Order } from '@/lib/types'

/**
 * The two prompted emails: recover an unpaid order, and tell someone their
 * size is back.
 *
 * Both are triggered by a sweep rather than by something the customer just
 * did, which is exactly why they need restraint. Each is sent ONCE — the
 * claim happens in the database (see 0019), so a cron that overlaps itself
 * still produces one message.
 *
 * No sequence, no "second chance" follow-up, no discount escalation. A single
 * reminder is a service; three is spam, and a shop that discounts to close an
 * abandoned order teaches customers to abandon orders.
 */

function shell(opts: {
  subject: string
  heading: string
  body: string
  cta: { label: string; href: string }
  detail?: string
  footnote?: string
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(opts.subject)}</title>
  </head>
  <body style="margin:0; padding:0; background:${C.bg};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
                 style="width:600px; max-width:100%; background:${C.card}; border:1px solid ${C.border};">
            <tr>
              <td align="center" style="padding:32px 32px 0 32px;">
                <span style="font-family:${SERIF}; font-size:20px; letter-spacing:3px; color:${C.heading};">
                  LUXE VAULT
                </span>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:26px 32px 0 32px;">
                <h1 style="margin:0; font-family:${SERIF}; font-size:26px; line-height:32px; color:${C.heading};">
                  ${escapeHtml(opts.heading)}
                </h1>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:14px 32px 0 32px;">
                <p style="margin:0; font-family:${SANS}; font-size:14px; line-height:22px; color:${C.body};">
                  ${escapeHtml(opts.body)}
                </p>
              </td>
            </tr>
            ${
              opts.detail
                ? `<tr>
              <td style="padding:20px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="background:${C.inset}; border:1px solid ${C.border};">
                  <tr><td align="center" style="padding:16px 20px;">${opts.detail}</td></tr>
                </table>
              </td>
            </tr>`
                : ''
            }
            <tr>
              <td align="center" style="padding:28px 32px 8px 32px;">
                <a href="${escapeHtml(opts.cta.href)}"
                   style="display:inline-block; padding:14px 30px; font-family:${SANS}; font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:${C.gold}; text-decoration:none; border:1px solid ${C.gold};">
                  ${escapeHtml(opts.cta.label)}
                </a>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:26px 32px 32px 32px;">
                <p style="margin:0; font-family:${SANS}; font-size:11px; line-height:18px; color:${C.faint};">
                  ${opts.footnote ? `${escapeHtml(opts.footnote)}<br /><br />` : ''}
                  Luxe Vault &middot; Zurich, Switzerland<br />
                  Questions? Reply to this email or write to support@luxe-vault.store
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

/**
 * Reminds a customer about an order they started and never paid for.
 *
 * Says what is waiting and links straight to it. No urgency invented, no
 * countdown, and no discount — the order is already priced, and offering money
 * off to close it would be teaching customers to abandon checkouts.
 */
export async function sendRecoveryEmail(order: Order): Promise<boolean> {
  const to = order.customer.email?.trim()
  if (!isMailConfigured || !to) return false

  const firstName = order.customer.name.split(' ')[0] || ''
  const greeting = firstName ? `${firstName}, ` : ''
  const items = order.items
    .map((i) => `${i.name} (${i.size}, ${i.color}) ×${i.qty}`)
    .join('\n')

  const subject = `Your order ${order.id} is still waiting`
  const body = `${greeting}your order has not been paid for yet, so nothing has shipped. It is held for you and can be completed from your account whenever you are ready.`

  const detail = `<span style="font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">Order total</span><br />
     <span style="font-family:${SANS}; font-size:20px; color:${C.gold};">${escapeHtml(money(order.total))}</span><br />
     <span style="font-family:${SANS}; font-size:12px; line-height:18px; color:${C.body};">${escapeHtml(
       order.items.map((i) => `${i.name} ×${i.qty}`).join(' · '),
     )}</span>`

  try {
    const result = await sendEmail({
      to,
      from: FROM_ADDRESS,
      subject,
      html: shell({
        subject,
        heading: 'Your order is still waiting',
        body,
        detail,
        cta: { label: 'Complete payment', href: `${getSiteUrl()}/order/${encodeURIComponent(order.id)}` },
        footnote: 'You are receiving this once because you started an order with us.',
      }),
      text: `${subject}\n\n${body}\n\n${items}\n\nTotal: ${money(order.total)}\n\nComplete payment: ${getSiteUrl()}/order/${order.id}\n\nLuxe Vault`,
    })
    if (!result.ok) {
      console.warn(`[campaigns] recovery for ${order.id} not sent: ${result.message}`)
      return false
    }
    return true
  } catch (e) {
    console.warn(`[campaigns] recovery for ${order.id} threw:`, e)
    return false
  }
}

/** Tells someone the exact variant they asked about is available again. */
export async function sendRestockEmail(alert: {
  email: string
  productId: string
  productName: string
  size: string
  color: string
}): Promise<boolean> {
  if (!isMailConfigured || !alert.email.trim()) return false

  const subject = `${alert.productName} is back in your size`
  const body = `The size you asked about is available again. Stock is limited, and this email does not reserve it — it is first come, first served.`
  const href = `${getSiteUrl()}/product/${encodeURIComponent(alert.productId)}`

  const detail = `<span style="font-family:${SANS}; font-size:16px; color:${C.heading};">${escapeHtml(alert.productName)}</span><br />
     <span style="font-family:${SANS}; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:${C.muted};">${escapeHtml(alert.size)} &middot; ${escapeHtml(alert.color)}</span>`

  try {
    const result = await sendEmail({
      to: alert.email,
      from: FROM_ADDRESS,
      subject,
      html: shell({
        subject,
        heading: 'Back in stock',
        body,
        detail,
        cta: { label: 'View product', href },
        footnote: 'You asked to be told when this size returned. This is the only email you will get about it.',
      }),
      text: `${subject}\n\n${body}\n\n${alert.productName} — ${alert.size}, ${alert.color}\n\n${href}\n\nLuxe Vault`,
    })
    if (!result.ok) {
      console.warn(`[campaigns] restock for ${alert.email} not sent: ${result.message}`)
      return false
    }
    return true
  } catch (e) {
    console.warn('[campaigns] restock threw:', e)
    return false
  }
}
