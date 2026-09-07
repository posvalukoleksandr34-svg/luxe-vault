// Server-side construction and validation of orders. Every order — whether
// it is paid immediately or left for later — is created through here, so the
// id, the lookup token and the payment status can never be dictated by the
// browser.
import { PAYMENT_METHODS, SEED_PROMOS, requiresPrepayment } from '@/lib/data'
import { quoteDeliveryWindow, type ShippingType } from '@/lib/fulfilment'
import { readCatalog } from '@/lib/server/catalog-store'
import { composeAddress, isValidEmail, isValidName, isValidPhone, validateAddress } from '@/lib/validation'
import type { CartItem, Order } from '@/lib/types'

export type OrderDraftBody = {
  customer?: {
    name?: string
    phone?: string
    email?: string
    street?: string
    postalCode?: string
    city?: string
    country?: string
    /** Accepted for backwards compatibility with any older client that still
     * sends a single-line address. */
    address?: string
  }
  items?: CartItem[]
  subtotal?: number
  discount?: number
  total?: number
  promo?: string
  payment?: string
}

export type ValidatedDraft = {
  customer: NonNullable<Order['customer']>
  items: CartItem[]
  subtotal: number
  discount: number
  total: number
  /** What the browser claimed the total was. Compared against the recomputed
   *  figure so a mismatch can be logged; never trusted, never stored. */
  claimedTotal?: number
  promo?: string
  payment: string
}

function isValidItem(item: unknown): item is CartItem {
  if (!item || typeof item !== 'object') return false
  const i = item as CartItem
  return (
    typeof i.key === 'string' &&
    typeof i.productId === 'string' &&
    typeof i.name === 'string' &&
    typeof i.price === 'number' &&
    Number.isFinite(i.price) &&
    typeof i.qty === 'number' &&
    Number.isFinite(i.qty) &&
    i.qty > 0
  )
}

/** Mirrors the browser-side checkout rules. Returns the sanitised draft, or
 * the reason it was rejected. */
export function validateOrderDraft(
  body: OrderDraftBody,
): { ok: true; draft: ValidatedDraft } | { ok: false; error: string } {
  const c = body.customer
  if (!c) return { ok: false, error: 'Missing customer' }

  const name = (c.name ?? '').trim()
  const phone = (c.phone ?? '').trim()
  const email = (c.email ?? '').trim()

  if (!isValidName(name)) return { ok: false, error: 'Invalid name' }
  if (!isValidPhone(phone)) return { ok: false, error: 'Invalid phone number' }
  if (!isValidEmail(email)) return { ok: false, error: 'Invalid email address' }

  // Structured address when the client sends one; otherwise fall back to the
  // legacy single-line field, which still has to be non-trivial.
  const hasStructured = Boolean(c.street || c.postalCode || c.city)
  let address: string
  let street: string | undefined
  let postalCode: string | undefined
  let city: string | undefined
  let country: string | undefined

  if (hasStructured) {
    const parts = {
      street: (c.street ?? '').trim(),
      postalCode: (c.postalCode ?? '').trim(),
      city: (c.city ?? '').trim(),
      country: (c.country ?? '').trim() || undefined,
    }
    if (validateAddress(parts).length > 0) {
      return { ok: false, error: 'Invalid address' }
    }
    street = parts.street
    postalCode = parts.postalCode
    city = parts.city
    country = parts.country
    address = composeAddress(parts)
  } else {
    address = (c.address ?? '').trim()
    if (address.length < 10) return { ok: false, error: 'Invalid address' }
  }

  const items = Array.isArray(body.items) ? body.items.filter(isValidItem) : []
  if (items.length === 0) return { ok: false, error: 'Empty cart' }

  // NOTE: prices are NOT taken from the body. See repriceItems() in the caller
  // — every figure below is recomputed from the catalogue. The client's
  // subtotal/discount/total are read only to detect a mismatch worth logging.
  const claimedTotal = Number(body.total)

  const payment = (body.payment ?? '').trim()
  if (!payment) return { ok: false, error: 'Missing payment method' }
  // Allow-list, not just a presence check. Hiding "cash on delivery" in the UI
  // does not stop anyone POSTing it here, and an unrecognised method would
  // otherwise be stored verbatim on an order nobody can collect money for.
  if (!PAYMENT_METHODS.includes(payment)) {
    return { ok: false, error: 'Unsupported payment method' }
  }

  return {
    ok: true,
    draft: {
      customer: { name, phone, email, address, street, postalCode, city, country },
      items,
      // Placeholders. The caller replaces all three with catalogue-derived
      // figures before the order is built; they are never persisted as-is.
      subtotal: 0,
      discount: 0,
      total: 0,
      claimedTotal: Number.isFinite(claimedTotal) ? claimedTotal : undefined,
      promo: typeof body.promo === 'string' ? body.promo.trim().toUpperCase() : undefined,
      payment,
    },
  }
}

