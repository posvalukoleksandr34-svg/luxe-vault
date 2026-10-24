import { flushSync } from 'react-dom'
import { motionReduced } from '@/lib/motion'

/**
 * Page-to-page transitions on top of the browser's View Transitions API.
 *
 * WHY THE NATIVE API, NOT REACT'S <ViewTransition>. The App Router renders
 * with the React build Next.js vendors (19.2 canary here), which does not
 * export ViewTransition. `experimental.viewTransition` would switch the WHOLE
 * application to React's experimental channel — not a trade to make for an
 * animation. The native API needs nothing from React: the browser photographs
 * the page, the update runs, the browser photographs the result and
 * crossfades the two (app/globals.css → "Motion system" says how).
 *
 * HOW IT MEETS THE ROUTER. A link calls pageTransition() instead of letting
 * next/link navigate (components/locale-link.tsx, through next/link's own
 * `onNavigate`, so modifier-clicks, new tabs, downloads and external links
 * never come here). The transition's update callback starts the navigation
 * and resolves once the address has changed: the App Router writes the URL in
 * the same commit that puts the new page in the document, so a changed URL
 * means the new page is there to be photographed. A redirect counts too —
 * any change of address does.
 *
 * WHAT IT NEVER DOES:
 *  - delay a navigation for an animation. The browser holds the outgoing
 *    picture while the next page is fetched (as Next would hold the old page
 *    anyway); after MAX_WAIT_MS the transition lets go and the page arrives
 *    with the ordinary fade (components/page-transition.tsx) when it is ready.
 *  - block one: if the API is missing, motion is reduced, the tab is hidden or
 *    anything throws, the navigation simply runs.
 *  - touch browser back/forward. On popstate the router has usually rendered
 *    the restored page before the browser could photograph the old one, so a
 *    transition there would be the new page fading into itself. History keeps
 *    the short fade instead.
 *
 * OPENING. Every page opens from what was tapped: the new picture grows
 * out of the link or card that was clicked (its centre is handed to CSS as
 * --vt-ox / --vt-oy), and its content settles in one block after another.
 *
 * SHARED ELEMENT. A product's photo travels from where it was tapped — a
 * card in a listing, a search suggestion, a line in the cart — to the
 * product page, and back to its card when a link leads from the product
 * page to a listing that shows it. The name (product-<id>) is given to exactly one
 * element on each side — the card that was clicked, the gallery that receives
 * it — and only for the duration of the transition, so repeated cards,
 * filtered grids and rails never collide. No matching element on the far
 * side (scrolled away, filtered out, image missing) and the photo simply
 * fades with the page.
 */

type ViewTransitionLike = {
  finished: Promise<void>
  ready: Promise<void>
  updateCallbackDone: Promise<void>
  skipTransition(): void
}
type StartViewTransition = (update: () => void | Promise<void>) => ViewTransitionLike

/** Product card media (the clicked card names itself). */
export const VT_PRODUCT_ATTR = 'data-vt-product'
/** The product page's gallery (receives the photo). */
export const VT_PRODUCT_HERO_ATTR = 'data-vt-product-hero'
/** A results area that changes in place (catalogue filters). */
export const VT_RESULTS_ATTR = 'data-vt-results'

/** Longest the outgoing picture is held while the next page loads. */
const MAX_WAIT_MS = 900
/** Extra time the gallery photo may take to decode before it is photographed. */
const IMAGE_BUDGET_MS = 220

let active: ViewTransitionLike | null = null
let trigger: { el: Element; at: number } | null = null
let leaving: (() => void)[] = []
let leavingTimer: ReturnType<typeof setTimeout> | null = null

function startFn(): StartViewTransition | null {
  if (typeof document === 'undefined') return null
  const fn = (document as unknown as { startViewTransition?: StartViewTransition }).startViewTransition
  return typeof fn === 'function' ? fn.bind(document) : null
}

/** Transitions can run here at all (API present, motion not reduced, tab visible). */
export function canTransition(): boolean {
  return Boolean(startFn()) && !motionReduced() && document.visibilityState === 'visible'
}

/** True while a page transition is between its two pictures. */
export function pageTransitionRunning(): boolean {
  return typeof document !== 'undefined' && Boolean(document.documentElement.dataset.vt)
}

/**
 * Remembers the element a navigation started from (the link that was
 * clicked). next/link's onNavigate carries no event, so the link's onClick
 * — which runs immediately before it, in the same dispatch — leaves it here.
 */
export function noteNavigationTrigger(el: Element): void {
  trigger = { el, at: performance.now() }
}

