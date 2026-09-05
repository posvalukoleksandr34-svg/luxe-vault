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
import {
  orderConfirmationHtml,
  orderConfirmationSubject,
  orderConfirmationText,
} from '@/lib/server/emails/order-confirmation'
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

const SHELL = (title: string, body: string) => `
<!doctype html>
<html lang="ru">
  <body style="margin:0;padding:0;background:#0b0b0b;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0b;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#131313;border:1px solid #262626;">
            <tr>
              <td style="padding:28px 32px 20px;border-bottom:1px solid #262626;">
                <span style="font-size:15px;letter-spacing:.22em;color:#f5f3ef;font-weight:700;">LUXE</span><span style="font-size:15px;letter-spacing:.22em;color:#c9a227;font-weight:700;">VAULT</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 32px;color:#d6d3cd;font-size:14px;line-height:1.7;">
                <h1 style="margin:0 0 16px;font-size:18px;color:#f5f3ef;font-weight:600;">${esc(title)}</h1>
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;border-top:1px solid #262626;color:#6d6d6d;font-size:11px;">
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
        `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;color:#d6d3cd;">
           <tr><td style="padding:4px 0;color:#6d6d6d;width:90px;">Имя</td><td style="padding:4px 0;color:#f5f3ef;">${esc(t.name)}</td></tr>
           <tr><td style="padding:4px 0;color:#6d6d6d;">Email</td><td style="padding:4px 0;"><a href="mailto:${esc(t.email)}" style="color:#c9a227;">${esc(t.email)}</a></td></tr>
           <tr><td style="padding:4px 0;color:#6d6d6d;">Тикет</td><td style="padding:4px 0;color:#6d6d6d;font-family:monospace;">${esc(t.id)}</td></tr>
         </table>
         <div style="margin-top:20px;padding:16px;background:#0b0b0b;border-left:2px solid #c9a227;color:#d6d3cd;font-size:14px;line-height:1.7;">
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
         <p style="margin:0 0 8px;color:#6d6d6d;font-size:12px;text-transform:uppercase;letter-spacing:.12em;">
           Копия вашего обращения
         </p>
         <div style="padding:16px;background:#0b0b0b;border-left:2px solid #c9a227;color:#d6d3cd;font-size:14px;line-height:1.7;">
           ${escMultiline(t.message)}
         </div>
         <p style="margin:20px 0 0;color:#6d6d6d;font-size:12px;">
           Номер обращения: <span style="font-family:monospace;color:#d6d3cd;">${esc(t.id)}</span>
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

/**
 * Order confirmation to the customer.
 *
 * Returns false (never throws) when there is no address to send to, when
 * Resend is unconfigured, or when the send is rejected — the caller decides
 * what that means. For checkout it means nothing: the order is already
 * committed and a failed email must not surface as a failed purchase.
 *
 * replyTo is the support inbox rather than the pinned `orders@` sender, so a
 * customer hitting Reply reaches a mailbox someone reads.
 */
export async function sendOrderConfirmation(order: Order): Promise<boolean> {
  const to = order.customer.email?.trim()
  if (!to) return false

  const { ok } = await sendEmail({
    to,
    replyTo: SUPPORT_INBOX,
    subject: orderConfirmationSubject(order),
    html: orderConfirmationHtml(order),
    text: orderConfirmationText(order),
  })
  return ok
}
