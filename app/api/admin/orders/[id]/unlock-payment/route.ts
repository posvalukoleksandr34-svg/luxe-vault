import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/server/admin-guard'
import { unlockOrder } from '@/lib/server/payment-fraud'

export const dynamic = 'force-dynamic'

/**
 * Lifts the card-payment lock the fraud guard put on an order, and the
 * email/IP blocks it caused (lib/server/payment-fraud.ts). For after the
 * admin has checked the customer is genuine.
 */
export async function POST(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  const { id } = await props.params
  if (!/^LV-[A-Z0-9]{4,12}$/.test(id)) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  const ok = await unlockOrder(id)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Order not found' }, { status: 404 })
}
