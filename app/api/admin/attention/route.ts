import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/admin-guard'
import { loadAttention } from '@/lib/server/admin-attention'

export const dynamic = 'force-dynamic'

/** What needs attention, for the dashboard and the navigation (lib/admin-attention.ts). */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  return NextResponse.json(await loadAttention(), { headers: { 'Cache-Control': 'no-store' } })
}
