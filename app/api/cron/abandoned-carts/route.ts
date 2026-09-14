import { NextResponse, type NextRequest } from 'next/server'
import { claimDueCarts } from '@/lib/server/abandoned-carts'
import { readCatalog } from '@/lib/server/catalog-store'
import { sendAbandonedCartEmail } from '@/lib/server/emails/abandoned-cart'
import { emailLang } from '@/lib/server/emails/copy'
import { isMailConfigured } from '@/lib/server/resend'
import type { CartItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * The abandoned-cart reminder run: every cart left untouched for more than two
 * hours after its owner typed an email at checkout gets ONE reminder.
 *
 * Scheduled hourly in vercel.json. Authenticated like /api/cron/sweep — a
 * shared secret in the Authorization header, which Vercel Cron sends by itself
 * when CRON_SECRET is set — and failing closed without it: an open version
 * would be a button anyone could press to mail customers.
 *
 * The claim (claim_abandoned_carts, migration 0029) stamps each cart before
 * any email goes out, so overlapping runs divide the work rather than
 * duplicating it, and a failed send is not retried — one missed reminder
 * costs far less than a repeated one.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://luxe-vault.store/api/cron/abandoned-carts
 */
async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — abandoned-cart reminders are disabled.')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Claiming stamps the carts; with no way to send, that would spend their
  // one reminder on nothing.
  if (!isMailConfigured) return NextResponse.json({ skipped: 'mail not configured' })

  let claimed
  try {
    claimed = await claimDueCarts(100)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }
  if (claimed.length === 0) return NextResponse.json({ claimed: 0, sent: 0, skipped: 0 })

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

  return NextResponse.json({ claimed: claimed.length, sent, skipped })
}

/** Vercel Cron issues a GET; see /api/cron/sweep for why that is fine here. */
export const GET = run
export const POST = run
