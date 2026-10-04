import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cameThroughEdge, clientIp, edgeLockState } from '@/lib/server/client-ip'

const KEYS = ['NODE_ENV', 'VERCEL_ENV', 'EDGE_ORIGIN_SECRET', 'EDGE_ORIGIN_LOCK'] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
const env = process.env as Record<string, string | undefined>

function set(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete env[k]
  Object.assign(env, values)
}

const SECRET = 'a'.repeat(64)

describe('origin lock', () => {
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete env[k]
      else env[k] = saved[k]
    }
  })

  it('fails closed in Vercel production without a secret', () => {
    set({ NODE_ENV: 'production', VERCEL_ENV: 'production' })
    assert.equal(edgeLockState(), 'misconfigured')
    set({ NODE_ENV: 'production', VERCEL_ENV: 'production', EDGE_ORIGIN_SECRET: '   ' })
    assert.equal(edgeLockState(), 'misconfigured')
  })

  it('opens in production only with the explicit break-glass switch', () => {
    set({ NODE_ENV: 'production', VERCEL_ENV: 'production', EDGE_ORIGIN_LOCK: 'off' })
    assert.equal(edgeLockState(), 'off')
    set({ NODE_ENV: 'production', VERCEL_ENV: 'production', EDGE_ORIGIN_LOCK: 'false' })
    assert.equal(edgeLockState(), 'misconfigured')
  })

  it('is enforced whenever a production build has a secret', () => {
    set({ NODE_ENV: 'production', VERCEL_ENV: 'production', EDGE_ORIGIN_SECRET: SECRET })
    assert.equal(edgeLockState(), 'enforced')
    set({ NODE_ENV: 'production', EDGE_ORIGIN_SECRET: SECRET, EDGE_ORIGIN_LOCK: 'off' })
    assert.equal(edgeLockState(), 'enforced')
  })

  it('stays out of the way of local development and previews', () => {
    set({ NODE_ENV: 'development' })
    assert.equal(edgeLockState(), 'off')
    set({ NODE_ENV: 'production', VERCEL_ENV: 'preview' })
    assert.equal(edgeLockState(), 'off')
  })

  it('accepts only the exact secret', () => {
    set({ EDGE_ORIGIN_SECRET: SECRET })
    assert.equal(cameThroughEdge(new Headers({ 'x-edge-auth': SECRET })), true)
    assert.equal(cameThroughEdge(new Headers({ 'x-edge-auth': SECRET.slice(1) })), false)
    assert.equal(cameThroughEdge(new Headers({ 'x-edge-auth': `${SECRET}a` })), false)
    assert.equal(cameThroughEdge(new Headers()), false)
    set({})
    assert.equal(cameThroughEdge(new Headers({ 'x-edge-auth': '' })), false)
  })

  it('believes CF-Connecting-IP only from the edge', () => {
    set({ EDGE_ORIGIN_SECRET: SECRET })
    const spoofed = new Headers({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' })
    assert.equal(clientIp(spoofed), '9.9.9.9')
    spoofed.set('x-edge-auth', SECRET)
    assert.equal(clientIp(spoofed), '1.2.3.4')
  })
})
