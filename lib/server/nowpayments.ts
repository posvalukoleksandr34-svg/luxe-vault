// Server-only client for the NOWPayments crypto payment gateway. Never
// import this from a 'use client' component — the API key must never reach
// the browser bundle.
//
// This module deliberately never invents a wallet address, exchange rate,
// or payment status on its own. Every address/amount shown to a customer
// comes straight from a NOWPayments API response, and every "paid" state
// change is driven by their signature-verified webhook — see
// app/api/payments/crypto/webhook/route.ts. That boundary is intentional:
// fabricating any of that here would risk sending a customer's real crypto
// to an address nobody controls, or marking an unpaid order as paid.

import 'server-only'

import type { PaymentStatus } from '@/lib/types'

const API_BASE = 'https://api.nowpayments.io/v1'

const API_KEY = process.env.NOWPAYMENTS_API_KEY || ''
const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET || ''

// The fiat currency our order totals are actually denominated in (the store
// strictly prices everything in CHF — see formatPrice in lib/store.tsx).
// NOWPayments converts this to the chosen crypto at their own live rate —
// we never do that math ourselves. This MUST always match the currency the
// numeric total is actually in: sending the right number under the wrong
// currency code would silently over- or under-charge the customer. If your
// NOWPayments account doesn't support CHF pricing, convert `price_amount`
// server-side using a real FX rate source before calling createPayment,
// rather than changing this to a currency the total isn't actually in.
export const PRICE_CURRENCY = 'chf'

export function isConfigured(): boolean {
  return Boolean(API_KEY)
}

export function isIpnConfigured(): boolean {
  return Boolean(IPN_SECRET)
}

type NowPaymentsError = { message: string; status?: number }

/** A payment gateway that stops answering must not hold a checkout request
 *  open until the platform kills the function; the caller's error path (a
 *  retryable "network unavailable") is the better outcome. */
const REQUEST_TIMEOUT_MS = 15_000

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: NowPaymentsError }> {
  if (!API_KEY) {
    return { ok: false, error: { message: 'NOWPayments API key is not configured' } }
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      cache: 'no-store',
      signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        error: { message: data?.message || `NOWPayments request failed (${res.status})`, status: res.status },
      }
    }
    return { ok: true, data: data as T }
  } catch (err) {
    return { ok: false, error: { message: err instanceof Error ? err.message : 'Network error' } }
  }
}

/** All currency tickers NOWPayments supports account-wide. Used to check
 * which of our curated crypto options are actually payable right now,
 * rather than hardcoding ticker strings that may not match their API. */
/**
 * The enabled-coin list changes only when the merchant edits their account, but
 * it is read by a public endpoint on every checkout visit. Held per instance
 * for ten minutes, so page views cannot be turned into a flood of gateway
 * calls, and checkout does not wait on the gateway for a list it already has.
 * Only a non-empty answer is kept: a failed lookup is retried next time.
 */
const TICKERS_TTL_MS = 10 * 60 * 1000
let tickersCache: { at: number; tickers: string[] } | null = null

export async function fetchAvailableTickers(): Promise<string[]> {
  if (tickersCache && Date.now() - tickersCache.at < TICKERS_TTL_MS) return tickersCache.tickers
  const tickers = await fetchTickersUncached()
  if (tickers.length > 0) tickersCache = { at: Date.now(), tickers }
  return tickers
}

async function fetchTickersUncached(): Promise<string[]> {
  // /v1/merchant/coins reflects the currencies enabled on this specific
  // merchant account; fall back to the full public currency list if that
  // endpoint isn't available on this account tier.
  const merchant = await request<{ selectedCurrencies: string[] }>('/merchant/coins')
  if (merchant.ok && Array.isArray(merchant.data?.selectedCurrencies)) {
    return merchant.data.selectedCurrencies.map((c) => c.toLowerCase())
  }
  const all = await request<{ currencies: string[] }>('/currencies')
  if (all.ok && Array.isArray(all.data?.currencies)) {
    return all.data.currencies.map((c) => c.toLowerCase())
  }
  return []
}

export type CreatePaymentParams = {
  orderId: string
  amount: number
  payCurrency: string
  description: string
  callbackUrl: string
}

export type NowPaymentsPayment = {
  payment_id: string
  payment_status: string
  pay_address: string
  price_amount: number
  price_currency: string
  pay_amount: number
  pay_currency: string
  order_id: string
  order_description: string
  expiration_estimate_date?: string
}

