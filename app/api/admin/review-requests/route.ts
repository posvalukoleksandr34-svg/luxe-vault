import { NextResponse, type NextRequest } from 'next/server'

import { requireAdmin } from '@/lib/server/admin-guard'
import { listRequests, parseListFilter, requestMetrics, testRecipients } from '@/lib/server/review-requests/admin'
import { ReviewRequestsUnavailable } from '@/lib/server/review-requests/schedule'
import { readReviewRequestSettings } from '@/lib/server/review-requests/settings'
import { isMailConfigured, emailMode } from '@/lib/server/resend'
import { requireStaff } from '@/lib/server/staff'
import { DEFAULT_REVIEW_REQUEST_SETTINGS } from '@/lib/review-requests'

export const dynamic = 'force-dynamic'

/**
 * GET the review-request queue for the admin: one page of requests (filtered
 * by ?status=a,b&q=&product=&from=&to=&page=), the figures, and the settings.
 * Every role may look (review_requests.view); nothing here changes anything.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('review_requests.view')
  if (!gate.ok) return gate.response
  try {
    const filter = parseListFilter(request.nextUrl.searchParams)
    const [list, metrics, settings] = await Promise.all([listRequests(filter), requestMetrics(), readReviewRequestSettings()])
    return NextResponse.json(
      {
        ...list,
        page: filter.page,
        pageSize: filter.pageSize,
        metrics,
        settings: settings.settings,
        settingsSource: settings.source,
        defaults: DEFAULT_REVIEW_REQUEST_SETTINGS,
        mail: { configured: isMailConfigured, mode: emailMode() },
        testRecipients: testRecipients(),
        role: gate.actor.role,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    if (e instanceof ReviewRequestsUnavailable) return NextResponse.json({ error: 'Примените миграцию 0060' }, { status: 503 })
    console.error('[admin/review-requests] list failed:', (e as Error).message)
    return NextResponse.json({ error: 'Не удалось загрузить запросы' }, { status: 500 })
  }
}
