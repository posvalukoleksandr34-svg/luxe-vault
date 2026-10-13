import { NextResponse, type NextRequest } from 'next/server'
import { readJsonObjectLimited } from '@/lib/server/http'
import { assistantEvent } from '@/lib/server/assistant/metrics'
import { enforceLimit } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

const OUTCOMES = ['answered', 'handoff', 'products'] as const

/**
 * "Was this helpful?" under a concierge answer.
 *
 *   POST { turnId, rating: 'helpful' | 'not_helpful', outcome? } → 204
 *
 * Recorded as one assistant_event line (lib/server/assistant/metrics.ts):
 * the rating and what kind of answer it was — never the question, the answer,
 * the turn id, an IP or anything that identifies the customer. The turn id is
 * only checked for shape, so a random string cannot be used to write
 * arbitrary text into the log.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('support.feedback', request)
  if (limited) return limited
  const body = await readJsonObjectLimited<{ turnId?: unknown; rating?: unknown; outcome?: unknown }>(request, 1024)
  if (body === 'too_large' || !body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const okTurn = typeof body.turnId === 'string' && /^[0-9a-f-]{36}$/i.test(body.turnId)
  const rating = body.rating === 'helpful' || body.rating === 'not_helpful' ? body.rating : null
  if (!okTurn || !rating) return NextResponse.json({ error: 'Invalid feedback' }, { status: 400 })
  const outcome = OUTCOMES.indexOf(body.outcome as (typeof OUTCOMES)[number]) !== -1 ? (body.outcome as string) : undefined
  assistantEvent({ event: 'feedback', rating, ...(outcome ? { outcome } : {}) })
  return new NextResponse(null, { status: 204 })
}
