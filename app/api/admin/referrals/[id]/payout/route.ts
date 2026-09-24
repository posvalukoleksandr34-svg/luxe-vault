import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { markReferralPaidOut } from '@/lib/server/referral-admin'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

const payoutSchema = z.object({
  id: z.uuid('Неверный идентификатор'),
  note: z.string().trim().max(200, 'Комментарий — до 200 символов').optional(),
})

/**
 * Marks a referrer's reward as paid out. The money itself moves outside the
 * shop — a bank transfer, TWINT — and this records that it did, so the
 * reward leaves the "to pay" list and the customer's balance.
 *
 * Idempotent: a second press answers "already", never a second deduction.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const body = (await readJsonObject<Record<string, unknown>>(request)) ?? {}
  // The id is the ROUTE's, whatever the body says.
  const parsed = payoutSchema.safeParse({ ...body, id: params.id })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
  }

  const result = await markReferralPaidOut(parsed.data.id, parsed.data.note || null)
  switch (result) {
    case 'paid':
      return NextResponse.json({ ok: true })
    case 'already':
      return NextResponse.json({ ok: true, already: true })
    case 'not_payable':
      return NextResponse.json(
        { error: 'Бонус не начислен: заказ друга ещё не оплачен или был возвращён' },
        { status: 409 },
      )
    case 'unavailable':
      return NextResponse.json(
        { error: 'Выплаты не настроены — примените миграцию 0041_referral_admin.sql' },
        { status: 503 },
      )
    default:
      return NextResponse.json({ error: 'Не удалось отметить выплату' }, { status: 500 })
  }
}
