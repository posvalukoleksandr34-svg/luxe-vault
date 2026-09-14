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
import type { Order } from '@/lib/types'

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

export type SupportEnquiry = {
  id: string
  name: string
  email: string
  message: string
}

/** Notifies the support inbox. `replyTo` is the customer, so hitting Reply in
 *  the mail client answers them directly instead of the noreply sender. */
export async function sendSupportNotification(t: SupportEnquiry): Promise<boolean> {
  const { ok } = await sendEmail({
    to: SUPPORT_INBOX,
    replyTo: t.email,
    subject: `Новое обращение — ${t.name}`,
    html: SHELL(
        'Новое обращение в поддержку',
        `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;color:${L.body};">
           <tr><td style="padding:4px 0;color:${L.muted};width:90px;">Имя</td><td style="padding:4px 0;color:${L.strong};">${esc(t.name)}</td></tr>
           <tr><td style="padding:4px 0;color:${L.muted};">Email</td><td style="padding:4px 0;"><a href="mailto:${esc(t.email)}" style="color:${L.rule};">${esc(t.email)}</a></td></tr>
           <tr><td style="padding:4px 0;color:${L.muted};">Тикет</td><td style="padding:4px 0;color:${L.muted};font-family:monospace;">${esc(t.id)}</td></tr>
         </table>
         <div style="margin-top:20px;padding:16px;background:${L.inset};border-left:2px solid ${L.rule};color:${L.body};font-size:14px;line-height:1.7;">
           ${escMultiline(t.message)}
         </div>`,
    ),
  })
  return ok
}

/**
 * Auto-reply to the customer who submitted the form.
 *
 * Keeps the dark brand layout (SHELL above): black ground, LUXE/VAULT header,
 * the quoted "Копия вашего обращения" block and the ticket number.
 *
 * Sent from support@ rather than the default orders@ so a reply lands with the
 * support team, and replyTo points at the monitored inbox — the copy tells the
 * customer to "просто ответьте на это письмо", so that reply has to reach a
 * human.
 */
export async function sendSupportConfirmation(t: SupportEnquiry): Promise<boolean> {
  const { ok } = await sendEmail({
    from: SUPPORT_FROM_ADDRESS,
    to: t.email,
    replyTo: SUPPORT_INBOX,
    subject: 'Мы получили ваше сообщение — LUXE VAULT',
    html: SHELL(
      `Здравствуйте, ${t.name}!`,
      `<p style="margin:0 0 16px;">
           Спасибо, что связались с нами. Мы получили ваше сообщение и уже
           передали его нашей команде поддержки. Наш менеджер свяжется с вами
           в течение 24 часов. Если у вас появились срочные дополнения, просто
           ответьте на это письмо.
         </p>
         <p style="margin:0 0 8px;color:${L.heading};font-size:12px;text-transform:uppercase;letter-spacing:.12em;">
           Копия вашего обращения
         </p>
         <div style="padding:16px;background:${L.inset};border-left:2px solid ${L.rule};color:${L.body};font-size:14px;line-height:1.7;">
           ${escMultiline(t.message)}
         </div>
         <p style="margin:20px 0 0;color:${L.muted};font-size:12px;">
           Номер обращения: <span style="font-family:monospace;color:${L.strong};">${esc(t.id)}</span>
         </p>`,
    ),
    text: [
      `Здравствуйте, ${t.name}!`,
      '',
      'Спасибо, что связались с нами. Мы получили ваше сообщение и уже передали',
      'его нашей команде поддержки. Наш менеджер свяжется с вами в течение 24 часов.',
      'Если у вас появились срочные дополнения, просто ответьте на это письмо.',
      '',
      'КОПИЯ ВАШЕГО ОБРАЩЕНИЯ',
      t.message,
      '',
      `Номер обращения: ${t.id}`,
      '',
      'LUXE VAULT · Это письмо отправлено автоматически',
    ].join('\n'),
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
