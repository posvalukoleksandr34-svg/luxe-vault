import { NextResponse, type NextRequest } from 'next/server'
import { hasBearerSecret } from '@/lib/server/secure-compare'
import { securityEvent } from '@/lib/server/security-events'
import { clientIp } from '@/lib/server/client-ip'
import { purgeOld, reconcile, ReviewRequestsUnavailable } from '@/lib/server/review-requests/schedule'
import { readReviewRequestSettings } from '@/lib/server/review-requests/settings'
import { processDue } from '@/lib/server/review-requests/worker'
import { reportCriticalError } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

/**
 * Post-delivery review requests (lib/server/review-requests): reconcile the
 * queue with delivered orders, send what is due, delete what is past the
 * 12-month retention. Hourly from
 * .github/workflows/abandoned-carts-cron.yml; safe to run again or twice at
 * once (unique order per request, SKIP LOCKED claims, idempotent sends).
 *
 * Bearer CRON_SECRET, failing closed. The answer has counts only — no
 * customer details. Errors answer 500 (the workflow turns red) and alert.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://www.luxe-vault.store/api/cron/review-requests
 */
async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — review requests are not processed.')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  if (!hasBearerSecret(request.headers.get('authorization'), secret)) {
    securityEvent('cron_unauthorized', { route: 'review-requests', ip: clientIp(request.headers) })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { settings } = await readReviewRequestSettings()
    const reconciled = await reconcile(settings)
    const sent = await processDue(settings)
    const purged = await purgeOld()
    console.log(`[review-requests] run: ${JSON.stringify({ reconciled, sent, purged })}`)
    if (sent.status === 'ok' && sent.errors.length) {
      await reportCriticalError('Review requests', `${sent.errors.length} request(s) could not be processed; retried with backoff. First: ${sent.errors[0]}`)
      return NextResponse.json({ reconciled, sent, purged }, { status: 500 })
    }
    if (sent.status === 'ok' && sent.failed > 0) {
      await reportCriticalError('Review requests', `${sent.failed} review request email(s) failed permanently — see Admin → Отзывы: запросы.`)
    }
    return NextResponse.json({ reconciled, sent, purged })
  } catch (e) {
    if (e instanceof ReviewRequestsUnavailable) {
      return NextResponse.json({ error: 'Apply migration 0060' }, { status: 503 })
    }
    await reportCriticalError('Review requests', e)
    return NextResponse.json({ error: 'Review request run failed' }, { status: 500 })
  }
}

export const GET = run
export const POST = run
