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
export async function fetchAvailableTickers(): Promise<string[]> {
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

export async function getPaymentStatus(paymentId: string) {
  return request<NowPaymentsPayment>(`/payment/${encodeURIComponent(paymentId)}`)
}

/** NOWPayments' documented IPN scheme: HMAC-SHA512 of the payload with its
 * keys sorted (recursively) and JSON-stringified with no extra whitespace,
 * signed with the IPN secret and sent as `x-nowpayments-sig`. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
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
    case 'refunded':
      return 'failed'
    default:
      return 'pending_payment'
  }
}
