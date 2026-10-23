import { NextResponse, type NextRequest } from 'next/server'

import { requireAdmin } from '@/lib/server/admin-guard'
import { EMAIL_LANGS, type EmailLang } from '@/lib/server/emails/copy'
import { readJsonObjectLimited } from '@/lib/server/http'
import { enforceLimit } from '@/lib/server/rate-limit'
import { audit } from '@/lib/server/refunds/audit'
import { sendTestEmail } from '@/lib/server/review-requests/admin'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/**
 * POST { to, lang } — sends the sample email to one of the shop's own
 * addresses (lib/server/review-requests/admin.ts testRecipients). Any other
 * address is refused: this button must not be a way to email people.
 * Manager and owner; five an hour.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('review_requests.manage')
  if (!gate.ok) return gate.response
  const limited = await enforceLimit('review_requests.test', request, `staff:${gate.actor.staffId ?? 'legacy'}`)
  if (limited) return limited
  const body = await readJsonObjectLimited<{ to?: unknown; lang?: unknown }>(request, 1024)
  if (!body || body === 'too_large' || typeof body.to !== 'string') return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  const lang: EmailLang = typeof body.lang === 'string' && (EMAIL_LANGS as readonly string[]).includes(body.lang) ? (body.lang as EmailLang) : 'en'
  const result = await sendTestEmail(body.to, lang)
  if (!result.ok) {
    if (result.error === 'not_allowed') {
      return NextResponse.json({ error: 'Тестовое письмо можно отправить только на адреса магазина' }, { status: 403 })
    }
    return NextResponse.json({ error: `Почтовый сервис не принял письмо (${result.error})` }, { status: 502 })
  }
  await audit({ actor: gate.actor, action: 'review_request.test_email', data: { lang } }).catch((e) =>
    console.error('[admin/review-requests] audit failed:', (e as Error).message),
  )
  return NextResponse.json({ ok: true })
}
