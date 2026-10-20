import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/admin-guard'
import { signEvidence } from '@/lib/server/refunds/evidence'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/**
 * Opens one evidence file: a five-minute signed link, and an audit row
 * naming who opened it. The link is returned, not redirected to, so the
 * console can open it in a new tab without the address bar holding a token.
 */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('case.view')
  if (!gate.ok) return gate.response
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })
  const signed = await signEvidence(id, gate.actor)
  if (!signed) return NextResponse.json({ error: 'Файл недоступен (удалён по сроку хранения или не загружен)' }, { status: 404 })
  return NextResponse.json({ url: signed.url, mimeType: signed.evidence.mimeType }, { headers: { 'Cache-Control': 'no-store' } })
}
