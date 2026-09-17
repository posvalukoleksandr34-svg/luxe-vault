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

/**
 * Sender for support correspondence. Same verified domain, different mailbox,
 * so a customer replying to an auto-reply lands with support rather than in
 * the orders stream. Both were confirmed accepted by Resend.
 */
export const SUPPORT_FROM_ADDRESS = 'Luxe Vault <support@luxe-vault.store>'

const API_KEY = process.env.RESEND_API_KEY
const ENDPOINT = 'https://api.resend.com/emails'

/**
 * Delivery mode.
 *
 *   live — send to the real recipient.
 *   test — never mail a customer: log a masked line instead or, with
 *          EMAIL_TEST_RECIPIENT set (and a provider key), redirect every email
 *          there with the intended recipient in the subject.
 *
 * EMAIL_DELIVERY=test|live chooses explicitly. Unset, it is live exactly when a
 * mail provider is configured — so emails stay in test mode until one is, and
 * a configured production shop keeps sending as it always has.
 */
export type EmailMode = 'live' | 'test'

const MODE_SETTING = process.env.EMAIL_DELIVERY?.trim().toLowerCase()
const TEST_RECIPIENT = process.env.EMAIL_TEST_RECIPIENT?.trim()

export function emailMode(): EmailMode {
  if (MODE_SETTING === 'test') return 'test'
  if (MODE_SETTING === 'live') return 'live'
  return API_KEY ? 'live' : 'test'
}

/**
 * True when sending is worth attempting: a provider is configured, or test
 * mode was chosen explicitly (then it logs). False otherwise — callers skip
 * sending rather than fail.
 */
export const isMailConfigured = Boolean(API_KEY) || MODE_SETTING === 'test'

/** "a***@example.com" — enough to recognise in a log, not enough to harvest. */
function maskEmail(address: string): string {
  const [local, domain] = address.split('@')
  if (!domain) return '***'
  return `${local.slice(0, 1)}***@${domain}`
}

export type SendEmailInput = {
  to: string | string[]
  subject: string
  html: string
  /** Plain-text alternative. Improves deliverability and is what a text-only
   *  client renders; without it some spam filters score the message worse. */
  text?: string
  replyTo?: string
  /** Overrides FROM_ADDRESS. Must still be on the verified domain — Resend
   *  rejects anything else outright. */
  from?: string
  /** Extra message headers — e.g. List-Unsubscribe on prompted mail. */
  headers?: Record<string, string>
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
  if (emailMode() === 'test') {
    const intended = (Array.isArray(input.to) ? input.to : [input.to]).map(maskEmail).join(', ')
    if (!API_KEY || !TEST_RECIPIENT) {
      // Rendered, not delivered. `ok` so callers treat it like a send and do
      // not retry it forever.
      console.info(`[mail:test] not sent — "${input.subject}" → ${intended}`)
      return { ok: true, id: null }
    }
    input = { ...input, to: TEST_RECIPIENT, subject: `[TEST → ${intended}] ${input.subject}` }
  }

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
        from: input.from ?? FROM_ADDRESS,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
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

/**
 * Sender for newsletter campaigns. Same verified domain, its own mailbox, so a
 * marketing email never shares a sender with order mail — a recipient who
 * files one as unwanted does not teach their provider to bury the other.
 */
export const NEWSLETTER_FROM_ADDRESS = 'Luxe Vault <news@luxe-vault.store>'

const BATCH_ENDPOINT = 'https://api.resend.com/emails/batch'
/** Resend accepts up to 100 emails per batch request. */
export const BATCH_SIZE = 100

export type BatchResult = {
  /** Emails Resend accepted (or, in test mode, rendered and not delivered). */
  sent: number
  failed: number
  error?: string
}

/**
 * Sends up to BATCH_SIZE individual emails in one request — each with its own
 * recipient, body and headers, so every subscriber gets their own unsubscribe
 * link. Never throws.
 *
 * Test mode keeps its promise not to mail real recipients: without
 * EMAIL_TEST_RECIPIENT it logs and delivers nothing; with it, ONE sample of
 * the batch goes to the test inbox (not a hundred copies).
 */
export async function sendEmailBatch(inputs: SendEmailInput[]): Promise<BatchResult> {
  if (inputs.length === 0) return { sent: 0, failed: 0 }
  if (inputs.length > BATCH_SIZE) {
    return { sent: 0, failed: inputs.length, error: `A batch holds at most ${BATCH_SIZE} emails.` }
  }

  if (emailMode() === 'test') {
    const first = inputs[0]
    const sample = await sendEmail(first)
    console.info(`[mail:test] batch of ${inputs.length} — "${first.subject}" — not delivered to recipients`)
    return sample.ok ? { sent: inputs.length, failed: 0 } : { sent: 0, failed: inputs.length, error: sample.message }
  }

  if (!API_KEY) {
    return { sent: 0, failed: inputs.length, error: 'RESEND_API_KEY is not set; nothing was sent.' }
  }

  try {
    const res = await fetch(BATCH_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        inputs.map((input) => ({
          from: input.from ?? FROM_ADDRESS,
          to: Array.isArray(input.to) ? input.to : [input.to],
          subject: input.subject,
          html: input.html,
          ...(input.text ? { text: input.text } : {}),
          ...(input.replyTo ? { reply_to: input.replyTo } : {}),
          ...(input.headers ? { headers: input.headers } : {}),
        })),
      ),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const error = `Resend rejected the batch (${res.status}): ${detail.slice(0, 400)}`
      console.error(`[resend] ${error}`)
      return { sent: 0, failed: inputs.length, error }
    }

    const data = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null
    const accepted = Array.isArray(data?.data) ? data!.data.length : inputs.length
    return { sent: accepted, failed: inputs.length - accepted }
  } catch (e) {
    const error = (e as Error).message
    console.error(`[resend] batch network failure: ${error}`)
    return { sent: 0, failed: inputs.length, error }
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