/**
 * Runs `fn` once the page being left has been photographed — or at once,
 * when no page transition follows. For what a click on a link also closes
 * (a search panel, a menu): closed straight away, it would vanish from the
 * old picture and the page would jump before the transition began; closed
 * here, it leaves with the old page.
 *
 * A link's onClick runs just before its navigation reaches pageTransition(),
 * which collects these; if nothing does in this task (a modifier click, a
 * navigation that was prevented), they run anyway.
 */
export function afterLeaving(fn: () => void): void {
  leaving.push(fn)
  if (leavingTimer === null) leavingTimer = setTimeout(() => runAll(takeLeaving()), 0)
}

function takeLeaving(): (() => void)[] {
  if (leavingTimer !== null) clearTimeout(leavingTimer)
  leavingTimer = null
  const fns = leaving
  leaving = []
  return fns
}

function runAll(fns: (() => void)[]): void {
  for (const fn of fns.splice(0)) {
    try {
      fn()
    } catch {
      // one failing must not keep the others from running
    }
  }
}

function takeTrigger(): Element | null {
  const t = trigger
  trigger = null
  return t && performance.now() - t.at < 1000 ? t.el : null
}

const urlKey = (u: { pathname: string; search: string }) => u.pathname + u.search

/** Locale prefixes are not depth: /it/catalog is as deep as /catalog. */
function depth(pathname: string): number {
  return pathname.split('/').filter((s, i) => s && !(i === 1 && /^(it|fr|de)$/.test(s))).length
}

/**
 * Which way the page moves: 'back' when the destination sits higher in the
 * hierarchy (fewer path segments — product → listing), else 'forward'.
 */
export function transitionDirection(fromPath: string, toPath: string): 'back' | 'forward' {
  return depth(toPath) < depth(fromPath) ? 'back' : 'forward'
}

/** A valid, deterministic view-transition-name for a product id. */
export function productTransitionName(id: string): string {
  return `product-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth
}

function setName(el: HTMLElement, id: string, into: HTMLElement[]): void {
  el.style.setProperty('view-transition-name', productTransitionName(id))
  // Browsers without view-transition-class ignore it; the name still works.
  el.style.setProperty('view-transition-class', 'product-media')
  into.push(el)
}

function clearNames(els: HTMLElement[]): void {
  for (const el of els) {
    el.style.removeProperty('view-transition-name')
    el.style.removeProperty('view-transition-class')
  }
  els.length = 0
}

function selector(attr: string, value: string): string {
  return `[${attr}="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"')}"]`
}

/**
 * Starts the navigation and resolves once the address has changed — true —
 * or MAX_WAIT_MS has passed without it — false.
 */
function addressChanged(from: string, navigate: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    const start = performance.now()
    navigate()
    // A timer, not requestAnimationFrame: while the transition holds the old
    // picture the page may not be producing frames, so rAF would not fire.
    const check = () => {
      if (urlKey(window.location) !== from) resolve(true)
      else if (performance.now() - start > MAX_WAIT_MS) resolve(false)
      else setTimeout(check, 16)
    }
    setTimeout(check, 0)
  })
}

function settle<T>(p: Promise<T>, ms: number): Promise<void> {
  return Promise.race([p.then(() => undefined, () => undefined), new Promise<void>((r) => setTimeout(r, ms))])
}

/**
 * Navigates to `href` (already the final, localised address) with a page
 * transition when one can run; otherwise just navigates. `navigate` is the
 * router call — push or replace, with its scroll option — and is always
 * called exactly once.
 */
