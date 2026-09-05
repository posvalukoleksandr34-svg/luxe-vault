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

const API_KEY = process.env.RESEND_API_KEY

/**
 * Sender address. Must be on a domain verified in Resend via DNS (SPF/DKIM),
 * or Resend rejects the send outright.
 *
 * NOTE: this deliberately does NOT follow the site domain. Verification needs
 * DNS records on the sending domain, and `*.vercel.app` is Vercel's apex — you
 * cannot add records to it. Pointing this at luxe-vault-hlb1.vercel.app would
 * make every email fail. Keep it on a domain you actually own, or use Resend's
 * shared `onboarding@resend.dev` while testing.
 */
const FROM = process.env.RESEND_FROM_EMAIL ?? 'LUXE VAULT <onboarding@resend.dev>'

/**
 * Where customer enquiries land. An inbox, not a website origin — it has to be
 * a mailbox that someone reads, so it likewise does not track the site domain.
 */
const SUPPORT_INBOX = process.env.SUPPORT_INBOX_EMAIL ?? SUPPORT_EMAIL

export const isMailConfigured = Boolean(API_KEY)

/**
 * Posts directly to Resend's REST API rather than using the `resend` SDK.
 *
 * The v6 SDK depends on @react-email/render, which drags React email
 * rendering into a server bundle that only ever needs to send one HTTP
 * request with a string of HTML. One fetch is the whole integration.
 */
async function send(payload: {
  to: string
  replyTo: string
  subject: string
  html: string
}): Promise<boolean> {
  if (!API_KEY) return false

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [payload.to],
        reply_to: payload.replyTo,
        subject: payload.subject,
        html: payload.html,
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error(`[mailer] Resend rejected the send (${res.status}): ${detail.slice(0, 300)}`)
      return false
    }
    return true
  } catch (e) {
    console.error('[mailer] send threw:', e)
    return false
  }
}

/** Minimal HTML escaping. Customer text goes into an HTML email, so an
 *  unescaped angle bracket would corrupt the markup (and worse in a webmail
 *  client that renders it). */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Preserves the customer's line breaks after escaping. */
function escMultiline(value: string): string {
  return esc(value).replace(/\r?\n/g, '<br />')
}

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
  return send({
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
}

/** Confirmation back to the customer, echoing their message. */
export async function sendSupportConfirmation(t: SupportEnquiry): Promise<boolean> {
  return send({
    to: t.email,
    replyTo: SUPPORT_INBOX,
    subject: 'Мы получили ваше сообщение — LUXE VAULT',
    html: SHELL(
        `Здравствуйте, ${t.name}!`,
        `<p style="margin:0 0 16px;">
           Мы получили ваше сообщение и свяжемся с вами в ближайшее время.
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
  })
}
