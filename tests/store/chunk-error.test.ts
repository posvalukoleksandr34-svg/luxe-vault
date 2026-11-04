import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { CHUNK_RELOAD_WINDOW_MS, isChunkLoadError, mayReloadForChunk, reloadOnceForChunkError } from '@/lib/chunk-error'

describe('isChunkLoadError', () => {
  it('recognises the production report (webpack, timeout)', () => {
    const e = new Error(
      'Loading chunk 1043 failed.\n(timeout: https://www.luxe-vault.store/_next/static/chunks/1043-2d905d86431b5aab.js)',
    )
    e.name = 'ChunkLoadError'
    assert.equal(isChunkLoadError(e), true)
    // Even if the name was lost on the way (a serialized error).
    assert.equal(isChunkLoadError({ message: e.message }), true)
  })

  it('recognises CSS chunks and native dynamic import failures', () => {
    for (const message of [
      'Loading CSS chunk 512 failed.\n(error: https://x/_next/static/css/a.css)',
      'Loading chunk app/page failed.\n(missing: https://x/_next/static/chunks/app/page.js)',
      'Failed to fetch dynamically imported module: https://x/a.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
    ]) {
      assert.equal(isChunkLoadError(new Error(message)), true, message)
    }
  })

  it('leaves real crashes alone', () => {
    for (const e of [
      new Error('Cannot read properties of undefined (reading "map")'),
      new Error('Failed to read collections: fetch failed'),
      new TypeError('x is not a function'),
      null,
      undefined,
      'Loading chunk 1 failed',
    ]) {
      assert.equal(isChunkLoadError(e), false, String(e))
    }
  })
})

describe('reload once', () => {
  it('allows a first reload, refuses another inside the window, allows one after it', () => {
    const now = 1_000_000
    assert.equal(mayReloadForChunk(null, now), true)
    assert.equal(mayReloadForChunk(now - 5_000, now), false)
    assert.equal(mayReloadForChunk(now - CHUNK_RELOAD_WINDOW_MS - 1, now), true)
    assert.equal(mayReloadForChunk(Number.NaN, now), true)
  })

  const g = globalThis as unknown as { window?: unknown }
  afterEach(() => {
    delete g.window
  })

  function fakeWindow(store: Record<string, string> = {}, throws = false) {
    let reloads = 0
    g.window = {
      sessionStorage: {
        getItem: (k: string) => {
          if (throws) throw new Error('blocked')
          return k in store ? store[k] : null
        },
        setItem: (k: string, v: string) => {
          if (throws) throw new Error('blocked')
          store[k] = v
        },
      },
      location: { reload: () => void reloads++ },
    }
    return { store, reloads: () => reloads }
  }

  it('reloads the first time and records when', () => {
    const w = fakeWindow()
    assert.equal(reloadOnceForChunkError(2_000_000), true)
    assert.equal(w.reloads(), 1)
    assert.equal(w.store['lv.chunk-reload-at'], '2000000')
  })

  it('does not loop: a second failure right after the reload is not reloaded', () => {
    const w = fakeWindow({ 'lv.chunk-reload-at': '2000000' })
    assert.equal(reloadOnceForChunkError(2_010_000), false)
    assert.equal(w.reloads(), 0)
  })

  it('never reloads without session storage (it could not remember, so it could loop)', () => {
    const w = fakeWindow({}, true)
    assert.equal(reloadOnceForChunkError(2_000_000), false)
    assert.equal(w.reloads(), 0)
  })

  it('does nothing on the server', () => {
    assert.equal(reloadOnceForChunkError(), false)
  })
})
