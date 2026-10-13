import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/server/admin-guard'
import { reconcileStripe } from '@/lib/server/reconciliation'
import { isStripeConfigured } from '@/lib/server/stripe'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/reconciliation?days=7 — card payments in Stripe compared
 * with the orders (lib/server/reconciliation.ts). Admin only; read-only on
 * both sides. Order numbers, payment ids and amounts — no customer details.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  if (!isStripeConfigured()) return NextResponse.json({ error: 'Stripe не настроен' }, { status: 503 })

  const days = Number(request.nextUrl.searchParams.get('days') ?? 7)
  try {
    return NextResponse.json(await reconcileStripe(days), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[reconciliation]', (e as Error).message)
    return NextResponse.json({ error: 'Сверка не удалась' }, { status: 502 })
  }
}
