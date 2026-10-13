import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

let limits: typeof import('@/lib/server/rate-limit')

// No Supabase credentials in the test environment: createAdminClient() throws,
// which is exactly "the limiter cannot be consulted".
describe('rate limiter when it cannot be consulted', () => {
  before(async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    limits = await import('@/lib/server/rate-limit')
  })

  const request = () => new NextRequest('https://shop.test/api/x', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' } })

  it('fails CLOSED on the guessing surfaces: admin password, reset mail, order lookup, coupons, payment start, ticket read', async () => {
    for (const name of ['admin.login', 'auth.recovery', 'order.lookup', 'coupon.validate', 'payment.start', 'support.read'] as const) {
      assert.equal(limits.failsClosed(name), true, name)
      const result = await limits.checkLimit(name, 'subject')
      assert.equal(result.allowed, false, name)
      assert.equal(result.unavailable, true, name)
      const response = await limits.enforceLimit(name, request())
      assert.equal(response?.status, 503, name)
      assert.ok(Number(response?.headers.get('retry-after')) > 0, name)
    }
  })

  it('fails OPEN for browsing and checkout volume controls', async () => {
    for (const name of ['search', 'cart.validate', 'order.create', 'catalog.lookup'] as const) {
      assert.equal(limits.failsClosed(name), false, name)
      assert.equal((await limits.checkLimit(name, 'subject')).allowed, true, name)
      assert.equal(await limits.enforceLimit(name, request()), null, name)
    }
  })

  it('a signed-in account limit on a fail-closed bucket answers 503 too', async () => {
    const response = await limits.enforceUserLimit('payment.start', '00000000-0000-0000-0000-000000000000')
    assert.equal(response?.status, 503)
  })
})

describe('rate limiter: who is counted', () => {
  it('callers with no address share ONE bucket — they are throttled together, never exempt', async () => {
    const { clientKey } = await import('@/lib/server/rate-limit')
    assert.equal(clientKey(new NextRequest('https://shop.test/api/x')), 'unidentified')
    assert.equal(clientKey(new NextRequest('https://shop.test/api/x', { headers: { 'x-forwarded-for': '' } })), 'unidentified')
  })

  it('a forged CF-Connecting-IP without the edge secret cannot mint a fresh bucket per request', async () => {
    const { clientKey } = await import('@/lib/server/rate-limit')
    const saved = process.env.EDGE_ORIGIN_SECRET
    process.env.EDGE_ORIGIN_SECRET = 'e'.repeat(64)
    try {
      const keys = new Set(
        ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((forged) =>
          clientKey(new NextRequest('https://shop.test/api/x', { headers: { 'cf-connecting-ip': forged, 'x-forwarded-for': '203.0.113.9' } })),
        ),
      )
      assert.deepEqual(Array.from(keys), ['203.0.113.9'])
    } finally {
      if (saved === undefined) delete process.env.EDGE_ORIGIN_SECRET
      else process.env.EDGE_ORIGIN_SECRET = saved
    }
  })
})
