import { NextResponse, type NextRequest } from 'next/server'
import { enforceLimit } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Content-Security-Policy violation reports (next.config.js → `report-uri` /
 * `report-to`).
 *
 * Browsers post these on their own whenever the policy blocks something: an
 * injected script, a third-party tag nobody listed, an extension. They are the
 * only way to know the policy is doing its job — or is about to break a
 * checkout after a vendor changes a hostname — so they are logged, compactly,
 * where the rest of the server logs already go.
 *
 * Two formats arrive: the legacy `application/csp-report` body
 * ({ "csp-report": {...} }) and the Reporting API's `application/reports+json`
 * array ([{ type: "csp-violation", body: {...} }]). Anything else is ignored.
 * Always answers 204: a reporting endpoint that errors gets retried.
 */
const MAX_BODY_BYTES = 16 * 1024

type Violation = {
  documentURL?: string
  'document-uri'?: string
  effectiveDirective?: string
  'effective-directive'?: string
  'violated-directive'?: string
  blockedURL?: string
  'blocked-uri'?: string
  sourceFile?: string
  'source-file'?: string
  lineNumber?: number
  'line-number'?: number
}

function clip(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function summarise(v: Violation) {
  return {
    page: clip(v.documentURL ?? v['document-uri']),
    directive: clip(v.effectiveDirective ?? v['effective-directive'] ?? v['violated-directive'], 80),
    blocked: clip(v.blockedURL ?? v['blocked-uri']),
    source: clip(v.sourceFile ?? v['source-file']),
    line: Number(v.lineNumber ?? v['line-number']) || undefined,
  }
}

export async function POST(request: NextRequest) {
  const limited = await enforceLimit('csp.report', request)
  if (limited) return new NextResponse(null, { status: 204 })

  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 })

  try {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 })
    const payload: unknown = JSON.parse(text)

    const violations: Violation[] = Array.isArray(payload)
      ? payload
          .filter((r) => r && typeof r === 'object' && (r as { type?: string }).type === 'csp-violation')
          .map((r) => (r as { body?: Violation }).body ?? {})
      : payload && typeof payload === 'object' && 'csp-report' in payload
        ? [(payload as { 'csp-report': Violation })['csp-report']]
        : []

    for (const v of violations.slice(0, 10)) {
      console.warn('[csp] violation', JSON.stringify(summarise(v)))
    }
  } catch {
    // Malformed report: nothing to log.
  }
  return new NextResponse(null, { status: 204 })
}