export function pageTransition(href: string, navigate: () => void): void {
  const clicked = takeTrigger()
  const onLeave = takeLeaving()
  const start = startFn()
  let target: URL
  try {
    target = new URL(href, window.location.href)
  } catch {
    runAll(onLeave)
    navigate()
    return
  }
  // Same address (a hash link, a refresh of the page itself): nothing will
  // change, so there is nothing to transition — and nothing to wait for.
  if (!start || !canTransition() || target.origin !== window.location.origin || urlKey(target) === urlKey(window.location)) {
    runAll(onLeave)
    navigate()
    return
  }
  // A second navigation while one is still animating: finish the first at once.
  active?.skipTransition()

  const root = document.documentElement
  const fromKey = urlKey(window.location)
  const outgoing: HTMLElement[] = []
  const incoming: HTMLElement[] = []
  let shared: { id: string; into: 'hero' | 'card' } | null = null

  // Forward: the clicked link holds a product card's photo.
  const card = clicked instanceof HTMLElement ? clicked.querySelector<HTMLElement>(`[${VT_PRODUCT_ATTR}]`) : null
  const cardId = card?.getAttribute(VT_PRODUCT_ATTR)
  if (card && cardId && visible(card)) {
    shared = { id: cardId, into: 'hero' }
    setName(card, cardId, outgoing)
  } else {
    // Back up the hierarchy from a product page: its gallery may find its card.
    const hero = document.querySelector<HTMLElement>(`[${VT_PRODUCT_HERO_ATTR}]`)
    const heroId = hero?.getAttribute(VT_PRODUCT_HERO_ATTR)
    if (hero && heroId && visible(hero)) {
      shared = { id: heroId, into: 'card' }
      setName(hero, heroId, outgoing)
    }
  }

  root.dataset.vt = transitionDirection(window.location.pathname, target.pathname)
  // The new page opens from what was tapped: the centre of the link or card,
  // as a point in the viewport (globals.css → "Opening from the tap").
  const origin = clicked && visible(clicked) ? clicked.getBoundingClientRect() : null
  if (origin) {
    root.style.setProperty('--vt-ox', `${Math.round(origin.left + origin.width / 2)}px`)
    root.style.setProperty('--vt-oy', `${Math.round(origin.top + origin.height / 2)}px`)
  }

  const cleanup = () => {
    clearNames(outgoing)
    clearNames(incoming)
    delete root.dataset.vt
    delete root.dataset.vtArrive
    root.style.removeProperty('--vt-ox')
    root.style.removeProperty('--vt-oy')
  }

  let navigated = false
  const go = () => {
    runAll(onLeave)
    if (navigated) return
    navigated = true
    navigate()
  }

  let transition: ViewTransitionLike
  try {
    transition = start(async () => {
      // The outgoing picture is taken. Its names are released before the new
      // page renders, so an element present on both sides is never named twice.
      clearNames(outgoing)
      runAll(onLeave)
      if (!(await addressChanged(fromKey, go))) {
        // Still loading: let go of the screen without animating the old page
        // into itself. The new one arrives with the ordinary fade when ready.
        transition.skipTransition()
        return
      }
      // Only now, with the old page photographed: the arrival cascade
      // (globals.css) must not touch the picture of the page being left.
      root.dataset.vtArrive = shared?.into === 'hero' ? 'product' : 'page'
      if (!shared) return
      if (shared.into === 'hero') {
        const hero = document.querySelector<HTMLElement>(selector(VT_PRODUCT_HERO_ATTR, shared.id))
        if (hero && visible(hero)) {
          // Give the larger gallery photo a moment to decode, so the card's
          // picture does not travel into an empty frame — but never long.
          const img = hero.querySelector('img')
          if (img && !img.complete) await settle(img.decode(), IMAGE_BUDGET_MS)
          setName(hero, shared.id, incoming)
        }
      } else {
        const cards = document.querySelectorAll<HTMLElement>(selector(VT_PRODUCT_ATTR, shared.id))
        const match = Array.from(cards).find(visible)
        if (match) setName(match, shared.id, incoming)
      }
    })
  } catch {
    cleanup()
    go()
    return
  }

  active = transition
  // A skipped transition rejects these; the navigation itself is unaffected.
  transition.ready.catch(() => {})
  transition.updateCallbackDone.catch(() => go())
  transition.finished
    .catch(() => {})
    .then(() => {
      cleanup()
      if (active === transition) active = null
    })
  // Belt and braces: the browser always runs the update callback, but if it
  // ever does not, the visitor still gets where they were going.
  setTimeout(go, MAX_WAIT_MS + 500)
}

/**
 * A change to results shown in place (catalogue filters, sort): the results
 * area crossfades and settles to its new height while the rest of the page —
 * the controls just used — changes at once. Falls back to an instant update.
 * Not for continuous input (price fields, sliders): one transition per click.
 */
export function resultsTransition(update: () => void): void {
  const start = startFn()
  if (!start || !canTransition() || active || !document.querySelector(`[${VT_RESULTS_ATTR}]`)) {
    update()
    return
  }
  const root = document.documentElement
  root.dataset.vt = 'results'
  let done = false
  const apply = () => {
    if (done) return
    done = true
    flushSync(update)
  }
  let transition: ViewTransitionLike
  try {
    transition = start(apply)
  } catch {
    delete root.dataset.vt
    apply()
    return
  }
  active = transition
  transition.ready.catch(() => {})
  transition.updateCallbackDone.catch(() => apply())
  transition.finished
    .catch(() => {})
    .then(() => {
      delete root.dataset.vt
      if (active === transition) active = null
    })
}
