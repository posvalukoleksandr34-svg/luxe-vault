import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { saveAppWelcomeSettings } from '@/lib/server/promo-codes'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

const settingsSchema = z.object({
  enabled: z.boolean(),
  kind: z.enum(['percent', 'fixed']),
  value: z.number().positive('Скидка должна быть больше нуля'),
  maxUses: z.number().int('Использований — целое число').min(1).max(100),
  validForDays: z.number().int('Срок — целое число дней').min(1).max(3650),
})

/**
 * The terms of the installed app's personal code. They apply to codes issued
 * from now on; a code already issued keeps the terms it was issued with.
 */
export async function PUT(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const body = (await readJsonObject<Record<string, unknown>>(request)) ?? {}
    const parsed = settingsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
    }
    if (parsed.data.kind === 'percent' && parsed.data.value > 100) {
      return NextResponse.json({ error: 'Скидка — не больше 100%' }, { status: 400 })
    }
    const result = await saveAppWelcomeSettings(parsed.data)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ settings: result.settings })
  } catch (e) {
    console.error('[admin/promocodes] app settings save failed:', e)
    return NextResponse.json({ error: 'Не удалось сохранить настройки' }, { status: 500 })
  }
}
