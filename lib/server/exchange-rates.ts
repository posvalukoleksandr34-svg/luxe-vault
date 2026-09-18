import 'server-only'

import { EXCHANGE_RATES, setRates, type ExchangeRates } from '@/lib/currency'

/**
 * Live exchange rates: ECB reference rates via Frankfurter (free, no key),
 * cached in memory per server instance.
 *
 * Freshness policy — rates move well under 1% a day, so a stale figure is
 * safe for a while, but a card charge must never wait on a slow feed:
 *
 *   < 1 hour old    served as is;
 *   1 – 24 hours    served as is, and refreshed in the BACKGROUND for the
 *                   next caller (stale-while-revalidate);
 *   > 24 hours      the caller waits for a refresh (5 s timeout);
 *   feed down       the last good snapshot, or the fallback table in
 *                   lib/currency.ts, and another attempt in 5 minutes.
 *
 * Every snapshot is installed with setRates(), so chargeAmount() and
 * formatMoney() on the server use exactly the figures /api/rates hands the
 * browser. USDT is pegged to the US dollar.
 *
 * A figure more than 25% away from the fallback table is treated as a broken
 * feed, not a market move, and rejected — a bad upstream value must never
 * reach a card charge.
 */
const FEED_URL = 'https://api.frankfurter.dev/v1/latest?base=CHF&symbols=EUR,USD'
const FRESH_MS = 60 * 60 * 1000
const MAX_STALE_MS = 24 * 60 * 60 * 1000
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000
const MAX_DRIFT = 0.25

export type RatesSnapshot = {
  rates: ExchangeRates
  source: 'live' | 'fallback'
  /** The ECB publication date of a live snapshot. */
  date: string | null
  fetchedAt: number
}

let snapshot: RatesSnapshot | null = null
let inflight: Promise<RatesSnapshot> | null = null
let nextAttemptAt = 0

function plausible(value: unknown, baseline: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    Math.abs(value - baseline) / baseline <= MAX_DRIFT
  )
}

async function fetchSnapshot(): Promise<RatesSnapshot> {
  try {
    const res = await fetch(FEED_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { date?: unknown; rates?: { EUR?: unknown; USD?: unknown } }
    const eur = data.rates?.EUR
    const usd = data.rates?.USD
    if (!plausible(eur, EXCHANGE_RATES.EUR) || !plausible(usd, EXCHANGE_RATES.USD)) {
      throw new Error(`implausible rates EUR=${String(eur)} USD=${String(usd)}`)
    }
    const next: RatesSnapshot = {
      rates: { CHF: 1, EUR: eur, USD: usd, USDT: usd },
      source: 'live',
      date: typeof data.date === 'string' ? data.date.slice(0, 10) : null,
      fetchedAt: Date.now(),
    }
    snapshot = next
    setRates(next.rates)
    return next
  } catch (e) {
    console.warn('[exchange-rates] feed unavailable, keeping previous rates:', (e as Error).message)
    nextAttemptAt = Date.now() + RETRY_AFTER_FAILURE_MS
    if (snapshot) return snapshot
    const fallback: RatesSnapshot = { rates: EXCHANGE_RATES, source: 'fallback', date: null, fetchedAt: 0 }
    setRates(fallback.rates)
    return fallback
  } finally {
    inflight = null
  }
}

function refresh(): Promise<RatesSnapshot> {
  if (!inflight) inflight = fetchSnapshot()
  return inflight
}

/** The rates to use now, per the freshness policy above. Never throws. */
export async function getExchangeRates(): Promise<RatesSnapshot> {
  const now = Date.now()
  const age = snapshot ? now - snapshot.fetchedAt : Infinity
  const mayRetry = now >= nextAttemptAt

  if (snapshot && age < FRESH_MS) return snapshot
  if (snapshot && age < MAX_STALE_MS) {
    if (mayRetry) void refresh()
    return snapshot
  }
  if (!mayRetry) {
    return snapshot ?? { rates: EXCHANGE_RATES, source: 'fallback', date: null, fetchedAt: 0 }
  }
  return refresh()
}
