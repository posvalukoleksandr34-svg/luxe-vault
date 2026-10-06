import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FAILURE_WEIGHT, LOCK_AT, classifyFailure, hashIp, shouldLock } from '@/lib/server/payment-fraud'

describe('card fraud guard: classifying a failed attempt', () => {
  it('fraud-type declines', () => {
    for (const code of ['fraudulent', 'stolen_card', 'lost_card', 'pickup_card', 'merchant_blacklist']) {
      assert.equal(classifyFailure({ code: 'card_declined', decline_code: code }), 'fraud', code)
    }
  })
  it('a payment Radar blocked, whatever the decline code', () => {
    assert.equal(classifyFailure({ code: 'card_declined', decline_code: 'generic_decline' }, { type: 'blocked' }), 'fraud')
    assert.equal(classifyFailure({ code: 'card_declined' }, { type: 'issuer_declined', risk_level: 'highest' }), 'fraud')
  })
  it('a wrong CVC', () => {
    assert.equal(classifyFailure({ code: 'incorrect_cvc' }), 'cvc')
    assert.equal(classifyFailure({ code: 'card_declined', decline_code: 'incorrect_cvc' }), 'cvc')
  })
  it('ordinary declines', () => {
    assert.equal(classifyFailure({ code: 'card_declined', decline_code: 'insufficient_funds' }), 'other')
    assert.equal(classifyFailure({ code: 'expired_card' }), 'other')
    assert.equal(classifyFailure({ code: 'payment_intent_authentication_failure' }, { type: 'authorized', risk_level: 'normal' }), 'other')
    assert.equal(classifyFailure(null), 'other')
  })
})

describe('card fraud guard: when an order is locked', () => {
  const run = (...kinds: ('fraud' | 'cvc' | 'other')[]) => {
    let total = 0
    for (let i = 0; i < kinds.length; i++) {
      total += FAILURE_WEIGHT[kinds[i]]
      if (shouldLock(kinds[i], total)) return i + 1
    }
    return null
  }
  it('at once on a fraud-type decline', () => assert.equal(run('fraud'), 1))
  it('after two wrong CVCs', () => assert.equal(run('cvc', 'cvc'), 2))
  it('after three ordinary declines, not before', () => {
    assert.equal(run('other', 'other'), null)
    assert.equal(run('other', 'other', 'other'), 3)
  })
  it('one wrong CVC plus one decline', () => assert.equal(run('cvc', 'other'), 2))
  it('limit is 3', () => assert.equal(LOCK_AT, 3))
})

describe('card fraud guard: IP pseudonymisation', () => {
  it('is keyed, stable and not the address', () => {
    const before = process.env.PAYMENT_FRAUD_SECRET
    process.env.PAYMENT_FRAUD_SECRET = 'k1'
    const a = hashIp('203.0.113.7')
    assert.equal(a, hashIp('203.0.113.7'))
    assert.notEqual(a, hashIp('203.0.113.8'))
    assert.ok(a && !a.includes('203'))
    process.env.PAYMENT_FRAUD_SECRET = 'k2'
    assert.notEqual(hashIp('203.0.113.7'), a)
    assert.equal(hashIp('unknown'), null)
    if (before === undefined) delete process.env.PAYMENT_FRAUD_SECRET
    else process.env.PAYMENT_FRAUD_SECRET = before
  })
})
