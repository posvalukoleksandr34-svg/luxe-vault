import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { classifyExisting, hashIdempotencyKey, parseIdempotencyKey, STALE_CLAIM_MS } from '@/lib/server/order-idempotency'

describe('checkout attempt keys (0061)', () => {
  it('accepts the keys checkout sends, and nothing that could be abused', () => {
    assert.equal(parseIdempotencyKey('3f2b8c1e-0b7a-4f3e-9a51-6d0c2e7f4a10'), '3f2b8c1e-0b7a-4f3e-9a51-6d0c2e7f4a10', 'randomUUID()')
    assert.equal(parseIdempotencyKey('a3f09c1d22e4b5f60718293a4b5c6d7e'), 'a3f09c1d22e4b5f60718293a4b5c6d7e', 'the hex fallback')
    for (const bad of [undefined, null, 42, '', 'short', 'x'.repeat(65), "'; drop table orders;--", 'a b c d e f g h i j', { k: 1 }]) {
      assert.equal(parseIdempotencyKey(bad), null, JSON.stringify(bad))
    }
  })

  it('stores a SHA-256 of the key, never the key', () => {
    const h = hashIdempotencyKey('3f2b8c1e-0b7a-4f3e-9a51-6d0c2e7f4a10')
    assert.match(h, /^[0-9a-f]{64}$/, 'what the 0061 check constraint accepts')
    assert.equal(h, hashIdempotencyKey('3f2b8c1e-0b7a-4f3e-9a51-6d0c2e7f4a10'), 'deterministic')
    assert.notEqual(h, hashIdempotencyKey('3f2b8c1e-0b7a-4f3e-9a51-6d0c2e7f4a11'))
  })

  it('a taken key: an order returns it; no order is in progress until the claim is stale', () => {
    const now = Date.parse('2026-10-25T12:00:00Z')
    const at = (msAgo: number) => new Date(now - msAgo).toISOString()
    assert.equal(classifyExisting({ order_number: 'LV-ABC123', created_at: at(10 * 60_000) }, now), 'existing')
    assert.equal(classifyExisting({ order_number: 'LV-ABC123', created_at: at(1_000) }, now), 'existing', 'an order counts however recent')
    assert.equal(classifyExisting({ order_number: null, created_at: at(1_000) }, now), 'in_progress')
    assert.equal(classifyExisting({ order_number: null, created_at: at(STALE_CLAIM_MS - 1) }, now), 'in_progress')
    assert.equal(classifyExisting({ order_number: null, created_at: at(STALE_CLAIM_MS + 1) }, now), 'stale', 'a request that died')
  })
})
