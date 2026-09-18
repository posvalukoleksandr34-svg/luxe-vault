import { NextResponse, type NextRequest } from 'next/server'
import { getOrderById, setOrderPaymentSession } from '@/lib/server/orders-store'
import { enforceLimit } from '@/lib/server/rate-limit'
import { isStripeConfigured, preparePaymentIntent } from '@/lib/server/stripe'
import { resolveStripeCustomerId } from '@/lib/server/stripe-customer'
import { getCurrentUser } from '@/lib/supabase/server'
import { safeEqual } from '@/lib/server/secure-compare'
import { readJsonObject } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/**
 * Prices an existing order's PaymentIntent in the customer's currency and
 * returns its client secret, so the browser can render an embedded
 * PaymentElement.
 *
 * Replaces the previous /checkout route, which minted a hosted Checkout
 * Session and returned a redirect URL.
 *
 * The guarantees are the same ones the old route had, and they matter more
 * here because the client secret is returned to the browser:
 *
 *  - The amount is rebuilt from the STORED order. Nothing about the price
 *    comes from the request body.
 *  - Access is gated on the order's lookup token — the per-order secret the
 *    customer's own browser holds.
 *  - "Order not found" covers both a missing order and a bad token, so the
 *    endpoint cannot be used to enumerate order ids.
 *
 * And two that multi-currency adds:
 *
 *  - The CURRENCY is the one thing the browser chooses — a code, never a
 *    figure. The amount in it is the server's own conversion of the stored
 *    CHF total. A code the account does not take is charged in CHF, and the
 *    response says so (`fellBack`) for the payment step to tell the customer.
 *  - One intent per order. Asking again — after switching currency, or on
 *    coming back to pay — re-prices the order's existing intent rather than
 *    minting another, so an earlier, differently priced one cannot be paid on
 *    the side and then fail to match the order. See preparePaymentIntent.
 *
 * A client secret authorises confirming this one payment and reading its
 * status. It is not a credential for the Stripe account, and it is useless
 * without the publishable key it was minted against — but it is still
 * per-order, which is why the token check above is not optional.
 */
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Оплата картой временно недоступна' }, { status: 503 })
  }

  const limited = await enforceLimit('payment.start', request)
  if (limited) return limited

  const body = await readJsonObject<{ orderId?: string; token?: string; saveCard?: boolean; currency?: string }>(request)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { orderId, token } = body
  if (typeof orderId !== 'string' || typeof token !== 'string' || !orderId || !token) {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 })
  }

  const order = await getOrderById(orderId)
  if (!order || !safeEqual(order.lookupToken, token)) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  if (order.paymentStatus === 'paid') {
    return NextResponse.json({ error: 'Заказ уже оплачен' }, { status: 409 })
  }
  // A cancelled or refunded order has given its units back to stock; taking
  // money for it now could sell something another customer already bought.
  if (order.status === 'cancelled' || order.status === 'refunded') {
    return NextResponse.json(
      { error: 'Заказ отменён, и его товары вернулись в продажу. Оформите, пожалуйста, новый заказ.' },
      { status: 409 },
    )
  }

  try {
    // The Stripe Customer that owns saved cards. Resolved from the SESSION,
    // never from the request body — a client-supplied customer id would let
    // anyone attach their payment to, or read cards from, another account.
    let customerId: string | undefined
    const user = await getCurrentUser()
    if (user && order.userId && order.userId === user.id) {
      try {
        customerId = await resolveStripeCustomerId({
          id: user.id,
          email: user.email ?? order.customer.email,
          name: order.customer.name,
        })
      } catch {
        // Saved cards are a convenience; the payment must still work without.
        customerId = undefined
      }
    }

    const prepared = await preparePaymentIntent(order, {
      customerId,
      saveCard: Boolean(body.saveCard) && Boolean(customerId),
      currency: body.currency,
    })

    if (!prepared.ok) {
      // Stripe already holds, or is settling, money for this order.
      return NextResponse.json({ error: 'Заказ уже оплачен' }, { status: 409 })
    }

    const { intent } = prepared
    if (!intent.client_secret) {
      return NextResponse.json({ error: 'Stripe returned no client secret' }, { status: 502 })
    }

    // Store the PaymentIntent id against the order BEFORE the browser can
    // confirm it. The webhook finds the order by payment_id, so a fast
    // confirmation must not arrive before the order knows its own intent id.
    await setOrderPaymentSession(order.id, {
      payment: order.payment,
      paymentStatus: 'pending_payment',
      paymentProvider: 'stripe',
      paymentId: intent.id,
      // What the card will be charged: the currency and the converted amount,
      // in major units. orders.total stays the CHF price, so the rate a
      // refund must use is recoverable as payment_amount / total.
      paymentCurrency: prepared.currency,
      paymentAmount: prepared.amount,
      paymentAddress: undefined,
    })

    return NextResponse.json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      currency: prepared.currency,
      amount: prepared.amount,
      rate: prepared.rate,
      fellBack: prepared.fellBack,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stripe error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
