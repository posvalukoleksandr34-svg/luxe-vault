import { NextResponse, type NextRequest } from 'next/server'
import { getOrderById, setOrderPaymentSession } from '@/lib/server/orders-store'
import { enforceLimit } from '@/lib/server/rate-limit'
import { findResolvedOption, resolveAvailableOptions } from '@/lib/server/crypto-options'
import { createPayment, fetchAvailableTickers, isConfigured } from '@/lib/server/nowpayments'
import { safeEqual } from '@/lib/server/secure-compare'
import { readJsonObject } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/**
 * "Pay now" for an order that was placed but never paid. Opens a brand-new
 * gateway session against the *existing* order id — the cart is never
 * rebuilt and the totals are taken from the stored order, so the amount
 * can't be tampered with from the browser.
 *
 * Access is gated on the order's lookup token, the same secret the customer's
 * own browser stored when the order was placed.
 *
 * Every refusal carries a stable `code`. The browser shows its OWN message for
 * each, in the customer's language; `error` is for logs only. It used to be
 * shown verbatim — Russian on an Italian page, and for a provider failure the
 * gateway's raw English error text.
 */
export async function POST(request: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'Оплата криптовалютой временно недоступна', code: 'CRYPTO_UNAVAILABLE' },
      { status: 503 },
    )
  }

  const limited = await enforceLimit('payment.start', request)
  if (limited) return limited

  const body = await readJsonObject<{ orderId?: string; token?: string; optionId?: string; ticker?: string }>(request)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, { status: 400 })
  }

  const { orderId, token, optionId, ticker } = body
  if (
    typeof orderId !== 'string' ||
    typeof token !== 'string' ||
    typeof optionId !== 'string' ||
    typeof ticker !== 'string' ||
    !orderId ||
    !token ||
    !optionId ||
    !ticker
  ) {
    return NextResponse.json({ error: 'Malformed request', code: 'BAD_REQUEST' }, { status: 400 })
  }

  const order = await getOrderById(orderId)
  if (!order || !safeEqual(order.lookupToken, token)) {
    // Same response for "no such order" and "wrong token" so the endpoint
    // can't be used to probe which order ids exist.
    return NextResponse.json({ error: 'Order not found', code: 'NOT_FOUND' }, { status: 404 })
  }
  if (order.paymentStatus === 'paid') {
    return NextResponse.json({ error: 'Заказ уже оплачен', code: 'ALREADY_PAID' }, { status: 409 })
  }
  if (order.status === 'cancelled') {
    return NextResponse.json({ error: 'Заказ отменён', code: 'CANCELLED' }, { status: 409 })
  }

  const tickers = await fetchAvailableTickers()
  const option = findResolvedOption(resolveAvailableOptions(tickers), optionId, ticker)
  if (!option) {
    return NextResponse.json(
      { error: 'Выбранная сеть недоступна', code: 'NETWORK_UNAVAILABLE' },
      { status: 400 },
    )
  }

  const callbackUrl =
    process.env.NOWPAYMENTS_IPN_CALLBACK_URL ||
    `${request.nextUrl.origin}/api/payments/crypto/webhook`

  const payment = await createPayment({
    orderId: order.id,
    amount: order.total,
    payCurrency: option.ticker,
    description: `LUXE VAULT — заказ ${order.id}`,
    callbackUrl,
  })

  if (!payment.ok) {
    return NextResponse.json({ error: payment.error.message, code: 'PROVIDER_ERROR' }, { status: 502 })
  }
  if (!payment.data.pay_address || !payment.data.pay_amount) {
    return NextResponse.json(
      { error: 'Платёжный провайдер вернул неполные данные', code: 'PROVIDER_ERROR' },
      { status: 502 },
    )
  }

  const updated = await setOrderPaymentSession(order.id, {
    payment: `Криптовалюта — ${option.label} (${option.network})`,
    paymentStatus: 'pending_payment',
    paymentProvider: 'nowpayments',
    paymentId: payment.data.payment_id,
    paymentCurrency: option.ticker,
    paymentAddress: payment.data.pay_address,
    paymentAmount: payment.data.pay_amount,
  })

  if (!updated) {
    return NextResponse.json({ error: 'Order not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  return NextResponse.json({
    order: updated,
    expiresAt: payment.data.expiration_estimate_date ?? null,
  })
}
