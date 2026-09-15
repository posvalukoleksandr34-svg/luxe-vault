// Transactional email via Resend.
//
// Design rule for everything in here: sending mail must never be able to fail
// a request that has already done the important work. A support ticket that is
// safely in Postgres but whose confirmation email bounced is a minor problem;
// a customer being told "Failed to send message" because a mail provider was
// briefly down — after their message was already stored — is a much worse one.
// Every function therefore reports success as a boolean and throws nothing.
import 'server-only'

import { SUPPORT_EMAIL } from '@/lib/data'
import { emailLang, type EmailLang } from '@/lib/server/emails/copy'
import { L } from '@/lib/server/emails/layout'
import { supportReplyEmail, ticketReceivedEmail } from '@/lib/server/emails/support'
import { getSiteUrl } from '@/lib/site-url'
import { orderConfirmationEmail } from '@/lib/server/emails/order-confirmation'
import { paymentFailedEmail } from '@/lib/server/emails/payment-failed'
import { paymentReceiptEmail } from '@/lib/server/emails/payment-receipt'
import { getOrderLocale } from '@/lib/server/order-locale'
import {
  escapeHtml,
  isMailConfigured,
  sendEmail,
  SUPPORT_FROM_ADDRESS,
} from '@/lib/server/resend'
import type { Order, SupportTicket } from '@/lib/types'

export { isMailConfigured }

/**
 * Where customer enquiries land. An inbox, not a website origin — it has to be
 * a mailbox someone actually reads, so it does not track the site domain.
 */
const SUPPORT_INBOX = process.env.SUPPORT_INBOX_EMAIL ?? SUPPORT_EMAIL

/** Preserves the customer's line breaks after escaping. */
function escMultiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br />')
}

const esc = escapeHtml

/**
 * The support emails' frame, in the shared Dark Luxury palette (./emails/
 * layout.ts): black ground, #0D0D0D card with a #222222 border and a gold
 * line across its top, a gold heading, #CCCCCC text.
 */
