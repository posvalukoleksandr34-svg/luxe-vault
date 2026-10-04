import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

const SECRET = 'unit-test-ipn-secret'
let np: typeof import('@/lib/server/nowpayments')

function sign(canonical: string): string {
  return createHmac('sha512', SECRET).update(canonical).digest('hex')
}

const order = { id: 'LV-1001', total: 250, paymentId: '5550001', paymentCurrency: 'btc' }
const payment = {
  payment_id: 5550001,
  payment_status: 'finished',
  order_id: 'LV-1001',
  price_amount: 250,
  price_currency: 'chf',
  pay_amount: 0.004,
  pay_currency: 'btc',
  actually_paid: 0.004,
}

describe('NOWPayments', () => {
  before(async () => {
    // Read at module scope, so set before the import.
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET
    process.env.NOWPAYMENTS_API_KEY = 'unit-test-key'
    np = await import('@/lib/server/nowpayments')
  })

  describe('verifyIpnSignature', () => {
    it('accepts the documented key-sorted HMAC-SHA512', async () => {
      const body = { payment_status: 'finished', payment_id: 1, order_id: 'LV-1' }
      const sig = sign(JSON.stringify({ order_id: 'LV-1', payment_id: 1, payment_status: 'finished' }))
      assert.equal(await np.verifyIpnSignature(body, sig), true)
    })

    it('rejects a missing, wrong or tampered signature', async () => {
      const body = { payment_id: 1, payment_status: 'finished' }
      const good = sign(JSON.stringify(body))
      assert.equal(await np.verifyIpnSignature(body, null), false)
      assert.equal(await np.verifyIpnSignature(body, ''), false)
      assert.equal(await np.verifyIpnSignature(body, good.slice(0, -1)), false)
      assert.equal(await np.verifyIpnSignature({ ...body, payment_status: 'failed' }, good), false)
      assert.equal(await np.verifyIpnSignature(body, createHmac('sha512', 'other').update(JSON.stringify(body)).digest('hex')), false)
    })

    it('does not drop a "__proto__" key from the signed canonical form', async () => {
      const body = JSON.parse('{"payment_id":1,"__proto__":{"payment_status":"finished"}}')
      const withoutKey = sign(JSON.stringify({ payment_id: 1 }))
      assert.equal(await np.verifyIpnSignature(body, withoutKey), false)
      const withKey = sign('{"__proto__":{"payment_status":"finished"},"payment_id":1}')
      assert.equal(await np.verifyIpnSignature(body, withKey), true)
      assert.equal(({} as Record<string, unknown>).payment_status, undefined, 'Object.prototype untouched')
    })
  })

  describe('cryptoPaymentMismatch', () => {
    it('accepts the payment created for this order', () => {
      assert.equal(np.cryptoPaymentMismatch(order, payment), null)
    })

    it('refuses another order, amount, currency, coin or payment id', () => {
      assert.match(np.cryptoPaymentMismatch(order, { ...payment, order_id: 'LV-9999' }) ?? '', /order/)
      assert.match(np.cryptoPaymentMismatch(order, { ...payment, order_id: null }) ?? '', /order/)
      assert.match(np.cryptoPaymentMismatch(order, { ...payment, price_amount: 1 }) ?? '', /priced at/)
      assert.match(np.cryptoPaymentMismatch(order, { ...payment, price_currency: 'usd' }) ?? '', /priced in/)
      assert.match(np.cryptoPaymentMismatch(order, { ...payment, pay_currency: 'doge' }) ?? '', /paid in/)
      assert.match(np.cryptoPaymentMismatch(order, { ...payment, payment_id: 5550002 }) ?? '', /payment id/)
      assert.match(np.cryptoPaymentMismatch({ ...order, paymentId: null }, payment) ?? '', /payment id/)
      assert.match(np.cryptoPaymentMismatch(order, { ...payment, price_amount: Number.NaN }) ?? '', /priced at/)
    })
  })

  describe('cryptoFullyPaid', () => {
    it('needs what arrived to cover the quote, within rounding', () => {
      assert.equal(np.cryptoFullyPaid(payment), true)
      assert.equal(np.cryptoFullyPaid({ ...payment, actually_paid: 0.00399 }), true)
      assert.equal(np.cryptoFullyPaid({ ...payment, actually_paid: 0.002 }), false)
      assert.equal(np.cryptoFullyPaid({ ...payment, actually_paid: null }), false)
      assert.equal(np.cryptoFullyPaid({ ...payment, pay_amount: 0, actually_paid: 0 }), false)
    })
  })

  describe('toPaymentStatus', () => {
    it('maps only confirmed/finished to paid and a refund to refunded', () => {
      assert.equal(np.toPaymentStatus('finished'), 'paid')
      assert.equal(np.toPaymentStatus('confirmed'), 'paid')
      assert.equal(np.toPaymentStatus('partially_paid'), 'confirming')
      assert.equal(np.toPaymentStatus('refunded'), 'refunded')
      assert.equal(np.toPaymentStatus('anything-else'), 'pending_payment')
    })
  })

  it('getPayment refuses a malformed id without calling out', async () => {
    const result = await np.getPayment('1/../../account')
    assert.equal(result.ok, false)
  })
})
