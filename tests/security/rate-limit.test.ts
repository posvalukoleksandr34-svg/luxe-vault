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
