import 'server-only'

import { C, SANS, SERIF, money } from '@/lib/server/emails/order-confirmation'
import { escapeHtml } from '@/lib/server/resend'
import { getSiteUrl } from '@/lib/site-url'
import type { Order, OrderStatus } from '@/lib/types'

/**
 * The order-lifecycle emails.
 *
 * The shop sent three of the ten a store this shape needs: order confirmation,
 * payment receipt and password recovery. A customer heard nothing when their
 * order started being prepared, nothing when it shipped — including the
 * tracking number, which is the single most-wanted email in commerce — nothing
 * on delivery, and nothing when an order was cancelled or refunded. The last
 * two matter most: silence after money moves is what turns a refund into a
 * chargeback.
 *
 * Every message here hangs off a status transition the database already
 * stamps (see the orders_stamp_status trigger in 0002), so nothing new has to
 * be tracked to know when to send.
 *
 * ONE TEMPLATE, NOT SIX
 *
 * These share a layout deliberately. Six hand-built templates drift: a colour
 * changes in five of them, a footer link rots in one. `shell()` owns the
 * chrome and each message supplies a headline, a sentence, and optionally one
 * call to action.
 */

type Lifecycle = Extract<
  OrderStatus,
  'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
>

type Copy = {
  subject: string
  heading: string
  body: string
  /** Optional button. Omitted where there is nothing useful to do yet. */
  cta?: { label: string; href: string }
  /** Extra block rendered above the button — the tracking number, a refund
   *  amount. Already-escaped HTML. */
  detail?: string
}

function shell(order: Order, copy: Copy): string {
  const cta = copy.cta
    ? `
      <tr>
        <td align="center" style="padding:28px 32px 8px 32px;">
          <a href="${escapeHtml(copy.cta.href)}"
             style="display:inline-block; padding:14px 30px; font-family:${SANS}; font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:${C.gold}; text-decoration:none; border:1px solid ${C.gold};">
            ${escapeHtml(copy.cta.label)}
          </a>
        </td>
      </tr>`
    : ''

  const detail = copy.detail
    ? `
      <tr>
        <td style="padding:20px 32px 0 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:${C.inset}; border:1px solid ${C.border};">
            <tr><td style="padding:16px 20px;">${copy.detail}</td></tr>
          </table>
        </td>
      </tr>`
    : ''

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(copy.subject)}</title>
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
                  ${escapeHtml(copy.heading)}
                </h1>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:14px 32px 0 32px;">
                <p style="margin:0; font-family:${SANS}; font-size:14px; line-height:22px; color:${C.body};">
                  ${escapeHtml(copy.body)}
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:22px 32px 0 32px;">
                <span style="font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">
                  Order
                </span><br />
                <span style="font-family:${SANS}; font-size:18px; letter-spacing:1px; color:${C.gold};">
                  ${escapeHtml(order.id)}
                </span>
              </td>
            </tr>
            ${detail}
            ${cta}
            <tr>
              <td align="center" style="padding:30px 32px 32px 32px;">
                <p style="margin:0; font-family:${SANS}; font-size:11px; line-height:18px; color:${C.faint};">
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

function trackHref(order: Order): string {
  return `${getSiteUrl()}/order/${encodeURIComponent(order.id)}`
}

/**
 * Copy per transition.
 *
 * Written from the customer's side: what happened, and what if anything they
 * should do. No apologies for things that are not failures, and no "we are
 * excited to announce" — a shipping notice is information, not marketing.
 */
