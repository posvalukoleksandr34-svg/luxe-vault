import { NextResponse, type NextRequest } from 'next/server'
import { enforceLimit } from '@/lib/server/rate-limit'
import {
  passwordRecoveryHtml,
  passwordRecoverySubject,
  passwordRecoveryText,
  recoveryLang,
} from '@/lib/server/emails/password-recovery'
import { isMailConfigured, sendEmail, SUPPORT_FROM_ADDRESS } from '@/lib/server/resend'

export const dynamic = 'force-dynamic'

/**
 * Password recovery, sent through Resend instead of Supabase's mailer.
 *
 * WHY NOT resetPasswordForEmail(). Measurement showed Supabase's send path is
 * healthy — POST /auth/v1/recover returns 200 in ~1.4s, real SMTP latency. The
 * failure is not delivery, it is content and routing:
 *
 *   1. The email body comes from a template pasted into the Supabase
 *      dashboard. If that template still carries the stock
 *      `{{ .ConfirmationURL }}`, the customer receives a link and no code —
 *      while this app's UI asks for a six-digit code. Unfixable from code.
 *   2. `redirect_to` is silently downgraded to the project's Site URL when the
 *      requested URL is not in the dashboard allow-list. Verified: asking for
 *      `/auth/callback?next=/auth/update-password` came back as bare
 *      `https://luxe-vault.store`, so the link landed on the homepage and the
 *      customer reasonably concluded "nothing arrived".
 *
 * Generating the code server-side and sending it ourselves removes the
 * dashboard from the critical path for both problems, and puts recovery on the
 * same delivery route as the order receipts that already arrive reliably.
 *
 * The code returned by admin/generate_link IS the same one-time OTP that
 * `verifyOtp({ type: 'recovery' })` accepts, so the rest of the flow is
 * unchanged.
 */

/**
 * In-memory throttle. Deliberately modest in ambition: this is a single-region
 * deployment, and the goal is to stop one browser hammering the endpoint into
 * an email-bombing tool, not to build distributed rate limiting. A serverless
 * cold start resets it, which is acceptable for that goal — Supabase applies
 * its own limits underneath.
 */
const attempts = new Map<string, { count: number; first: number }>()
const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_WINDOW = 5

function throttled(key: string): boolean {
  const now = Date.now()
  const rec = attempts.get(key)
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now })
    return false
  }
  rec.count += 1
  return rec.count > MAX_PER_WINDOW
}

export async function POST(request: NextRequest) {
  const limited = await enforceLimit('auth.recovery', request)
  if (limited) return limited

  let body: { email?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  // Throttle on IP + email so one address cannot be spammed and one client
  // cannot enumerate many addresses.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  if (throttled(`${ip}:${email}`)) {
    return NextResponse.json(
      { error: 'Слишком много запросов. Попробуйте через несколько минут.' },
      { status: 429 },
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey || !isMailConfigured) {
    return NextResponse.json({ error: 'Recovery is not configured' }, { status: 503 })
  }

  try {
    // generate_link mints the recovery OTP WITHOUT sending anything — the
    // email is ours to send. It also returns the user's stored metadata, which
    // is where the account's language lives.
    const res = await fetch(`${url}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'recovery', email }),
    })

    if (res.ok) {
      const data = (await res.json()) as {
        email_otp?: string
        user_metadata?: { language?: string }
        email_confirmed_at?: string | null
      }

      // An unconfirmed account has no verified mailbox to send a recovery code
      // to; sending anyway would leak that the address is registered. Silently
      // skipped, and the caller still gets the same neutral 200 below.
      if (data.email_otp && data.email_confirmed_at) {
        const lang = recoveryLang(data.user_metadata?.language)
        await sendEmail({
          from: SUPPORT_FROM_ADDRESS,
          to: email,
          subject: passwordRecoverySubject(lang),
          html: passwordRecoveryHtml(data.email_otp, lang),
          text: passwordRecoveryText(data.email_otp, lang),
        })
      }
    }
    // A non-ok response means no such user (or an unusable one). Deliberately
    // not surfaced — see below.
  } catch {
    // Swallowed for the same reason: the response must not vary.
  }

  // ALWAYS 200, whatever happened above. A different response for a registered
  // address would turn this endpoint into an account-existence oracle, letting
  // anyone test which of their leaked-password emails have accounts here.
  return NextResponse.json({ ok: true })
}
