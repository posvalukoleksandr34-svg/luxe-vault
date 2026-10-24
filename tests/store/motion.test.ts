import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { MOTION_MS, exitDelay, motionReduced } from '@/lib/motion'
import {
  noteNavigationTrigger,
  pageTransition,
  pageTransitionRunning,
  productTransitionName,
  resultsTransition,
  transitionDirection,
} from '@/lib/page-transition'

// lib/page-transition.ts runs in the browser. These tests give it the few
// pieces of window/document it touches, and a stand-in for
// document.startViewTransition that runs the update the way the browser
// does: later, once, and then settles `finished`.

type Transition = {
  finished: Promise<void>
  ready: Promise<void>
  updateCallbackDone: Promise<void>
  skipTransition(): void
}

class FakeStyle {
  props = new Map<string, string>()
  setProperty(k: string, v: string) {
    this.props.set(k, v)
  }
  removeProperty(k: string) {
    this.props.delete(k)
  }
}

class FakeElement {
  style = new FakeStyle()
  attrs: Record<string, string>
  children: FakeElement[]
  constructor(attrs: Record<string, string> = {}, children: FakeElement[] = []) {
    this.attrs = attrs
    this.children = children
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null
  }
  getBoundingClientRect() {
    return { width: 300, height: 400, top: 100, left: 100, bottom: 500, right: 400 }
  }
  querySelector(sel: string) {
    const attr = /^\[([\w-]+)/.exec(sel)?.[1]
    return this.children.find((c) => attr && attr in c.attrs) ?? null
  }
}

type Env = {
  html: { dataset: Record<string, string> }
  started: number
  skipped: number
  last: Transition | null
  /** elements the document answers querySelector(All) with, by attribute */
  elements: FakeElement[]
  setUrl(path: string): void
}

const realGlobals = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement }

function install(opts: { api?: boolean; reduced?: boolean; hidden?: boolean; runUpdate?: boolean; throws?: boolean } = {}): Env {
  const env: Env = {
    html: { dataset: {} },
    started: 0,
    skipped: 0,
    last: null,
    elements: [],
    setUrl(path) {
      win.location = new URL(path, win.location.href)
    },
  }
  const win = {
    location: new URL('https://shop.test/catalog'),
    innerWidth: 1280,
    innerHeight: 900,
    matchMedia: () => ({ matches: Boolean(opts.reduced) }),
  }
  const find = (sel: string) => {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel)
    return env.elements.filter((e) => m && m[1] in e.attrs && (m[2] === undefined || e.attrs[m[1]] === m[2]))
  }
  const doc: Record<string, unknown> = {
    documentElement: env.html,
    visibilityState: opts.hidden ? 'hidden' : 'visible',
    querySelector: (sel: string) => find(sel)[0] ?? null,
    querySelectorAll: (sel: string) => find(sel),
  }
  if (opts.api !== false) {
    doc.startViewTransition = (update: () => void | Promise<void>): Transition => {
      if (opts.throws) throw new Error('InvalidStateError')
      env.started++
      let settle!: () => void
      const finished = new Promise<void>((r) => (settle = r))
      const updateCallbackDone =
        opts.runUpdate === false ? new Promise<void>(() => {}) : Promise.resolve().then(() => update())
      updateCallbackDone.then(settle, settle)
      const t: Transition = {
        finished,
        ready: Promise.resolve(),
        updateCallbackDone,
        skipTransition: () => {
          env.skipped++
          settle()
        },
      }
      env.last = t
      return t
    }
  }
  Object.assign(globalThis, { window: win, document: doc, HTMLElement: FakeElement })
  return env
}

function restore() {
  Object.assign(globalThis, realGlobals)
}

/** A router stand-in: counts calls and, like the App Router, changes the address. */
function router(env: Env, to: string, opts: { changesAddress?: boolean } = {}) {
  const r = {
    calls: 0,
    navigate: () => {
      r.calls++
      if (opts.changesAddress === false) return
      try {
        env.setUrl(to)
      } catch {
        // an address the browser would not navigate to either
      }
    },
  }
  return r
}