function copyFor(order: Order, status: Lifecycle): Copy | null {
  const firstName = order.customer.name.split(' ')[0] || ''
  const greeting = firstName ? `${firstName}, ` : ''

  switch (status) {
    case 'processing':
      return {
        subject: `Your order ${order.id} is being prepared`,
        heading: 'We are preparing your order',
        body: `${greeting}your payment has cleared and your order is now with our team. We will email you again the moment it ships.`,
        cta: { label: 'Track order', href: trackHref(order) },
      }

    case 'shipped': {
      // The tracking number is the reason this email gets opened. When the
      // admin has not entered one yet, the block is omitted rather than
      // rendered empty — a "Tracking: —" line reads as a mistake.
      const detail = order.trackingNumber
        ? `<span style="font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">Tracking number</span><br />
           <span style="font-family:${SANS}; font-size:16px; letter-spacing:1px; color:${C.heading};">${escapeHtml(order.trackingNumber)}</span>
           ${order.courierName ? `<br /><span style="font-family:${SANS}; font-size:12px; color:${C.muted};">${escapeHtml(order.courierName)}</span>` : ''}`
        : undefined

      return {
        subject: `Your order ${order.id} has shipped`,
        heading: 'Your order is on its way',
        body: `${greeting}your parcel has been handed to the carrier. Tracking can take a day to show its first scan.`,
        detail,
        cta: { label: 'Track order', href: trackHref(order) },
      }
    }

    case 'delivered':
      return {
        subject: `Your order ${order.id} has been delivered`,
        heading: 'Delivered',
        body: `${greeting}your order has been marked as delivered. If anything is not as expected, reply to this email within 14 days and we will put it right.`,
        cta: { label: 'View order', href: trackHref(order) },
      }

    case 'cancelled':
      return {
        subject: `Your order ${order.id} has been cancelled`,
        heading: 'Your order was cancelled',
        body: order.cancelledReason
          ? `${greeting}this order has been cancelled: ${order.cancelledReason}. Nothing has been charged, and anything already taken is being returned.`
          : `${greeting}this order has been cancelled. Nothing has been charged, and anything already taken is being returned.`,
      }

    case 'refunded': {
      const amount = order.refundedAmount ?? order.total
      return {
        subject: `Your refund for order ${order.id}`,
        heading: 'Your refund is on its way',
        body: `${greeting}we have issued your refund. Banks typically take 5–10 working days to show it, and it returns to the card you paid with.`,
        detail: `<span style="font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">Refunded</span><br />
                 <span style="font-family:${SANS}; font-size:18px; color:${C.gold};">${escapeHtml(money(amount))}</span>`,
      }
    }

    default:
      return null
  }
}

export type LifecycleEmail = { subject: string; html: string; text: string }

/** Returns null for a status with no customer-facing message. */
export function lifecycleEmail(order: Order, status: OrderStatus): LifecycleEmail | null {
  const copy = copyFor(order, status as Lifecycle)
  if (!copy) return null

  const text = [
    copy.heading,
    '',
    copy.body,
    '',
    `Order: ${order.id}`,
    ...(status === 'shipped' && order.trackingNumber
      ? [`Tracking: ${order.trackingNumber}${order.courierName ? ` (${order.courierName})` : ''}`]
      : []),
    ...(status === 'refunded'
      ? [`Refunded: ${money(order.refundedAmount ?? order.total)}`]
      : []),
    '',
    ...(copy.cta ? [`${copy.cta.label}: ${copy.cta.href}`, ''] : []),
    'Luxe Vault',
  ].join('\n')

  return { subject: copy.subject, html: shell(order, copy), text }
}

// ------------------------------------------------------------------ welcome

/**
 * Welcome email, sent once when an account is created.
 *
 * Deliberately does NOT double as email verification — Supabase owns that, and
 * two emails competing to be "the one with the link" is how a customer ends up
 * clicking the wrong one.
 */
export function welcomeEmail(name: string): LifecycleEmail {
  const firstName = name.split(' ')[0] || ''
  const heading = firstName ? `Welcome, ${firstName}` : 'Welcome'
  const body =
    'Your account is ready. Your orders, delivery status and saved details now live in one place.'

  const fake = {
    id: '',
    customer: { name },
  } as unknown as Order

  const html = shell(fake, {
    subject: 'Welcome to Luxe Vault',
    heading,
    body,
    cta: { label: 'Start shopping', href: `${getSiteUrl()}/#shop` },
  })
    // The shell always renders an order block; a welcome email has no order,
    // so the block is stripped rather than showing an empty reference.
    .replace(/<tr>\s*<td align="center" style="padding:22px 32px 0 32px;">[\s\S]*?<\/tr>/, '')

  return {
    subject: 'Welcome to Luxe Vault',
    html,
    text: `${heading}\n\n${body}\n\nStart shopping: ${getSiteUrl()}/#shop\n\nLuxe Vault`,
  }
}
