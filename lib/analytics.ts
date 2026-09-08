'use client'

import { CONSENT_EVENT, hasConsent } from '@/lib/cookie-consent'
import type { CartItem, Order, Product } from '@/lib/types'

/**
 * Commerce analytics.
 *
 * The shop previously emitted nothing at all — no GA4, no Plausible, no
 * dataLayer, not one event. It could not tell you its own conversion rate,
 * which basket step people abandon, or whether a promotion did anything.
 *
 * CONSENT IS THE GATE, NOT A BANNER
 *
 * Every function here checks `hasConsent('analytics')` at call time. Under
 * GDPR/ePrivacy a non-essential tag may not run before consent, and a banner
 * that records a preference without gating anything is decoration. Events
 * raised before consent are DROPPED rather than queued — replaying a
 * pre-consent session the moment someone clicks "accept" is exactly the
 * tracking they had not yet agreed to.
 *
 * NO VENDOR IS BUNDLED
 *
 * This file deliberately loads nothing. It normalises events into the GA4
 * ecommerce shape — the vocabulary every analytics product understands — and
 * pushes them to `window.dataLayer`, which is what a tag manager reads. Adding
 * GA4, Plausible or PostHog later is a script tag in the layout plus a consent
 * entry; none of the call sites change. Shipping a vendor SDK on a hunch would
 * cost every visitor the download whether or not you ever look at the data.
 *
 * Currency is hardcoded CHF to match formatPrice() and the orders table.
 */

/** GA4 ecommerce event names, which most tools map natively. */
export type AnalyticsEvent =
  | 'page_view'
  | 'search'
  | 'view_item'
  | 'view_item_list'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'view_cart'
  | 'begin_checkout'
  | 'add_payment_info'
  | 'purchase'
  | 'refund'
  | 'login'
  | 'sign_up'

type Payload = Record<string, unknown>

declare global {
  interface Window {
    dataLayer?: Payload[]
  }
}

const CURRENCY = 'CHF'

/** GA4's item shape. Built from a cart line or a product, never hand-rolled at
 *  a call site, so every event describes an item the same way. */
function itemFromCart(item: CartItem, index?: number): Payload {
  return {
    item_id: item.productId,
    item_name: item.name,
    item_variant: [item.size, item.color].filter(Boolean).join(' / ') || undefined,
    price: item.price,
    quantity: item.qty,
    ...(index === undefined ? {} : { index }),
  }
}

function itemFromProduct(product: Product, name: string): Payload {
  return {
    item_id: product.id,
    item_name: name,
    item_category: product.category,
    item_list_name: product.group,
    price: product.price,
    quantity: 1,
  }
}

/**
 * The one place an event reaches the outside world.
 *
 * Exported so a call site that needs an event this module has no helper for
 * can still go through the consent gate rather than around it.
 */
export function track(event: AnalyticsEvent, params: Payload = {}): void {
  if (typeof window === 'undefined') return
  // Checked per call, not cached: consent can be withdrawn from the footer at
  // any moment and the next event must respect that immediately.
  if (!hasConsent('analytics')) return

  window.dataLayer = window.dataLayer ?? []
  window.dataLayer.push({ event, ...params })
}

// ------------------------------------------------------------------ helpers

export function trackPageView(path: string, title?: string): void {
  track('page_view', { page_path: path, page_title: title })
}

export function trackSearch(term: string, resultCount: number): void {
  const trimmed = term.trim()
  // A keystroke is not a search. Callers debounce, but guarding here too means
  // no call site can accidentally emit one event per character typed.
  if (trimmed.length < 2) return
  track('search', { search_term: trimmed, results: resultCount })
}

export function trackViewItem(product: Product, name: string): void {
  track('view_item', {
    currency: CURRENCY,
    value: product.price,
    items: [itemFromProduct(product, name)],
  })
}

export function trackAddToCart(item: Omit<CartItem, 'key'>): void {
  track('add_to_cart', {
    currency: CURRENCY,
    value: item.price * item.qty,
    items: [itemFromCart({ ...item, key: '' })],
  })
}

export function trackRemoveFromCart(item: CartItem): void {
  track('remove_from_cart', {
    currency: CURRENCY,
    value: item.price * item.qty,
    items: [itemFromCart(item)],
  })
}

export function trackViewCart(cart: CartItem[], value: number): void {
  track('view_cart', { currency: CURRENCY, value, items: cart.map(itemFromCart) })
}

export function trackBeginCheckout(cart: CartItem[], value: number): void {
  track('begin_checkout', { currency: CURRENCY, value, items: cart.map(itemFromCart) })
}

export function trackAddPaymentInfo(value: number, paymentType: string): void {
  track('add_payment_info', { currency: CURRENCY, value, payment_type: paymentType })
}

/**
 * A completed purchase.
 *
 * `transaction_id` is the order id, which is what makes the event idempotent
 * downstream: a customer who refreshes the thank-you page sends it twice, and
 * every analytics product de-duplicates on that field. Without it, revenue is
 * double-counted by exactly the people most likely to refresh.
 */
export function trackPurchase(order: Order): void {
  track('purchase', {
    transaction_id: order.id,
    currency: CURRENCY,
    value: order.total,
    shipping: order.shippingCost ?? 0,
    tax: order.tax ?? 0,
    coupon: order.promo,
    items: order.items.map(itemFromCart),
  })
}

export function trackRefund(order: Order, amount: number): void {
  track('refund', {
    transaction_id: order.id,
    currency: CURRENCY,
    value: amount,
  })
}

export function trackLogin(method = 'password'): void {
  track('login', { method })
}

export function trackSignUp(method = 'password'): void {
  track('sign_up', { method })
}

/**
 * Runs `fn` whenever analytics consent is granted, including immediately if it
 * already is.
 *
 * This is where a vendor script belongs — loaded in response to consent, never
 * at module scope. Returns an unsubscribe function.
 */
export function onAnalyticsConsent(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  let ran = false
  const maybeRun = () => {
    if (ran || !hasConsent('analytics')) return
    ran = true
    fn()
  }

  maybeRun()
  window.addEventListener(CONSENT_EVENT, maybeRun)
  return () => window.removeEventListener(CONSENT_EVENT, maybeRun)
}
