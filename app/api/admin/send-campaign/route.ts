import { NextResponse, type NextRequest } from 'next/server'
import { SUPPORT_EMAIL } from '@/lib/data'
import { newsletterLang, renderCampaignEmail, validateCampaign } from '@/lib/newsletter/campaign'
import {
  activeRecipients,
  closeCampaign,
  isToken,
  openCampaign,
  type Recipient,
} from '@/lib/server/newsletter-campaigns'
import {
  BATCH_SIZE,
  NEWSLETTER_FROM_ADDRESS,
  emailMode,
  sendEmailBatch,
  type SendEmailInput,
} from '@/lib/server/resend'
import { getSiteUrl } from '@/lib/site-url'
import { requireAdmin } from '@/lib/server/admin-guard'

export const dynamic = 'force-dynamic'
// A large list is many batches; give the send room to finish.
export const maxDuration = 300

// Auth is enforced by middleware.ts for every /api/admin/* path.

/** Resend's default limit is two requests a second. */
const PAUSE_BETWEEN_BATCHES_MS = 600

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Sends a campaign to every active subscriber.
 *
 * Body: the composed campaign, plus `clientKey` (a uuid the composer mints per
 * draft) and `expectedRecipients` (the number the admin confirmed).
 *
 * Refuses when:
 *   - a field is invalid (the same rules the composer shows);
 *   - `clientKey` was already sent — a double-click or a retried request
 *     cannot mail the list twice;
 *   - the list changed size since the admin confirmed by more than a few
 *     sign-ups, so "send to 142" never quietly becomes "send to 1,420".
 *
 * The response is newline-delimited JSON, streamed, so the admin page can show
 * progress while the batches go out:
 *   {"type":"start","total":142,"mode":"live"}
 *   {"type":"progress","sent":100,"failed":0,"total":142}
 *   {"type":"done","sent":142,"failed":0,"total":142,"mode":"live"}
 *
 * Every email carries its recipient's own unsubscribe link, in the footer and
 * in List-Unsubscribe headers for the mail client's one-click button.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { content, errors } = validateCampaign(body)
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'INVALID_CAMPAIGN', errors }, { status: 400 })
  }
  const clientKey = body.clientKey
  if (!isToken(clientKey)) {
    return NextResponse.json({ error: 'Missing clientKey' }, { status: 400 })
  }
  const expected = Number(body.expectedRecipients)

  let recipients: Recipient[]
  try {
    recipients = await activeRecipients()
  } catch (e) {
    console.error('[send-campaign]', (e as Error).message)
    return NextResponse.json({ error: 'Could not read subscribers' }, { status: 500 })
  }
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'NO_RECIPIENTS' }, { status: 409 })
  }
  if (Number.isFinite(expected) && Math.abs(recipients.length - expected) > Math.max(5, expected * 0.05)) {
    return NextResponse.json({ error: 'RECIPIENTS_CHANGED', total: recipients.length }, { status: 409 })
  }

  const mode = emailMode()
  const opened = await openCampaign({ clientKey, content, mode, recipients: recipients.length })
  if ('duplicate' in opened) return NextResponse.json({ error: 'ALREADY_SENT' }, { status: 409 })
  if ('error' in opened) {
    console.error('[send-campaign] could not record the campaign:', opened.error)
    return NextResponse.json({ error: 'Could not record the campaign' }, { status: 500 })
  }

  const site = getSiteUrl().replace(/\/$/, '')
  const total = recipients.length
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      emit({ type: 'start', total, mode })

      let sent = 0
      let failed = 0
      let lastError: string | undefined

      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = recipients.slice(i, i + BATCH_SIZE)
        const emails: SendEmailInput[] = batch.map((r) => {
          const unsubscribeUrl = `${site}/newsletter/unsubscribe?token=${r.token}`
          const oneClickUrl = `${site}/api/newsletter/unsubscribe?token=${r.token}`
          const { html, text } = renderCampaignEmail(content, {
            siteUrl: site,
            unsubscribeUrl,
            lang: newsletterLang(r.locale),
          })
          return {
            from: NEWSLETTER_FROM_ADDRESS,
            to: r.email,
            subject: content.subject,
            html,
            text,
            replyTo: SUPPORT_EMAIL,
            headers: {
              'List-Unsubscribe': `<${oneClickUrl}>, <mailto:${SUPPORT_EMAIL}?subject=unsubscribe>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        })

        const result = await sendEmailBatch(emails)
        sent += result.sent
        failed += result.failed
        if (result.error) lastError = result.error
        emit({ type: 'progress', sent, failed, total })

        if (i + BATCH_SIZE < total) await sleep(PAUSE_BETWEEN_BATCHES_MS)
      }

      await closeCampaign(opened.id, { sent, failed, error: lastError })
      emit({ type: 'done', sent, failed, total, mode, ...(lastError ? { error: lastError.slice(0, 300) } : {}) })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
