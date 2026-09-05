// Reusable Resend transport.
//
// This is the only place in the codebase that talks to Resend. Templates and
// domain-specific senders live in lib/server/mailer.ts and call sendEmail()
// from here, so there is exactly one spot to change if the provider, the
// sender address, or the error handling ever moves.
import 'server-only'

/**
 * Sender identity. Pinned, not read from the environment.
 *
 * Resend only accepts a `from` on a domain verified in your account via DNS
 * (SPF/DKIM). A typo or a stale env var here does not degrade — every send is
 * rejected outright — so this is safer as a constant that fails loudly in code
 * review than as configuration that fails silently in production.
 *
 * The domain must stay `luxe-vault.store` (the verified one). Note it is NOT
 * the same string as the site origin, and NOT the same as `luxevault.store`
 * without the hyphen.
 */
export const FROM_ADDRESS = 'Luxe Vault <orders@luxe-vault.store>'

const API_KEY = process.env.RESEND_API_KEY
const ENDPOINT = 'https://api.resend.com/emails'

/** False when RESEND_API_KEY is absent — callers skip sending rather than fail. */
export const isMailConfigured = Boolean(API_KEY)

export type SendEmailInput = {
  to: string | string[]
  subject: string
  html: string
  /** Plain-text alternative. Improves deliverability and is what a text-only
   *  client renders; without it some spam filters score the message worse. */
  text?: string
  replyTo?: string
}

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: 'not_configured' | 'rejected' | 'network'; message: string }

/**
 * Sends one email.
 *
 * Never throws. Mail is always secondary to whatever the request was actually
 * doing — an order that is safely in Postgres but whose confirmation bounced
 * is a minor problem, whereas failing the checkout because a mail provider
 * blipped is a serious one. Callers get a discriminated result and decide.
 *
 * Uses Resend's REST API directly rather than the `resend` npm package: the v6
 * SDK depends on @react-email/render, which pulls React email rendering into a
 * server bundle that only ever needs to POST a string of HTML.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!API_KEY) {
    return {
      ok: false,
      reason: 'not_configured',
      message: 'RESEND_API_KEY is not set; email skipped.',
    }
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    })

    if (!res.ok) {
      // Resend returns a JSON body explaining the rejection (unverified domain,
      // invalid recipient, quota). Log it server-side — it is the only way to
      // diagnose a silent non-delivery.
      const detail = await res.text().catch(() => '')
      const message = `Resend rejected the send (${res.status}): ${detail.slice(0, 400)}`
      console.error(`[resend] ${message}`)
      return { ok: false, reason: 'rejected', message }
    }

    const data = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, id: data?.id ?? null }
  } catch (e) {
    const message = (e as Error).message
    console.error(`[resend] network failure: ${message}`)
    return { ok: false, reason: 'network', message }
  }
}

/** Minimal HTML escaping. Customer-supplied text (names, product titles) goes
 *  into an HTML email, so an unescaped angle bracket would corrupt the markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
