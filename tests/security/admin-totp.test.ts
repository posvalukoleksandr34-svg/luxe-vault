import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { base32Decode, checkTotp, isTotpConfigured, matchingStep, totpAt } from '@/lib/server/admin-totp'

const VALID = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' // 160 bits, base32

describe('admin second factor (TOTP)', () => {
  const saved = process.env.ADMIN_TOTP_SECRET
  afterEach(() => {
    if (saved === undefined) delete process.env.ADMIN_TOTP_SECRET
    else process.env.ADMIN_TOTP_SECRET = saved
  })

  it('is off only when no secret is set', async () => {
    delete process.env.ADMIN_TOTP_SECRET
    assert.equal(isTotpConfigured(), false)
    assert.equal(await checkTotp('123456'), 'unconfigured')
  })

  it('a secret that is set but unusable does NOT silently turn the factor off', async () => {
    for (const broken of ['JBSWY3DP0HPK3PXP', 'otpauth://totp/x?secret=ABC', 'ABCDEFG', '1']) {
      process.env.ADMIN_TOTP_SECRET = broken
      // The form still asks for the code…
      assert.equal(isTotpConfigured(), true, broken)
      // …and sign-in is refused (the route answers 503), never waved through.
      await assert.rejects(checkTotp('123456'), /ADMIN_TOTP_SECRET is set but is not a valid/, broken)
    }
  })

  it('a valid secret is on, and only its own codes match', () => {
    process.env.ADMIN_TOTP_SECRET = VALID
    assert.equal(isTotpConfigured(), true)
    const key = base32Decode(VALID)!
    const now = Date.UTC(2026, 9, 12, 12, 0, 0)
    const step = Math.floor(now / 1000 / 30)
    assert.equal(matchingStep(key, totpAt(key, step), now), step)
    assert.equal(matchingStep(key, totpAt(key, step + 5), now), null)
    assert.equal(matchingStep(key, 'abcdef', now), null)
  })
})
