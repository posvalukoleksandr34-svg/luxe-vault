import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

let auth: typeof import('@/lib/server/admin-auth')

describe('admin session tokens', () => {
  before(async () => {
    process.env.ADMIN_PASSWORD = 'unit-test-password'
    process.env.ADMIN_SESSION_SECRET = 'unit-test-session-secret-0123456789'
    auth = await import('@/lib/server/admin-auth')
  })

  it('accepts a freshly issued token', async () => {
    const { token, nonce } = await auth.createSession()
    assert.deepEqual((await auth.verifySessionToken(token))?.nonce, nonce)
  })

  it('rejects a tampered signature, nonce or expiry', async () => {
    const { token } = await auth.createSession()
    const [exp, nonce, sig] = token.split('.')
    const flip = (s: string) => (s[0] === '0' ? '1' : '0') + s.slice(1)
    assert.equal(await auth.verifySessionToken(`${exp}.${nonce}.${flip(sig)}`), null)
    assert.equal(await auth.verifySessionToken(`${exp}.${flip(nonce)}.${sig}`), null)
    assert.equal(await auth.verifySessionToken(`${Number(exp) + 3600}.${nonce}.${sig}`), null)
  })

  it('rejects an expired token even with a valid signature', async () => {
    const realNow = Date.now
    try {
      const { token } = await auth.createSession()
      Date.now = () => realNow() + (auth.ADMIN_SESSION_MAX_AGE_SECONDS + 1) * 1000
      assert.equal(await auth.verifySessionToken(token), null)
    } finally {
      Date.now = realNow
    }
  })

  it('rejects malformed input', async () => {
    for (const bad of [undefined, null, '', 'a.b.c', 'x'.repeat(500), '1.2', '9999999999.zz.zz']) {
      assert.equal(await auth.verifySessionToken(bad), null)
    }
  })

  it('invalidates every token when the password changes', async () => {
    const { token } = await auth.createSession()
    process.env.ADMIN_PASSWORD = 'rotated-password'
    try {
      assert.equal(await auth.verifySessionToken(token), null)
    } finally {
      process.env.ADMIN_PASSWORD = 'unit-test-password'
    }
  })

  it('fails closed when the secret is missing', async () => {
    const { token } = await auth.createSession()
    const secret = process.env.ADMIN_SESSION_SECRET
    delete process.env.ADMIN_SESSION_SECRET
    try {
      assert.equal(await auth.verifySessionToken(token), null)
    } finally {
      process.env.ADMIN_SESSION_SECRET = secret
    }
  })
})
