import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { evaluateSalesGate, salesEnabledFlag } from '@/lib/sales-gate'

const IDENTITY_OK: string[] = []
const IDENTITY_MISSING = ['NEXT_PUBLIC_SELLER_NAME', 'NEXT_PUBLIC_SELLER_STREET']

describe('sales gate (lib/sales-gate.ts)', () => {
  it('is closed in production until the owner sets SALES_ENABLED=true', () => {
    const gate = evaluateSalesGate({ NODE_ENV: 'production' }, IDENTITY_OK)
    assert.equal(gate.open, false)
    assert.equal(gate.enforced, true)
    assert.deepEqual(gate.blockers, ['not_enabled'])
  })

  it('opens in production only with the flag AND a complete seller identity', () => {
    assert.equal(evaluateSalesGate({ NODE_ENV: 'production', SALES_ENABLED: 'true' }, IDENTITY_OK).open, true)
    const noIdentity = evaluateSalesGate({ NODE_ENV: 'production', SALES_ENABLED: 'true' }, IDENTITY_MISSING)
    assert.equal(noIdentity.open, false)
    assert.deepEqual(noIdentity.blockers, ['seller_identity'])
    assert.deepEqual(noIdentity.missingIdentity, IDENTITY_MISSING)
  })

  it('lists every blocker at once', () => {
    const gate = evaluateSalesGate({ NODE_ENV: 'production' }, IDENTITY_MISSING)
    assert.deepEqual(gate.blockers, ['not_enabled', 'seller_identity'])
  })

  it('accepts only the literal "true" (case and spaces aside)', () => {
    assert.equal(salesEnabledFlag('true'), true)
    assert.equal(salesEnabledFlag(' TRUE '), true)
    for (const v of [undefined, '', '1', 'yes', 'on', 'false', 'truthy', 'true;']) {
      assert.equal(salesEnabledFlag(v), false, String(v))
    }
  })

  it('is reported but not enforced outside production builds', () => {
    for (const nodeEnv of ['development', 'test', undefined]) {
      const gate = evaluateSalesGate({ NODE_ENV: nodeEnv }, IDENTITY_MISSING)
      assert.equal(gate.open, true, String(nodeEnv))
      assert.equal(gate.enforced, false)
      assert.deepEqual(gate.blockers, ['not_enabled', 'seller_identity'])
    }
  })
})
