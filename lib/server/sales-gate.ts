import 'server-only'

import { NextResponse } from 'next/server'
import { missingBusinessFields } from '@/config/business'
import { SALES_CLOSED_CODE, evaluateSalesGate, type SalesGate } from '@/lib/sales-gate'

/** The launch gate for this process (lib/sales-gate.ts explains it). */
export function salesGate(): SalesGate {
  return evaluateSalesGate(
    { NODE_ENV: process.env.NODE_ENV, SALES_ENABLED: process.env.SALES_ENABLED },
    missingBusinessFields(),
  )
}

let warned = false

/**
 * The answer for a route that would take a new order or payment while the
 * shop is closed, or null when it is open. 503 with a stable code: the
 * checkout shows its own "orders are not being taken yet" text. The reasons
 * go to the server log (once per instance), never to the customer.
 */
export function salesClosedResponse(route: string): NextResponse | null {
  const gate = salesGate()
  if (gate.open) return null
  if (!warned) {
    warned = true
    console.warn(
      `[sales-gate] new orders and payments are refused (${gate.blockers.join(', ')}) — first refusal at ${route}. ` +
        'Open the shop only after the launch checklist: SALES_ENABLED=true and the seller identity (config/business.ts).',
    )
  }
  return NextResponse.json(
    { error: 'The shop is not taking orders at the moment', code: SALES_CLOSED_CODE },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