const SHELL = (title: string, body: string) => `
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
  </head>
  <body style="margin:0;padding:0;background:${L.ground};font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${L.ground}" style="background:${L.ground};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${L.card}" style="max-width:560px;background:${L.card};border:1px solid ${L.border};">
            <tr><td height="3" bgcolor="${L.rule}" style="height:3px;line-height:3px;font-size:0;background:${L.rule};">&nbsp;</td></tr>
            <tr>
              <td style="padding:26px 32px 20px;border-bottom:1px solid ${L.border};">
                <span style="font-size:15px;letter-spacing:.22em;color:${L.strong};font-weight:700;">LUXE</span><span style="font-size:15px;letter-spacing:.22em;color:${L.rule};font-weight:700;">VAULT</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 32px;color:${L.body};font-size:14px;line-height:1.7;">
                <h1 style="margin:0 0 16px;font-size:18px;color:${L.heading};font-weight:600;">${esc(title)}</h1>
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;border-top:1px solid ${L.border};color:${L.muted};font-size:11px;">
                LUXE VAULT · Это письмо отправлено автоматически
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

// ------------------------------------------------------------ support ----

const CATEGORY_RU: Record<string, string> = {
  order: 'Заказ',
  payment: 'Оплата',
  shipping: 'Доставка',
  returns: 'Возврат',
  sizes: 'Размеры',
  product: 'Товар',
  account: 'Аккаунт',
  other: 'Другое',
}

/** The link that opens a ticket's conversation — for guests the token is the
 *  key, for account holders it saves a sign-in. */
export function ticketLink(number: string, token: string): string {
  return `${getSiteUrl()}/support/tickets/${encodeURIComponent(number)}?t=${encodeURIComponent(token)}`
}

/**
 * Tells the support inbox about a new request, or a customer's new message in
 * one. replyTo is the customer — but the reply that counts is the one written
 * in the admin, which lands in the thread and emails the customer.
 */
export async function sendTicketToSupportInbox(
  ticket: SupportTicket,
  message: string,
  kind: 'new' | 'reply',
  attachments = 0,
): Promise<boolean> {
  const title = kind === 'new' ? `Новое обращение ${ticket.number}` : `Новое сообщение в ${ticket.number}`
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 0;color:${L.muted};width:96px;">${esc(label)}</td><td style="padding:4px 0;color:${L.strong};">${value}</td></tr>`
  const { ok } = await sendEmail({
    to: SUPPORT_INBOX,
    replyTo: ticket.email,
    subject: `${title} — ${ticket.subject}`,
    html: SHELL(
      title,
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;color:${L.body};">
         ${row('Тема', esc(ticket.subject))}
         ${row('Категория', esc(CATEGORY_RU[ticket.category] ?? ticket.category))}
         ${ticket.orderNumber ? row('Заказ', esc(ticket.orderNumber)) : ''}
         ${row('Клиент', `${esc(ticket.name)} · <a href="mailto:${esc(ticket.email)}" style="color:${L.rule};">${esc(ticket.email)}</a>`)}
         ${attachments ? row('Вложения', String(attachments)) : ''}
       </table>
       <div style="margin-top:20px;padding:16px;background:${L.inset};border-left:2px solid ${L.rule};color:${L.body};font-size:14px;line-height:1.7;">
         ${escMultiline(message)}
       </div>
       <p style="margin:20px 0 0;"><a href="${esc(getSiteUrl())}/admin" style="color:${L.rule};">Ответить в админ-панели → Поддержка</a></p>`,
    ),
  })
  return ok
}

/** "We received your request" — in the language the customer wrote in. */
export async function sendTicketReceived(ticket: SupportTicket, token: string, lang: EmailLang): Promise<boolean> {
  const message = ticketReceivedEmail(ticket, ticketLink(ticket.number, token), lang)
  const { ok } = await sendEmail({ from: SUPPORT_FROM_ADDRESS, to: ticket.email, replyTo: SUPPORT_INBOX, ...message })
  return ok
}

/** "You have a reply" — sent when support answers in the admin. */
export async function sendSupportReply(
  ticket: SupportTicket,
  token: string,
  reply: string,
  lang: EmailLang,
): Promise<boolean> {
  const message = supportReplyEmail(ticket, reply, ticketLink(ticket.number, token), lang)
  const { ok } = await sendEmail({ from: SUPPORT_FROM_ADDRESS, to: ticket.email, replyTo: SUPPORT_INBOX, ...message })
  return ok
}

/**
 * A payment landed on an order whose units had already been returned to
 * stock, and they could not be taken again (reclaim_order_stock). The money
 * is real and the goods are gone: a person must refund or restock.
 */
export async function sendStockConflictAlert(order: Order): Promise<boolean> {
  const { ok } = await sendEmail({
    to: SUPPORT_INBOX,
    subject: `Оплачен заказ ${order.id} без остатка — нужен возврат`,
    html: SHELL(
      `Оплата заказа ${order.id} без товара на складе`,
      `<p style="margin:0 0 12px;">Платёж подтверждён, но заказ был отменён и его позиции уже вернулись в продажу — повторно зарезервировать их не удалось (закончились).</p>
       <p style="margin:0;">Верните платёж клиенту (${esc(order.customer.email ?? '')}) или пополните остаток и обработайте заказ вручную.</p>`,
    ),
  })
  return ok
}

/** The order's language: the one given, else the one stored with the order
 *  (orders.locale), else English. */
async function langFor(order: Order, given?: EmailLang): Promise<EmailLang> {
  if (given) return given
  return emailLang(await getOrderLocale(order.id))
}

/**
 * Order confirmation to the customer, in the language they checked out in.
 *
 * Returns false (never throws) when there is no address to send to, when mail
 * is unconfigured, or when the send is rejected — the caller decides what that
 * means. For checkout it means nothing: the order is already committed and a
 * failed email must not surface as a failed purchase.
 *
 * replyTo is the support inbox rather than the pinned `orders@` sender, so a
 * customer hitting Reply reaches a mailbox someone reads.
 */
export async function sendOrderConfirmation(order: Order, lang?: EmailLang): Promise<boolean> {
  const to = order.customer.email?.trim()
  if (!to) return false
  try {
    const message = orderConfirmationEmail(order, await langFor(order, lang))
    const { ok } = await sendEmail({ to, replyTo: SUPPORT_INBOX, ...message })
    return ok
  } catch (e) {
    console.warn(`[emails] confirmation for ${order.id} threw:`, e)
    return false
  }
}

/**
 * Payment receipt, sent once Stripe confirms the money moved.
 *
 * Never throws: the only caller is the Stripe webhook, and a rejected promise
 * there would return a non-2xx, which makes Stripe retry the whole event —
 * re-running the payment-status write for an email problem.
 */
export async function sendPaymentReceipt(order: Order): Promise<boolean> {
  const to = order.customer.email?.trim()
  if (!to) return false
  try {
    const message = paymentReceiptEmail(order, await langFor(order))
    const { ok } = await sendEmail({ to, replyTo: SUPPORT_INBOX, ...message })
    return ok
  } catch (e) {
    console.warn(`[emails] receipt for ${order.id} threw:`, e)
    return false
  }
}

/**
 * "Payment not completed". The webhook calls this at most once per order (it
 * claims the send first), so a customer retrying a declined card three times
 * gets one email, not three.
 */
export async function sendPaymentFailedEmail(order: Order): Promise<boolean> {
  const to = order.customer.email?.trim()
  if (!to) return false
  try {
    const message = paymentFailedEmail(order, await langFor(order))
    const { ok } = await sendEmail({ to, replyTo: SUPPORT_INBOX, ...message })
    return ok
  } catch (e) {
    console.warn(`[emails] payment-failed notice for ${order.id} threw:`, e)
    return false
  }
}
