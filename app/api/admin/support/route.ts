import { NextResponse } from 'next/server'
import { readTickets } from '@/lib/server/support-store'

export const dynamic = 'force-dynamic'

// Auth is already enforced by middleware.ts for every /api/admin/* path.
export async function GET() {
  const tickets = (await readTickets()).sort((a, b) => b.createdAt - a.createdAt)
  return NextResponse.json({ tickets })
}
