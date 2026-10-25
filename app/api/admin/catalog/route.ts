import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readCatalog } from '@/lib/server/catalog-store'
import { getShippingSettings } from '@/lib/server/store-settings'

export const dynamic = 'force-dynamic'

/**
 * The console's catalogue: every product — drafts and withdrawn pieces
 * included — with its listing state and the owner's rights record.
 *
 * Separate from /api/catalog, which is public, cached at the edge and carries
 * published products only. Never cached: it holds supplier references.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const [catalog, shipping] = await Promise.all([readCatalog({ scope: 'admin' }), getShippingSettings()])
    return NextResponse.json({ ...catalog, shipping }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[admin/catalog] read failed:', e)
    return NextResponse.json({ error: 'Could not load catalogue' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