function randomId(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export function generateOrderId(): string {
  return `LV-${randomId(6)}`
}

export function generateLookupToken(): string {
  return `${randomId(16)}${randomId(16)}`
}

/**
 * Builds the stored order. Anything that has to be paid up front starts life
 * as `pending_payment` — the order is kept either way, so an abandoned
 * checkout becomes an unpaid order the customer can settle later rather than
 * vanishing.
 */
export function buildOrder(
  draft: ValidatedDraft,
  userId?: string,
  shippingType: ShippingType = 'standard',
): Order {
  const createdAt = Date.now()
  // Stamped here, once. Everything downstream reads the stored dates.
  const quote = quoteDeliveryWindow(createdAt, shippingType)

  return {
    id: generateOrderId(),
    userId,
    createdAt,
    shippingType,
    deliveryEstimateMin: quote.min.getTime(),
    deliveryEstimateMax: quote.max.getTime(),
    customer: draft.customer,
    items: draft.items,
    subtotal: draft.subtotal,
    discount: draft.discount,
    total: draft.total,
    promo: draft.promo,
    payment: draft.payment,
    status: 'pending',
    lookupToken: generateLookupToken(),
    paymentStatus: requiresPrepayment(draft.payment) ? 'pending_payment' : undefined,
  }
}


/**
 * Recomputes every monetary figure from the catalogue.
 *
 * THIS IS THE TRUST BOUNDARY. Before it existed the route accepted `price`,
 * `subtotal`, `discount` and `total` straight from the request body and only
 * checked they were finite numbers — so a crafted POST could buy a CHF 900
 * basket for CHF 0.05. Nothing downstream caught it: the Stripe intent route
 * faithfully rebuilds its amount from the *stored* order, and the stored order
 * was whatever the client said.
 *
 * Every price now comes from `products.price`. An item whose productId is not
 * in the catalogue is rejected outright rather than silently priced at zero.
 */
export async function repriceItems(
  draft: ValidatedDraft,
): Promise<{ ok: true; draft: ValidatedDraft } | { ok: false; error: string }> {
  const { products } = await readCatalog()
  const byId = new Map(products.map((p) => [p.id, p]))

  const priced: CartItem[] = []
  for (const item of draft.items) {
    const product = byId.get(item.productId)
    // Unknown product: refuse. Accepting it would let anyone invent a line.
    if (!product) return { ok: false, error: `Unknown product: ${item.productId}` }

    const qty = Math.max(1, Math.min(Math.trunc(item.qty), 20))
    priced.push({
      ...item,
      qty,
      // The only source of truth for money.
      price: product.price,
      // Names are shown on receipts and in the admin; take the catalogue's.
      name: typeof product.name === 'object' ? (product.name.ru ?? item.name) : item.name,
    })
  }

  const subtotal = round2(priced.reduce((sum, i) => sum + i.price * i.qty, 0))

  // Promo codes are re-checked here too — a client could otherwise send any
  // code string and have the discount it claimed applied.
  const promo = draft.promo
    ? SEED_PROMOS.find((p) => p.active && p.code === draft.promo)
    : undefined
  const discount = promo ? round2((subtotal * promo.percent) / 100) : 0
  const total = round2(subtotal - discount)

  if (total <= 0) return { ok: false, error: 'Invalid totals' }

  if (draft.claimedTotal !== undefined && Math.abs(draft.claimedTotal - total) > 0.01) {
    // Usually a stale cart or a race with a price edit; occasionally an
    // attempt. Either way the server's figure wins — this is only a signal.
    console.warn(
      `[orders] total mismatch: client claimed ${draft.claimedTotal}, server computed ${total}`,
    )
  }

  return {
    ok: true,
    draft: { ...draft, items: priced, subtotal, discount, total, promo: promo?.code },
  }
}

/** Money is stored as numeric(12,2); float drift must not reach the column. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
