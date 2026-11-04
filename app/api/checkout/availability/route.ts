import { NextResponse } from 'next/server'
import { isCheckoutReady as isCryptoReady } from '@/lib/server/nowpayments'
import { salesGate } from '@/lib/server/sales-gate'
import { isStripeConfigured, isStripeWebhookConfigured } from '@/lib/server/stripe'

export const dynamic = 'force-dynamic'

/**
 * GET /api/checkout/availability — what the checkout may offer right now.
 *
 *   { salesOpen, card, crypto }
 *
 * salesOpen: whether new orders are taken (lib/sales-gate.ts). card / crypto:
 * whether each provider can take AND confirm a payment. Booleans only — the
 * reasons a gate is closed are for the owner's console, not for visitors.
 *
 * The routes that place orders and start payments check the same things
 * themselves; this only lets the checkout say so before a customer fills in
 * an address, and hide a method that would fail.
 */
export async function GET() {
  return NextResponse.json(
    { salesOpen: salesGate().open, card: isStripeConfigured() && isStripeWebhookConfigured(), crypto: isCryptoReady() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
