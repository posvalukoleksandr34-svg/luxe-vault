import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { sendCrashReport, scrubUrl } from '@/lib/monitoring/alert'
import { readJsonObject } from '@/lib/server/http'
import { enforceLimit } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Where the browser's crash reports arrive.
 *
 * PUBLIC BY NECESSITY, AND THEREFORE BOUNDED. An error boundary runs in a
 * browser with no session — a crash in the root layout means the store never
 * mounted — so this cannot require authentication. What it can do is refuse to
 * be useful to anyone but a crashing page:
 *
 *   * rate limited per client (10 in 10 minutes), because a route that relays
 *     text into the operators' chat is otherwise a spam pipe with a megaphone
 *   * every field bounded by the schema, so one report cannot be a payload
 *   * the URL scrubbed of query values before it is sent anywhere, since a
 *     crash on an order page would otherwise carry that order's lookup token
 *     into a chat that may be forwarded
 *   * `reportCriticalError` dedupes per message for ten minutes underneath, so
 *     a thousand visitors hitting one broken page produce one alert
 *
 * It always answers 204. A monitoring endpoint that returns an error teaches
 * a crashing page to retry, and there is nothing the browser could do with
 * the answer anyway.
 */

const reportSchema = z.object({
  context: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(2000).optional(),
  digest: z.string().max(120).optional(),
  url: z.string().max(2000).optional(),
  timestamp: z.string().max(40).optional(),
})

export async function POST(request: NextRequest) {
  const limited = await enforceLimit('monitoring.report', request)
  if (limited) {
    // Swallowed: see the note above on always answering 204. The limiter has
    // already done its job by not calling the sink.
    return new NextResponse(null, { status: 204 })
  }

  const body = await readJsonObject<Record<string, unknown>>(request)
  const parsed = reportSchema.safeParse(body ?? {})
  if (!parsed.success) return new NextResponse(null, { status: 204 })

  const report = parsed.data

  // Never awaited in a way that can reject: sendCrashReport resolves either
  // way, and a failure to alert must not become a 500 in the logs of a route
  // whose entire purpose is to record failures.
  try {
    await sendCrashReport({
      context: `Client · ${report.context}`,
      message: report.message,
      stack: report.stack,
      url: scrubUrl(report.url),
      digest: report.digest,
      timestamp: report.timestamp ?? new Date().toISOString(),
    })
  } catch (error) {
    console.warn('[crash] report route failed:', (error as Error).message)
  }

  return new NextResponse(null, { status: 204 })
}
