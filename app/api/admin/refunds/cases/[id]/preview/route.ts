import { NextResponse, type NextRequest } from 'next/server'

import { RESOLUTIONS, type Resolution } from '@/lib/refunds/types'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { previewApproval } from '@/lib/server/refunds/workflow'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/** What approving with these choices would refund — computed, never stored. */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('case.decide')
  if (!gate.ok) return gate.response
  const body = (await readJsonObject<Record<string, unknown>>(request)) ?? {}
  const resolution = (RESOLUTIONS as readonly string[]).includes(String(body.resolution)) ? (body.resolution as Resolution) : undefined
  const int = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined)
  const lines = Array.isArray(body.lines)
    ? (body.lines as { itemId?: unknown; qty?: unknown }[]).slice(0, 50).map((l) => ({ itemId: String(l.itemId), qty: Number(l.qty) }))
    : undefined
  const result = await previewApproval(id, {
    resolution,
    lines,
    deductionMinor: int(body.deductionMinor),
    returnPostageMinor: int(body.returnPostageMinor),
    includeShipping: typeof body.includeShipping === 'boolean' ? body.includeShipping : undefined,
    amountMinor: int(body.amountMinor),
  })
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 })
  return NextResponse.json(result)
}