/**
 * A payment as NOWPayments' API reports it NOW — the canonical record the
 * webhook decides on. The IPN that announced a change is signed, but it is a
 * message about a moment: it can be replayed, and it can arrive out of order.
 */
export type NowPaymentsPaymentState = {
  payment_id: number | string
  payment_status: string
  order_id: string | null
  price_amount: number
  price_currency: string
  pay_amount: number
  pay_currency: string
  actually_paid: number | null
}

export async function getPayment(paymentId: string) {
  if (!/^\d{1,20}$/.test(paymentId)) {
    return { ok: false as const, error: { message: 'Malformed NOWPayments payment id' } }
  }
  return request<NowPaymentsPaymentState>(`/payment/${paymentId}`)
}

/** How far below the quoted coin amount a "paid" payment may land (network
 *  rounding); anything short of it is not treated as paid. */
const UNDERPAY_TOLERANCE = 0.005

/**
 * Why this provider record must NOT settle this order, or null when it may.
 * Every value compared comes from our database (written when the payment was
 * created from the stored order total) or from NOWPayments' own API — never
 * from the request.
 */
export function cryptoPaymentMismatch(
  order: { id: string; total: number; paymentId?: string | null; paymentCurrency?: string | null },
  payment: NowPaymentsPaymentState,
): string | null {
  if (String(payment.payment_id) !== String(order.paymentId ?? '')) return 'payment id is not the order\'s current payment'
  if ((payment.order_id ?? '') !== order.id) return `payment is for order "${payment.order_id ?? ''}"`
  if ((payment.price_currency ?? '').toLowerCase() !== PRICE_CURRENCY) return `priced in ${payment.price_currency}, not ${PRICE_CURRENCY}`
  if (!(Math.abs(Number(payment.price_amount) - Number(order.total)) <= 0.01)) {
    return `priced at ${payment.price_amount}, order total is ${order.total}`
  }
  if (order.paymentCurrency && (payment.pay_currency ?? '').toLowerCase() !== order.paymentCurrency.toLowerCase()) {
    return `paid in ${payment.pay_currency}, order expects ${order.paymentCurrency}`
  }
  return null
}

/** Whether the coins that arrived cover the quoted amount. */
export function cryptoFullyPaid(payment: NowPaymentsPaymentState): boolean {
  const paid = Number(payment.actually_paid)
  const due = Number(payment.pay_amount)
  return Number.isFinite(paid) && Number.isFinite(due) && due > 0 && paid >= due * (1 - UNDERPAY_TOLERANCE)
}

export async function createPayment(params: CreatePaymentParams) {
  return request<NowPaymentsPayment>('/payment', {
    method: 'POST',
    body: JSON.stringify({
      price_amount: params.amount,
      price_currency: PRICE_CURRENCY,
      pay_currency: params.payCurrency,
      order_id: params.orderId,
      order_description: params.description,
      ipn_callback_url: params.callbackUrl,
    }),
  })
}

/** NOWPayments' documented IPN scheme: HMAC-SHA512 of the payload with its
 * keys sorted (recursively) and JSON-stringified with no extra whitespace,
 * signed with the IPN secret and sent as `x-nowpayments-sig`. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    // No prototype: a "__proto__" key in the payload is then an ordinary own
    // property that survives into the canonical JSON — on a plain {} the
    // assignment would set the object's prototype instead and drop the key.
    const sorted: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

export async function verifyIpnSignature(
  payload: unknown,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!IPN_SECRET || !signatureHeader) return false
  const canonical = JSON.stringify(sortKeysDeep(payload))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(IPN_SECRET),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical))
  const expected = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  if (expected.length !== signatureHeader.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i)
  }
  return diff === 0
}

/** Maps a NOWPayments payment_status to our own, coarser PaymentStatus. */
export function toPaymentStatus(nowPaymentsStatus: string): PaymentStatus {
  switch (nowPaymentsStatus) {
    case 'waiting':
      return 'pending_payment'
    case 'confirming':
    case 'sending':
    case 'partially_paid':
      return 'confirming'
    case 'confirmed':
    case 'finished':
      return 'paid'
    case 'expired':
      return 'expired'
    case 'failed':
      return 'failed'
    // Money that came back — a refund, never "failed": the state machine lets
    // a refund follow a payment, and refuses a failure after one.
    case 'refunded':
      return 'refunded'
    default:
      return 'pending_payment'
  }
}
