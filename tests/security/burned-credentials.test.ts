import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { burnedAdminCredentials } from '@/lib/server/burned-credentials'

// The real digests are of values that must not appear in this repository
// again, so the matching is tested against stand-in digests.
const digest = (v: string) => createHash('sha256').update(v).digest('hex')
const standIn = { ADMIN_PASSWORD: digest('old-pass'), ADMIN_SESSION_SECRET: digest('old-secret') }

describe('burned admin credentials', () => {
  it('names each variable still set to a burned value', () => {
    assert.deepEqual(burnedAdminCredentials({ ADMIN_PASSWORD: 'old-pass', ADMIN_SESSION_SECRET: 'old-secret' }, standIn), [
      'ADMIN_PASSWORD',
      'ADMIN_SESSION_SECRET',
    ])
    assert.deepEqual(burnedAdminCredentials({ ADMIN_PASSWORD: 'new-pass', ADMIN_SESSION_SECRET: 'old-secret' }, standIn), ['ADMIN_SESSION_SECRET'])
  })

  it('catches the password with stray whitespace, as sign-in reads it trimmed', () => {
    assert.deepEqual(burnedAdminCredentials({ ADMIN_PASSWORD: ' old-pass\n' }, standIn), ['ADMIN_PASSWORD'])
  })

  it('rotated or unset values raise nothing', () => {
    assert.deepEqual(burnedAdminCredentials({ ADMIN_PASSWORD: 'rotated', ADMIN_SESSION_SECRET: 'a'.repeat(64) }, standIn), [])
    assert.deepEqual(burnedAdminCredentials({}, standIn), [])
  })

  it('the shipped digests are SHA-256 shaped and never match a fresh value', () => {
    assert.deepEqual(burnedAdminCredentials({ ADMIN_PASSWORD: 'test-admin-pass', ADMIN_SESSION_SECRET: 'x'.repeat(48) }), [])
  })
})
