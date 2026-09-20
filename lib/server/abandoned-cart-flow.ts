import 'server-only'

import { translate } from '@/lib/i18n'
import { captureAbandonedCart, claimDueCarts } from '@/lib/server/abandoned-carts'
import { readCatalog } from '@/lib/server/catalog-store'
import { sendAbandonedCartEmail } from '@/lib/server/emails/abandoned-cart'
import { emailLang } from '@/lib/server/emails/copy'
import { isMailConfigured } from '@/lib/server/resend'
import type { CartItem } from '@/lib/types'
import { isValidEmail } from '@/lib/validation'

/**
 * The abandoned-cart flow end to end, in one place:
 *
 *   captureCheckoutCart()       an unfinished checkout is logged — from the
 *                               checkout's server action (actions/abandoned-cart.ts)
 *                               or the legacy route (app/api/abandoned-carts);
 *   runAbandonedCartReminders() carts idle past the configured delay get ONE
 *                               recovery email via Resend — from the hourly
 *                               cron route and, as a safety net, the nightly
 *                               sweep.
 *
 * The delay is ABANDONED_CART_DELAY_MINUTES (lib/server/abandoned-carts.ts,
 * default 120).
 */

const MAX_ITEMS = 20
const MAX_QTY = 20

export type CaptureOutcome = 'captured' | 'ignored' | 'invalid_email'

/**
 * Validates and stores a checkout's cart for a later reminder.
 *
 * The reminder is an email from this domain to whatever address arrives here,
 * so nothing a caller sends reaches it verbatim: every line must be a real
 * catalogue product in one of its real sizes and colours, and is re-priced and
 * re-named from the catalogue. Never throws.
 */
export async function captureCheckoutCart(input: {
  email?: unknown
  items?: unknown
  locale?: unknown
}): Promise<CaptureOutcome> {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (email.length > 254 || !isValidEmail(email)) return 'invalid_email'

  const raw = Array.isArray(input.items) ? input.items.slice(0, MAX_ITEMS) : []
  if (raw.length === 0) return 'ignored'

  try {
    const { products } = await readCatalog()
    const byId = new Map(products.map((p) => [p.id, p]))
    // The email's own language, so the pieces in it are named the way the
    // customer saw them on the site rather than in the catalogue's source.
    const lang = emailLang(input.locale)
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
        name: translate(product.name, lang) || product.id,
        image: typeof line.image === 'string' && gallery.indexOf(line.image) !== -1 ? line.image : product.image,
        price: product.price,
        size,
        color,
        qty: Math.min(MAX_QTY, Math.max(1, Math.floor(Number(line.qty) || 1))),
      })
    }
    if (items.length === 0) return 'ignored'
    return (await captureAbandonedCart(email, items, lang)) ? 'captured' : 'ignored'
  } catch (e) {
    console.warn('[abandoned-carts] capture failed:', (e as Error).message)
    return 'ignored'
  }
}

export type ReminderRun = { claimed: number; sent: number; skipped: number } | { skipped: 'mail not configured' }

/**
 * Sends the due reminders. The claim (claim_abandoned_carts, migration 0029)
 * stamps each cart before any email goes out, so overlapping runs divide the
 * work rather than duplicating it, and a failed send is not retried — one
 * missed reminder costs far less than a repeated one. Throws when the claim
 * itself fails; the caller reports it.
 */
export async function runAbandonedCartReminders(limit = 100): Promise<ReminderRun> {
  // Claiming stamps the carts; with no way to send, that would spend their
  // one reminder on nothing.
  if (!isMailConfigured) return { skipped: 'mail not configured' }

  const claimed = await claimDueCarts(limit)
  if (claimed.length === 0) return { claimed: 0, sent: 0, skipped: 0 }

  // One catalogue read for the batch. Each reminder shows today's price and
  // the name in the customer's language, and leaves out anything since
  // removed from the shop.
  const { products } = await readCatalog()
  const byId = new Map(products.map((p) => [p.id, p]))

  let sent = 0
  let skipped = 0
  for (const cart of claimed) {
    const lang = emailLang(cart.locale)
    const items: CartItem[] = []
    for (const item of cart.cart_items ?? []) {
      const product = byId.get(item.productId)
      if (!product) continue
      items.push({ ...item, price: product.price, name: product.name[lang] || product.name.ru || item.name })
    }
    if (items.length === 0) {
      skipped++
      continue
    }
    if (await sendAbandonedCartEmail(cart, items, lang)) sent++
  }
  return { claimed: claimed.length, sent, skipped }
}
