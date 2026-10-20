import { NextResponse, type NextRequest } from 'next/server'
import { clientIp } from '@/lib/server/client-ip'
import { runRefundSweep } from '@/lib/server/refunds/sweep'
import { hasBearerSecret } from '@/lib/server/secure-compare'
import { securityEvent } from '@/lib/server/security-events'
import { reportCriticalError } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

/**
 * The refund system's scheduled work (lib/server/refunds/sweep.ts): refunds
 * whose outcome is unknown are checked with Stripe, customer deadlines expire
 * cases, finished delivery waits come back to a person, overdue cases are
 * escalated, failed notifications are retried, and evidence past its
 * retention period is deleted. Hourly from .github/workflows/abandoned-carts-cron.yml,
 * and from the nightly sweep as a fallback.
 *
 * Authenticated like every cron route — the shared secret as a bearer token,
 * failing closed without it. The answer carries counts only.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://www.luxe-vault.store/api/cron/refunds
 */
async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — the refund sweep is disabled.')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  if (!hasBearerSecret(request.headers.get('authorization'), secret)) {
    securityEvent('cron_unauthorized', { route: 'refunds', ip: clientIp(request.headers) })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runRefundSweep()
  if (result.errors.length > 0) {
    await reportCriticalError('Refund sweep', result.errors.join('; '))
    return NextResponse.json(result, { status: 500 })
  }
  return NextResponse.json(result)
}

export const GET = run
export const POST = run
