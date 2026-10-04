import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isCrossSiteWrite } from '@/lib/server/csrf'

const h = (init: Record<string, string>) => new Headers({ host: 'www.luxe-vault.store', ...init })

describe('CSRF guard', () => {
  it('refuses cross-site writes', () => {
    assert.equal(isCrossSiteWrite('POST', '/api/orders', h({ 'sec-fetch-site': 'cross-site' })), true)
    assert.equal(isCrossSiteWrite('DELETE', '/api/admin/products/1', h({ origin: 'https://evil.example' })), true)
    assert.equal(isCrossSiteWrite('POST', '/api/orders', h({ origin: 'null' })), true)
  })

  it('refuses a sibling subdomain', () => {
    assert.equal(
      isCrossSiteWrite('POST', '/api/orders', h({ 'sec-fetch-site': 'same-site', origin: 'https://shop.luxe-vault.store' })),
      true,
    )
  })

  it('allows same-origin writes, safe methods and server-to-server callers', () => {
    assert.equal(isCrossSiteWrite('POST', '/api/orders', h({ 'sec-fetch-site': 'same-origin' })), false)
    assert.equal(isCrossSiteWrite('POST', '/api/orders', h({ origin: 'https://www.luxe-vault.store' })), false)
    assert.equal(isCrossSiteWrite('GET', '/api/orders', h({ 'sec-fetch-site': 'cross-site' })), false)
    assert.equal(isCrossSiteWrite('POST', '/api/cron/sweep', h({})), false)
  })

  it('exempts only the exact webhook paths', () => {
    const xs = h({ 'sec-fetch-site': 'cross-site' })
    assert.equal(isCrossSiteWrite('POST', '/api/payments/stripe/webhook', xs), false)
    assert.equal(isCrossSiteWrite('POST', '/api/payments/crypto/webhook', xs), false)
    assert.equal(isCrossSiteWrite('POST', '/api/payments/stripe/webhook/x', xs), true)
    assert.equal(isCrossSiteWrite('POST', '/api/payments/stripe/intent', xs), true)
  })
})
