'use client'

import { hasConsent } from '@/lib/cookie-consent'

/**
 * Google Analytics 4 and the Meta Pixel — loaded only with consent, and only
 * when their IDs are configured.
 *
 * The IDs come from NEXT_PUBLIC_GA_MEASUREMENT_ID and
 * NEXT_PUBLIC_FACEBOOK_PIXEL_ID, inlined at build. They are identifiers, not
 * secrets: both vendors publish them in every page that uses them. Unset, the
 * vendor is never loaded and this module does nothing.
 *
 * Consent is per vendor: GA4 is "analytics", the Meta Pixel "marketing" — the
 * two categories the cookie banner offers. Nothing is loaded, queued or
 * cookied before the matching category is granted, and withdrawing it stops
 * the vendor and expires its cookies (applyConsent).
 *
 * Loading: each vendor's script is injected with `async` into <head> — never
 * render-blocking — the first time it is needed after consent: when the page
 * goes idle (AnalyticsManager) or when an event is sent, whichever is first.
 * Each vendor's own command queue is installed synchronously, so an event
 * raised before the script arrives is replayed by it, not lost.
 */

export const GA_MEASUREMENT_ID = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? '').trim()
export const FACEBOOK_PIXEL_ID = (process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID ?? '').trim()

type Payload = Record<string, unknown>

type Fbq = {
  (...args: unknown[]): void
  callMethod?: (...args: unknown[]) => void
  queue: unknown[]
  push?: Fbq
  loaded?: boolean
  version?: string
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    fbq?: Fbq
    _fbq?: Fbq
  }
}

function injectScript(id: string, src: string): void {
  if (document.getElementById(id)) return
  const script = document.createElement('script')
  script.id = id
  script.async = true
  script.src = src
  document.head.appendChild(script)
}

/** Expires first-party cookies by name prefix, on this host and its parent domain. */
function expireCookies(prefixes: string[]): void {
  const host = window.location.hostname
  const parent = host.split('.').slice(-2).join('.')
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0].trim()
    if (!prefixes.some((p) => name.startsWith(p))) continue
    document.cookie = `${name}=; Max-Age=0; path=/`
    document.cookie = `${name}=; Max-Age=0; path=/; domain=${host}`
    document.cookie = `${name}=; Max-Age=0; path=/; domain=.${parent}`
  }
}

// ---------------------------------------------------------------------- GA4

let gaStarted = false

/** gtag's queue and config, then gtag.js itself. True when GA4 is live. */
function loadGa(): boolean {
  if (!GA_MEASUREMENT_ID || !hasConsent('analytics')) return false
  if (!gaStarted) {
    gaStarted = true
    window.dataLayer = window.dataLayer ?? []
    window.gtag = function gtag() {
      // gtag.js reads Arguments objects from the queue — the official snippet.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments as unknown as Payload)
    }
    window.gtag('js', new Date())
    // The first page_view is sent by config; later client-side navigations
    // are counted by GA4's enhanced measurement (browser history events, on
    // by default for a web data stream).
    window.gtag('config', GA_MEASUREMENT_ID)
    injectScript('lv-gtag', `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`)
  }
  ;(window as unknown as Payload)[`ga-disable-${GA_MEASUREMENT_ID}`] = false
  return true
}

// --------------------------------------------------------------- Meta Pixel

let metaStarted = false

/** Meta's queue stub (the official snippet), init and first PageView, then fbevents.js. */
function loadMeta(): boolean {
  if (!FACEBOOK_PIXEL_ID || !hasConsent('marketing')) return false
  if (!metaStarted) {
    metaStarted = true
    if (!window.fbq) {
      const fbq = function () {
        // eslint-disable-next-line prefer-rest-params
        const args = arguments
        if (fbq.callMethod) fbq.callMethod.apply(fbq, args as unknown as unknown[])
        else fbq.queue.push(args)
      } as unknown as Fbq
      fbq.queue = []
      fbq.push = fbq
      fbq.loaded = true
      fbq.version = '2.0'
      if (!window._fbq) window._fbq = fbq
      window.fbq = fbq
    }
    window.fbq('init', FACEBOOK_PIXEL_ID)
    window.fbq('track', 'PageView')
    injectScript('lv-fbevents', 'https://connect.facebook.net/en_US/fbevents.js')
  } else {
    window.fbq?.('consent', 'grant')
  }
  return true
}

/** GA4 event names → Meta standard events. Unlisted events stay GA4-only. */
const META_EVENTS: Record<string, string> = {
  view_item: 'ViewContent',
  add_to_cart: 'AddToCart',
  begin_checkout: 'InitiateCheckout',
  add_payment_info: 'AddPaymentInfo',
  purchase: 'Purchase',
  search: 'Search',
  sign_up: 'CompleteRegistration',
}

function toMeta(event: string, params: Payload): Payload {
  const items = Array.isArray(params.items) ? (params.items as Payload[]) : []
  return {
    currency: params.currency,
    value: params.value,
    content_type: 'product',
    content_ids: items.map((i) => i.item_id),
    contents: items.map((i) => ({ id: i.item_id, quantity: i.quantity, item_price: i.price })),
    num_items: items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0),
    ...(event === 'search' ? { search_string: params.search_term } : {}),
  }
}

// ------------------------------------------------------------------ public

/**
 * Sends one event to whatever the visitor has consented to.
 *
 * Analytics consent: GA4 when configured; otherwise the plain dataLayer push
 * a tag manager reads (the shop's behaviour before GA4 existed). Marketing
 * consent: the matching Meta standard event, with an eventID derived from the
 * transaction id so a purchase is counted once.
 */
export function dispatch(event: string, params: Payload): void {
  if (hasConsent('analytics')) {
    if (loadGa()) {
      window.gtag!('event', event, params)
    } else {
      window.dataLayer = window.dataLayer ?? []
      window.dataLayer.push({ event, ...params })
    }
  }

  const metaEvent = META_EVENTS[event]
  if (metaEvent && hasConsent('marketing') && loadMeta()) {
    const id = typeof params.transaction_id === 'string' ? params.transaction_id : undefined
    window.fbq!('track', metaEvent, toMeta(event, params), id ? { eventID: `${metaEvent}.${id}` } : undefined)
  }
}

/**
 * Brings each vendor in line with the stored consent: loads what was granted,
 * stops what was withdrawn and expires its cookies. Called when the page goes
 * idle and on every consent change.
 */
export function applyConsent(): void {
  if (typeof window === 'undefined') return

  if (GA_MEASUREMENT_ID && !loadGa()) {
    // Google's documented opt-out switch: gtag.js sends nothing while it is set.
    ;(window as unknown as Payload)[`ga-disable-${GA_MEASUREMENT_ID}`] = true
    expireCookies(['_ga', '_gid'])
  }

  if (FACEBOOK_PIXEL_ID && !loadMeta()) {
    if (metaStarted) window.fbq?.('consent', 'revoke')
    expireCookies(['_fbp', '_fbc'])
  }
}

/** A client-side navigation, for the Meta Pixel (GA4 counts these itself). */
export function trackMetaPageView(): void {
  if (metaStarted && hasConsent('marketing')) window.fbq?.('track', 'PageView')
}
