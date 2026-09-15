import { NextResponse, type NextRequest } from 'next/server'
import { enforceLimit } from '@/lib/server/rate-limit'
import { availableFor, readVariantStock } from '@/lib/server/stock'

export const dynamic = 'force-dynamic'

/** Matches the basket's own clamp (lib/cart-storage.ts) and the order route. */
const MAX_QTY = 20
const MAX_LINES = 50

type Line = { productId: string; size: string; color: string; qty: number }

/**
 * The server's word on how many of each variant a basket may hold.
 *
 * Called on every add-to-cart and every "+" in the basket, and when the
 * basket is opened, with the quantities the customer WANTS (what is already
 * in the basket plus what they are adding). Each line comes back with the
 * units actually available and the quantity allowed, so the browser can never
 * hold more than exists — however stale its copy of the catalogue, and however
 * fast the button is pressed.
 *
 * Body:     { items: [{ productId, size, color, qty }] }
 * Response: { items: [{ productId, size, color, requested, available, qty }] }
 *           available: units in stock, or null for an untracked product
 *
 * Holding nothing is deliberate — a basket is not a reservation. Stock is
 * spent only by place_order(), atomically, when the order is created.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('cart.validate', request)
  if (limited) return limited

  let body: { items?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const lines: Line[] = []
  for (const raw of Array.isArray(body.items) ? body.items.slice(0, MAX_LINES) : []) {
    const r = (raw ?? {}) as Record<string, unknown>
    if (typeof r.productId !== 'string' || typeof r.size !== 'string' || typeof r.color !== 'string') continue
    lines.push({
      productId: r.productId.slice(0, 200),
      size: r.size.slice(0, 40),
      color: r.color.slice(0, 60),
      qty: Math.max(0, Math.floor(Number(r.qty) || 0)),
    })
  }
  if (lines.length === 0) return NextResponse.json({ items: [] })

  try {
    const snapshot = await readVariantStock(lines.map((l) => l.productId))
    const items = lines.map((l) => {
      const available = availableFor(snapshot, l.productId, l.size, l.color)
      const cap = available === null ? MAX_QTY : Math.min(MAX_QTY, available)
      return { ...l, requested: l.qty, available, qty: Math.min(l.qty, cap) }
    })
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[cart/validate] stock read failed:', e)
    // The browser falls back to its own copy of the catalogue; the order
    // route re-checks against the database either way.
    return NextResponse.json({ error: 'Stock check unavailable' }, { status: 503 })
  }
}
