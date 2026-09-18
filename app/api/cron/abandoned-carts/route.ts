import { NextResponse, type NextRequest } from 'next/server'
import { runAbandonedCartReminders } from '@/lib/server/abandoned-cart-flow'
import { hasBearerSecret } from '@/lib/server/secure-compare'
import { reportCriticalError } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

/**
 * The abandoned-cart reminder run: every cart left untouched for longer than
 * ABANDONED_CART_DELAY_MINUTES (default two hours) after its owner typed an
 * email at checkout gets ONE reminder (lib/server/abandoned-cart-flow.ts).
 *
 * NOT scheduled in vercel.json: the Vercel Hobby plan allows only daily cron
 * jobs and fails the deployment on an hourly one, and a daily run would turn
 * "two hours" into "up to a day". Call it hourly from an external scheduler
 * instead — .github/workflows/abandoned-cart-reminders.yml does exactly that
 * once CRON_SECRET and SITE_URL are set as repository secrets. The nightly
 * sweep also runs it, so reminders still go out (up to a day late) with no
 * external scheduler at all.
 *
 * Authenticated like /api/cron/sweep — the shared secret in the Authorization
 * header — and failing closed without it: an open version would be a button
 * anyone could press to mail customers.
 *
 * The claim (claim_abandoned_carts, migration 0029) stamps each cart before
 * any email goes out, so overlapping runs divide the work rather than
 * duplicating it, and a failed send is not retried — one missed reminder
 * costs far less than a repeated one.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://luxe-vault.store/api/cron/abandoned-carts
 */
async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — abandoned-cart reminders are disabled.')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  if (!hasBearerSecret(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json(await runAbandonedCartReminders(100))
  } catch (e) {
    await reportCriticalError('Abandoned-cart run', e)
    return NextResponse.json({ error: 'Reminder run failed' }, { status: 503 })
  }
}

/** Most schedulers issue a GET; see /api/cron/sweep for why that is fine here. */
export const GET = run
export const POST = run
