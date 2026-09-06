import { NextResponse, type NextRequest } from 'next/server'
import { detachSavedCard, isStripeConfigured, listSavedCards } from '@/lib/server/stripe'
import { getStripeCustomerId } from '@/lib/server/stripe-customer'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * A user's saved cards.
 *
 * Every response here is display-only: a brand, an expiry, and the last four
 * digits. The full number is held by Stripe and is not retrievable through
 * their API by anyone, including us — so there is nothing here that could be
 * used to make a payment.
 *
 * The customer id is always derived from the authenticated session, never from
 * a query parameter, which is what stops one account listing or deleting
 * another's cards.
 */
export async function GET() {
  if (!isStripeConfigured()) return NextResponse.json({ cards: [] })

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Read-only: deliberately does NOT create a Stripe customer. Opening the
  // account page should not mint billing objects for someone who has never
  // paid by card.
  const customerId = await getStripeCustomerId(user.id)
  if (!customerId) return NextResponse.json({ cards: [] })

  try {
    return NextResponse.json({ cards: await listSavedCards(customerId) })
  } catch {
    return NextResponse.json({ cards: [] })
  }
}

export async function DELETE(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body.id) return NextResponse.json({ error: 'Missing card id' }, { status: 400 })

  const customerId = await getStripeCustomerId(user.id)
  if (!customerId) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

  // Ownership check. Detaching by id alone would let any signed-in user delete
  // any PaymentMethod whose id they could guess or observe, so the card must
  // be confirmed to belong to THIS user's customer first.
  try {
    const cards = await listSavedCards(customerId)
    if (!cards.some((c) => c.id === body.id)) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }
    await detachSavedCard(body.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to remove card' }, { status: 502 })
  }
}
