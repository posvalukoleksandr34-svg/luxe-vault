import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { DISCOUNT_RANGE, REWARD_RANGE, updateReferralSettings } from '@/lib/server/referral-settings'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

const settingsSchema = z.object({
  friendDiscountPercent: z
    .number({ error: 'Скидка должна быть числом' })
    .int('Скидка — целое число процентов')
    .min(DISCOUNT_RANGE.min, `Скидка — от ${DISCOUNT_RANGE.min}%`)
    .max(DISCOUNT_RANGE.max, `Скидка — не больше ${DISCOUNT_RANGE.max}%`),
  referrerRewardAmount: z
    .number({ error: 'Бонус должен быть числом' })
    .min(REWARD_RANGE.min, 'Бонус не может быть отрицательным')
    .max(REWARD_RANGE.max, `Бонус — не больше ${REWARD_RANGE.max} CHF`),
})

/**
 * Saves the referral programme's two numbers. They apply from now on: to
 * discounts on orders placed after this, and to rewards for payments that
 * arrive after it. Rewards already credited keep their amount.
 */
export async function PUT(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const body = (await readJsonObject<Record<string, unknown>>(request)) ?? {}
  const parsed = settingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
  }

  const result = await updateReferralSettings({
    friendDiscountPercent: parsed.data.friendDiscountPercent,
    // Money is kept to the centime.
    referrerRewardAmount: Math.round(parsed.data.referrerRewardAmount * 100) / 100,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.missing ? 503 : 500 })
  }
  return NextResponse.json({ settings: result.settings })
}
