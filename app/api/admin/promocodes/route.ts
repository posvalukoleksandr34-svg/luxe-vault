import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { createPromoCode } from '@/lib/server/promo-codes'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

const nullableNumber = z.number().nullable().optional().transform((v) => (v === undefined ? null : v))

const createSchema = z.object({
  code: z.string().trim().min(1, 'Укажите код').transform((v) => v.toUpperCase()),
  kind: z.enum(['percent', 'fixed'], { error: 'Тип скидки: процент или сумма' }),
  value: z.number({ error: 'Укажите размер скидки' }),
  maxUses: nullableNumber,
  validForDays: nullableNumber,
  expiresAt: z.string().nullable().optional().transform((v) => (v ? v : null)),
  minOrderTotal: nullableNumber,
})

/** Creates a promo code. The rules (ranges, expiry in the future, one of
 *  days or date) are checked in lib/server/promo-codes.ts. */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const body = (await readJsonObject<Record<string, unknown>>(request)) ?? {}
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
    }
    const result = await createPromoCode(parsed.data)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ promo: result.promo }, { status: 201 })
  } catch (e) {
    console.error('[admin/promocodes] create failed:', e)
    return NextResponse.json({ error: 'Не удалось создать промокод' }, { status: 500 })
  }
}
