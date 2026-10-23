import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/admin-guard'
import { loadDashboardMetrics } from '@/lib/server/admin-metrics'

export const dynamic = 'force-dynamic'

/** The dashboard's figures (lib/server/admin-metrics.ts). */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    return NextResponse.json(await loadDashboardMetrics())
  } catch (e) {
    console.error('[admin] dashboard metrics failed:', (e as Error).message)
    return NextResponse.json({ error: 'Не удалось посчитать показатели' }, { status: 500 })
  }
}
