import { NextResponse, type NextRequest } from 'next/server'

import { can } from '@/lib/refunds/permissions'
import { checkTransition } from '@/lib/refunds/state-machine'
import { EVIDENCE_KINDS, type EvidenceKind } from '@/lib/refunds/types'
import { requireAdmin } from '@/lib/server/admin-guard'
import { getCase } from '@/lib/server/refunds/cases'
import { uploadStaffEvidence } from '@/lib/server/refunds/evidence'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * A file staff attach to a case — a carrier's letter, a proof-of-delivery
 * PDF, a photo of what came back. Checked like every upload here: type AND
 * first bytes, size; stored privately, hashed, and recorded with who added it
 * and when the fact was observed. Multipart: file, kind, title?, capturedAt?.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('case.triage')
  if (!gate.ok) return gate.response
  const c = await getCase(id)
  if (!c) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
  const check = checkTransition({ command: 'record_evidence', state: c.state, actor: 'staff', hasPermission: (p) => can(gate.actor.role, p) })
  if (!check.ok) return NextResponse.json({ error: 'В этом статусе доказательства не добавляются' }, { status: 409 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Нет файла' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Нет файла' }, { status: 400 })
  const kind = String(form.get('kind') ?? 'other') as EvidenceKind
  if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: 'Неизвестный тип' }, { status: 400 })
  const capturedAt = Number(form.get('capturedAt'))
  const result = await uploadStaffEvidence({
    caseId: c.id,
    orderId: c.orderId,
    bytes: new Uint8Array(await file.arrayBuffer()),
    mimeType: file.type,
    kind,
    title: typeof form.get('title') === 'string' ? String(form.get('title')).slice(0, 200) : undefined,
    capturedAt: Number.isFinite(capturedAt) && capturedAt > 0 && capturedAt <= Date.now() ? capturedAt : undefined,
    customerVisible: form.get('customerVisible') === 'true',
    actor: gate.actor,
  })
  if (!result.ok) {
    const message = result.refusal === 'too_large' ? 'Файл больше 4 МБ' : result.refusal === 'empty' ? 'Пустой файл' : 'Нужен JPEG, PNG, WebP, HEIC или PDF'
    return NextResponse.json({ error: message }, { status: result.refusal === 'too_large' ? 413 : 415 })
  }
  return NextResponse.json({ evidence: { ...result.evidence, path: undefined, bucket: undefined } }, { status: 201 })
}