describe('motion tokens', () => {
  afterEach(restore)

  it('exit delays follow the tokens, and vanish when motion is reduced', () => {
    install()
    assert.equal(motionReduced(), false)
    assert.equal(exitDelay(), MOTION_MS.fast)
    assert.equal(exitDelay(MOTION_MS.panel), 320)
    const env = install()
    env.html.dataset.motion = 'reduce'
    assert.equal(motionReduced(), true, 'the account setting (html[data-motion=reduce])')
    assert.equal(exitDelay(MOTION_MS.panel), 0)
    install({ reduced: true })
    assert.equal(motionReduced(), true, 'the OS setting (prefers-reduced-motion)')
    assert.equal(exitDelay(), 0)
  })

  it('arrivals are never faster than departures', () => {
    assert.ok(MOTION_MS.fast < MOTION_MS.page, 'the old page leaves faster than the new one settles')
    assert.ok(MOTION_MS.fast < MOTION_MS.panel, 'drawers leave faster than they arrive')
    assert.ok(MOTION_MS.shared <= 500, 'the shared photo never drags')
  })
})

describe('page transition: names and direction', () => {
  it('a product id always becomes a valid view-transition-name', () => {
    assert.equal(productTransitionName('dbtest-scarf'), 'product-dbtest-scarf')
    assert.equal(productTransitionName('a b/ü.1'), 'product-a_b___1')
    // Starts with a letter whatever the id: an ident may not begin with a digit.
    assert.match(productTransitionName('42'), /^[a-z][\w-]*$/)
    assert.equal(productTransitionName('x"y'), productTransitionName('x"y'), 'deterministic')
  })

  it('going down the hierarchy is forward, up is back; locale prefixes are not depth', () => {
    assert.equal(transitionDirection('/catalog', '/product/abc'), 'forward')
    assert.equal(transitionDirection('/product/abc', '/catalog'), 'back')
    assert.equal(transitionDirection('/it/product/abc', '/it/catalog'), 'back')
    assert.equal(transitionDirection('/it/catalog', '/product/abc'), 'forward')
    assert.equal(transitionDirection('/fr', '/fr/catalog'), 'forward')
    assert.equal(transitionDirection('/catalog', '/about'), 'forward', 'same depth reads as forward')
    assert.equal(transitionDirection('/', '/catalog'), 'forward')
    // "it" is a locale only as the first segment.
    assert.equal(transitionDirection('/catalog/it', '/catalog'), 'back')
  })
})

describe('page transition: never stands between the visitor and the page', () => {
  afterEach(restore)

  for (const [label, opts, href] of [
    ['no View Transitions API', { api: false }, '/product/abc'],
    ['motion reduced', { reduced: true }, '/product/abc'],
    ['tab hidden', { hidden: true }, '/product/abc'],
    ['another origin', {}, 'https://pay.example.com/checkout'],
    ['the address it is already on', {}, '/catalog'],
    ['an unparsable address', {}, 'http://['],
  ] as const) {
    it(`${label}: navigates at once, no transition`, () => {
      const env = install(opts)
      const r = router(env, href)
      pageTransition(href, r.navigate)
      assert.equal(r.calls, 1, 'navigated synchronously')
      assert.equal(env.started, 0)
      assert.equal(env.html.dataset.vt, undefined)
    })
  }

  it('starting the transition throws: navigates anyway and leaves nothing behind', () => {
    const env = install({ throws: true })
    const r = router(env, '/product/abc')
    pageTransition('/product/abc', r.navigate)
    assert.equal(r.calls, 1)
    assert.equal(env.html.dataset.vt, undefined)
    assert.equal(env.html.dataset.vtArrive, undefined)
  })

  it('the browser never runs the update: the safety timer still navigates, once', async () => {
    const env = install({ runUpdate: false })
    const r = router(env, '/product/abc')
    pageTransition('/product/abc', r.navigate)
    assert.equal(r.calls, 0, 'waiting on the browser')
    await new Promise((res) => setTimeout(res, 1500))
    assert.equal(r.calls, 1)
    env.last?.skipTransition()
    await new Promise((res) => setTimeout(res, 50))
    assert.equal(r.calls, 1, 'never twice')
  })
})

