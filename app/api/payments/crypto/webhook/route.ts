import { NextResponse, type NextRequest } from 'next/server'
import { isMailConfigured, sendStockConflictAlert } from '@/lib/server/mailer'
import { ensurePaidOrderStock, setPaymentStatus } from '@/lib/server/orders-store'
import { isIpnConfigured, toPaymentStatus, verifyIpnSignature } from '@/lib/server/nowpayments'
import { claimStripeEvent } from '@/lib/server/stripe-events'
import { isTelegramConfigured, notifyPaymentConfirmed, notifyStockConflict } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

type IpnPayload = {
  payment_id?: string
  payment_status?: string
  pay_amount?: number
  actually_paid?: number
  pay_currency?: string
}

// Public by necessity — NOWPayments calls this directly, with no session of
// ours to authenticate. The HMAC signature check below is the entire trust
// boundary: only a request signed with our IPN secret can ever change an
// order's payment status. This is also the ONLY place that ever marks a
// crypto order as paid — the client's status polling only ever reads what
// this handler wrote.
export async function POST(request: NextRequest) {
  if (!isIpnConfigured()) {
    return NextResponse.json({ error: 'IPN not configured' }, { status: 503 })
  }

  let payload: IpnPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const signature = request.headers.get('x-nowpayments-sig')
  const valid = await verifyIpnSignature(payload, signature)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (!payload.payment_id || !payload.payment_status) {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  const mapped = toPaymentStatus(payload.payment_status)
  const order = await setPaymentStatus(payload.payment_id, mapped)

  // Stock at payment confirmation — see the Stripe webhook: a restocked order
  // takes its units again, or support is told the payment needs a refund.
  if (order && mapped === 'paid') {
    const stock = await ensurePaidOrderStock(order.id)
    if (stock === 'insufficient') {
      console.error(`[crypto] ${order.id} was paid but its stock had been released and sold`)
      if (isMailConfigured) await sendStockConflictAlert(order)
      await notifyStockConflict(order)
    }
    // NOWPayments repeats "finished" IPNs; the ledger keeps this to one alert.
    if (
      isTelegramConfigured() &&
      (await claimStripeEvent(`telegram:paid:${order.id}`, 'telegram.paid')) !== 'duplicate'
    ) {
      const amount = Number(payload.actually_paid ?? payload.pay_amount)
      await notifyPaymentConfirmed(
        order,
        'nowpayments',
        amount > 0 && typeof payload.pay_currency === 'string'
          ? { amount, currency: payload.pay_currency.toUpperCase() }
          : undefined,
      )
    }
  }

  return NextResponse.json({ ok: true })
}
