import { NextResponse, type NextRequest } from 'next/server'
import { applySuppression, suppressionFor, verifyResendSignature } from '@/lib/server/email-events'
import { securityEvent } from '@/lib/server/security-events'
import { clientIp } from '@/lib/server/client-ip'

export const dynamic = 'force-dynamic'
// The signature covers the exact bytes: read the body as text, untouched.
export const runtime = 'nodejs'

/**
 * Resend delivery events (lib/server/email-events.ts): hard bounces and spam
 * complaints stop optional mail to that address.
 *
 * Set up in Resend → Webhooks: endpoint https://<site>/api/email/webhook,
 * events "email.bounced" and "email.complained", and the signing secret in
 * RESEND_WEBHOOK_SECRET. Without the secret every delivery is refused (503):
 * an unsigned endpoint would let anyone take addresses off the mailing list.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (!secret) {
    console.error('[email webhook] RESEND_WEBHOOK_SECRET is not set — deliveries are refused.')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const body = await request.text()
  if (body.length > 64_000) return NextResponse.json({ error: 'Too large' }, { status: 413 })

  const signed = verifyResendSignature(
    secret,
    {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
    body,
  )
  if (!signed) {
    securityEvent('webhook_signature_invalid', { route: 'email', ip: clientIp(request.headers) })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: unknown
  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const suppression = suppressionFor(event)
  if (!suppression) return NextResponse.json({ received: true, action: 'none' })

  try {
    await applySuppression(suppression)
  } catch (e) {
    // 500 makes Resend deliver it again later; nothing was half-applied that
    // a repeat could not finish (both writes are idempotent).
    console.error('[email webhook]', (e as Error).message)
    return NextResponse.json({ error: 'Not recorded' }, { status: 500 })
  }
  return NextResponse.json({ received: true, action: suppression.reason, count: suppression.emails.length })
}
