// Server-side construction and validation of orders. Every order — whether
// it is paid immediately or left for later — is created through here, so the
// id, the lookup token and the payment status can never be dictated by the
// browser.
import { requiresPrepayment } from '@/lib/data'
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

  const subtotal = Number(body.subtotal)
  const total = Number(body.total)
  const discount = Number(body.discount) || 0
  if (!Number.isFinite(subtotal) || !Number.isFinite(total) || total <= 0) {
    return { ok: false, error: 'Invalid totals' }
  }

  const payment = (body.payment ?? '').trim()
  if (!payment) return { ok: false, error: 'Missing payment method' }

  return {
    ok: true,
    draft: {
      customer: { name, phone, email, address, street, postalCode, city, country },
      items,
      subtotal,
      discount,
      total,
      promo: typeof body.promo === 'string' ? body.promo : undefined,
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
export function buildOrder(draft: ValidatedDraft): Order {
  return {
    id: generateOrderId(),
    createdAt: Date.now(),
    customer: draft.customer,
    items: draft.items,
    subtotal: draft.subtotal,
    discount: draft.discount,
    total: draft.total,
    promo: draft.promo,
    payment: draft.payment,
    status: 'В обработке',
    lookupToken: generateLookupToken(),
    paymentStatus: requiresPrepayment(draft.payment) ? 'pending_payment' : undefined,
  }
}
