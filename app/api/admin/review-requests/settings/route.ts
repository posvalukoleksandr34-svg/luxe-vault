import { NextResponse, type NextRequest } from 'next/server'

import { reviewRequestSettingsSchema } from '@/lib/review-requests'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObjectLimited } from '@/lib/server/http'
import { audit } from '@/lib/server/refunds/audit'
import { readReviewRequestSettings, saveReviewRequestSettings } from '@/lib/server/review-requests/settings'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/**
 * PUT the review-request settings — owner only (review_requests.settings).
 * Validated here, whatever the form allowed. Turning sending on or changing
 * the consent basis is recorded in the audit trail with who did it.
 */
export async function PUT(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('review_requests.settings')
  if (!gate.ok) return gate.response
  const body = await readJsonObjectLimited<{ settings?: unknown }>(request, 8 * 1024)
  if (body === 'too_large') return NextResponse.json({ error: 'Слишком большой запрос' }, { status: 413 })
  const parsed = reviewRequestSettingsSchema.safeParse(body?.settings)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Некорректные значения', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }
  try {
    const before = (await readReviewRequestSettings()).settings
    await saveReviewRequestSettings(parsed.data)
    await audit({
      actor: gate.actor,
      action: 'review_requests.settings',
      data: { before, after: parsed.data },
    }).catch((e) => console.error('[admin/review-requests] settings audit failed:', (e as Error).message))
    return NextResponse.json({ settings: parsed.data })
  } catch (e) {
    console.error('[admin/review-requests] settings save failed:', (e as Error).message)
    return NextResponse.json({ error: 'Не удалось сохранить' }, { status: 500 })
  }
}
