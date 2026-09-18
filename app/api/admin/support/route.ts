import { NextResponse, type NextRequest } from 'next/server'
import { countByStatus, listForAdmin } from '@/lib/server/support-store'
import {
  SUPPORT_CATEGORIES,
  SUPPORT_TICKET_STATUSES,
  type SupportCategory,
  type SupportTicketStatus,
} from '@/lib/types'
import { requireAdmin } from '@/lib/server/admin-guard'

export const dynamic = 'force-dynamic'

// Auth is already enforced by middleware.ts for every /api/admin/* path.

/** The ticket queue: ?status=&category=&q= (number, email, name, subject). */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const sp = request.nextUrl.searchParams
  const status = sp.get('status') ?? ''
  const cat = sp.get('category') ?? ''
  try {
    const [tickets, counts] = await Promise.all([
      listForAdmin({
        status: (SUPPORT_TICKET_STATUSES as string[]).indexOf(status) !== -1 ? (status as SupportTicketStatus) : undefined,
        category: (SUPPORT_CATEGORIES as string[]).indexOf(cat) !== -1 ? (cat as SupportCategory) : undefined,
        q: sp.get('q')?.slice(0, 80) ?? undefined,
      }),
      countByStatus(),
    ])
    return NextResponse.json({ tickets, counts }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to read tickets'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
