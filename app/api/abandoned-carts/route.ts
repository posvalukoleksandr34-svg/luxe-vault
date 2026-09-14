import { NextResponse, type NextRequest } from 'next/server'
import { captureAbandonedCart } from '@/lib/server/abandoned-carts'
import { readCatalog } from '@/lib/server/catalog-store'
import { emailLang } from '@/lib/server/emails/copy'
import { enforceLimit } from '@/lib/server/rate-limit'
import { isValidEmail } from '@/lib/validation'
import type { CartItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

const MAX_ITEMS = 20
const MAX_QTY = 20

/**
 * Captures a cart for the abandoned-cart reminder, once the customer has typed
 * a valid email at checkout (components/checkout-flow.tsx).
 *
 * Public by necessity, so it is careful about what it accepts — the reminder
 * is an email from this domain to whatever address arrives here:
 *
 *  - same-origin requests only, and rate-limited per client;
 *  - every line must be a real catalogue product in one of its real sizes and
 *    colours, re-priced from the catalogue, so no free text a caller supplies
 *    can end up in an email the shop sends;
 *  - at most one reminder per address per week, and none after an opt-out
 *    (enforced where they are sent — claim_abandoned_carts, migration 0029).
 *
 * Always answers 204 with no body: the checkout never waits on this, and the
 * response says nothing about whether an address is known.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('cart.capture', request)
  if (limited) return limited

  // Same-origin: the page's Origin must name the host this request reached.
  // Compared with the Host header (X-Forwarded-Host behind Vercel's proxy)
  // rather than nextUrl, which can carry the server's own hostname instead.
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (origin) {
    let originHost = ''
    try {
      originHost = new URL(origin).host
    } catch {
      // Unparseable Origin: treated as foreign.
    }
    if (!host || originHost !== host) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  let body: { email?: unknown; items?: unknown; locale?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (email.length > 254 || !isValidEmail(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const raw = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : []
  if (raw.length === 0) return new NextResponse(null, { status: 204 })

  try {
    const { products } = await readCatalog()
    const byId = new Map(products.map((p) => [p.id, p]))
    const items: CartItem[] = []
    for (const entry of raw) {
      const line = (entry ?? {}) as Record<string, unknown>
      const product = typeof line.productId === 'string' ? byId.get(line.productId) : undefined
      if (!product) continue
      const size = typeof line.size === 'string' ? line.size : ''
      const color = typeof line.color === 'string' ? line.color : ''
      if (product.sizes.length > 0 && product.sizes.indexOf(size) === -1) continue
      if (product.colors.length > 0 && !product.colors.some((c) => c.name === color)) continue
      const gallery = [product.image, ...(product.images ?? [])]
      items.push({
        key: `${product.id}-${size}-${color}`,
        productId: product.id,
        name: product.name.ru || product.name.en || product.id,
        image: typeof line.image === 'string' && gallery.indexOf(line.image) !== -1 ? line.image : product.image,
        price: product.price,
        size,
        color,
        qty: Math.min(MAX_QTY, Math.max(1, Math.floor(Number(line.qty) || 1))),
      })
    }
    if (items.length > 0) await captureAbandonedCart(email, items, emailLang(body.locale))
  } catch (e) {
    console.warn('[abandoned-carts] capture failed:', (e as Error).message)
  }

  return new NextResponse(null, { status: 204 })
}
