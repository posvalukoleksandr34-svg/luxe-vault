import { NextResponse, type NextRequest } from 'next/server'
import { setPaymentStatus } from '@/lib/server/orders-store'
import { isIpnConfigured, toPaymentStatus, verifyIpnSignature } from '@/lib/server/nowpayments'

export const dynamic = 'force-dynamic'

type IpnPayload = {
  payment_id?: string
  payment_status?: string
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
  await setPaymentStatus(payload.payment_id, mapped)

  return NextResponse.json({ ok: true })
}