describe('page transition: a normal run', () => {
  afterEach(restore)

  it('marks the direction while it runs, navigates exactly once, and cleans up', async () => {
    const env = install()
    const r = router(env, '/product/abc')
    pageTransition('/product/abc', r.navigate)
    assert.equal(env.started, 1)
    assert.equal(env.html.dataset.vt, 'forward')
    assert.equal(pageTransitionRunning(), true)
    await env.last!.finished
    await new Promise((res) => setImmediate(res))
    assert.equal(r.calls, 1)
    assert.equal(env.html.dataset.vt, undefined, 'cleared after the transition')
    assert.equal(pageTransitionRunning(), false)
    assert.equal(env.skipped, 0, 'a page that arrives in time is animated')
  })

  it('a link up the hierarchy runs as "back"', async () => {
    const env = install()
    env.setUrl('/product/abc')
    const r = router(env, '/catalog')
    pageTransition('/catalog', r.navigate)
    assert.equal(env.html.dataset.vt, 'back')
    await env.last!.finished
    assert.equal(r.calls, 1)
  })

  it('card → product: the clicked card and the gallery share one name, only while it runs', async () => {
    const env = install()
    const card = new FakeElement({ 'data-vt-product': 'p1' })
    const link = new FakeElement({ href: '/product/p1' }, [card])
    const hero = new FakeElement({ 'data-vt-product-hero': 'p1' })
    const r = {
      calls: 0,
      navigate: () => {
        r.calls++
        env.setUrl('/product/p1')
        env.elements.push(hero) // the product page is now in the document
      },
    }
    noteNavigationTrigger(link as unknown as Element)
    pageTransition('/product/p1', r.navigate)
    assert.equal(card.style.props.get('view-transition-name'), 'product-p1', 'the card names its photo for the old picture')
    assert.equal(card.style.props.get('view-transition-class'), 'product-media')
    assert.equal(env.html.dataset.vtArrive, 'product')
    await env.last!.updateCallbackDone
    assert.equal(card.style.props.size, 0, 'released before the new page is photographed')
    assert.equal(hero.style.props.get('view-transition-name'), 'product-p1', 'the gallery receives the name')
    await env.last!.finished
    await new Promise((res) => setImmediate(res))
    assert.equal(hero.style.props.size, 0, 'and gives it up afterwards')
    assert.equal(env.html.dataset.vtArrive, undefined)
    assert.equal(r.calls, 1)
  })

  it('a router that never changes the address does not hold the page: it lets go after the wait', async () => {
    const env = install()
    const r = router(env, '/product/abc', { changesAddress: false })
    const t0 = Date.now()
    pageTransition('/product/abc', r.navigate)
    await env.last!.finished
    const waited = Date.now() - t0
    assert.equal(r.calls, 1)
    assert.ok(waited < 1500, `released after ${waited}ms`)
    assert.equal(env.skipped, 1, 'skipped, not animated: the old page never fades into itself')
  })
})

describe('results transition (filters)', () => {
  afterEach(restore)

  it('no results area, or no API: the update simply runs', () => {
    install()
    let n = 0
    resultsTransition(() => n++)
    assert.equal(n, 1, 'no [data-vt-results] in the document')
    const env = install({ api: false })
    env.elements.push(new FakeElement({ 'data-vt-results': '' }))
    resultsTransition(() => n++)
    assert.equal(n, 2)
  })

  it('crossfades the results: the update runs inside the transition, once', async () => {
    const env = install()
    env.elements.push(new FakeElement({ 'data-vt-results': '' }))
    let n = 0
    resultsTransition(() => n++)
    assert.equal(env.html.dataset.vt, 'results')
    assert.equal(n, 0, 'deferred to the transition')
    await env.last!.finished
    await new Promise((res) => setImmediate(res))
    assert.equal(n, 1)
    assert.equal(env.html.dataset.vt, undefined)
  })
})
