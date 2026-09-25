import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { deletePromoCode, updatePromoCode } from '@/lib/server/promo-codes'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

const idSchema = z.uuid('Неверный идентификатор')

const patchSchema = z.object({
  active: z.boolean().optional(),
  maxUses: z.number().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
})

/** Turns a code on or off, or changes its limit or expiry. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    if (!idSchema.safeParse(params.id).success) return NextResponse.json({ error: 'Неверный идентификатор' }, { status: 400 })
    const body = (await readJsonObject<Record<string, unknown>>(request)) ?? {}
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
    }
    const result = await updatePromoCode(params.id, parsed.data)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ promo: result.promo })
  } catch (e) {
    console.error(`[admin/promocodes] update of ${params.id} failed:`, e)
    return NextResponse.json({ error: 'Не удалось сохранить промокод' }, { status: 500 })
  }
}

/** Deletes a code no order has used; a used one can only be switched off. */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    if (!idSchema.safeParse(params.id).success) return NextResponse.json({ error: 'Неверный идентификатор' }, { status: 400 })
    const result = await deletePromoCode(params.id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(`[admin/promocodes] delete of ${params.id} failed:`, e)
    return NextResponse.json({ error: 'Не удалось удалить промокод' }, { status: 500 })
  }
}
