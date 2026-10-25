import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import { suppressionFor, verifyResendSignature, WEBHOOK_TOLERANCE_S } from '@/lib/server/email-events'

// A made-up signing secret in Resend's format (not a real one).
const KEY = Buffer.from('luxe-vault-test-signing-key-0123456789')
const SECRET = `whsec_${KEY.toString('base64')}`
const NOW = 1_761_400_000
const sign = (id: string, ts: number, body: string, key = KEY) =>
  `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`

describe('Resend webhook signature (Svix scheme)', () => {
  const body = JSON.stringify({ type: 'email.bounced', data: { to: ['a@example.com'] } })
  const h = (over: Partial<{ id: string | null; timestamp: string | null; signature: string | null }> = {}) => ({
    id: 'msg_1',
    timestamp: String(NOW),
    signature: sign('msg_1', NOW, body),
    ...over,
  })

  it('accepts a correctly signed, fresh delivery', () => {
    assert.equal(verifyResendSignature(SECRET, h(), body, NOW), true)
  })
  it('accepts it when one of several signatures matches (secret rotation)', () => {
    assert.equal(verifyResendSignature(SECRET, h({ signature: `v1,AAAA ${sign('msg_1', NOW, body)}` }), body, NOW), true)
  })
  it('refuses a changed body, id or timestamp', () => {
    assert.equal(verifyResendSignature(SECRET, h(), body.replace('a@', 'b@'), NOW), false)
    assert.equal(verifyResendSignature(SECRET, h({ id: 'msg_2' }), body, NOW), false)
    assert.equal(verifyResendSignature(SECRET, h({ timestamp: String(NOW + 1) }), body, NOW + 1), false)
  })
  it('refuses another key, a stale or future delivery, and missing or malformed headers', () => {
    assert.equal(verifyResendSignature(SECRET, h({ signature: sign('msg_1', NOW, body, Buffer.from('another key')) }), body, NOW), false)
    assert.equal(verifyResendSignature(SECRET, h(), body, NOW + WEBHOOK_TOLERANCE_S + 1), false, 'replayed later')
    assert.equal(verifyResendSignature(SECRET, h(), body, NOW - WEBHOOK_TOLERANCE_S - 1), false, 'from the future')
    for (const over of [{ id: null }, { timestamp: null }, { signature: null }, { timestamp: 'soon' }, { signature: 'v2,xyz' }, { signature: 'v1,' }]) {
      assert.equal(verifyResendSignature(SECRET, h(over), body, NOW), false, JSON.stringify(over))
    }
  })
})

describe('what a delivery event asks for', () => {
  it('a hard bounce suppresses its recipients, normalised', () => {
    assert.deepEqual(
      suppressionFor({ type: 'email.bounced', data: { to: [' Anna@Example.com ', 'anna@example.com'], bounce: { type: 'Permanent' } } }),
      { emails: ['anna@example.com'], reason: 'bounced' },
    )
  })
  it('a bounce without a type counts as permanent (Resend sends email.bounced for those)', () => {
    assert.deepEqual(suppressionFor({ type: 'email.bounced', data: { to: 'x@example.com' } }), { emails: ['x@example.com'], reason: 'bounced' })
  })
  it('a temporary bounce changes nothing', () => {
    assert.equal(suppressionFor({ type: 'email.bounced', data: { to: ['x@example.com'], bounce: { type: 'Transient' } } }), null)
  })
  it('a spam complaint unsubscribes', () => {
    assert.deepEqual(suppressionFor({ type: 'email.complained', data: { to: ['x@example.com'] } }), { emails: ['x@example.com'], reason: 'unsubscribed' })
  })
  it('other events, junk and invalid addresses ask for nothing', () => {
    for (const e of [null, 'x', {}, { type: 'email.delivered', data: { to: ['x@example.com'] } }, { type: 'email.bounced' }, { type: 'email.bounced', data: { to: ['not-an-address', 42] } }]) {
      assert.equal(suppressionFor(e), null, JSON.stringify(e))
    }
  })
})
