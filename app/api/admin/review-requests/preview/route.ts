import { NextResponse, type NextRequest } from 'next/server'

import { requireAdmin } from '@/lib/server/admin-guard'
import { EMAIL_LANGS, type EmailLang } from '@/lib/server/emails/copy'
import { previewEmail } from '@/lib/server/review-requests/admin'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/** GET ?lang=en — the review request email with sample data. Sends nothing. */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('review_requests.view')
  if (!gate.ok) return gate.response
  const raw = request.nextUrl.searchParams.get('lang') ?? 'en'
  const lang: EmailLang = (EMAIL_LANGS as readonly string[]).includes(raw) ? (raw as EmailLang) : 'en'
  return NextResponse.json(previewEmail(lang), { headers: { 'Cache-Control': 'no-store' } })
}
