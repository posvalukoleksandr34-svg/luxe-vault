// Curated list of crypto payment options we'd like to offer. NOWPayments'
// exact ticker spelling for a given coin/network can vary by account and
// changes over time, so each option lists candidate tickers in priority
// order; resolveAvailableOptions() only surfaces an option (with whichever
// candidate actually matched) if NOWPayments confirms it's payable right
// now. An option with no matching ticker is simply omitted — never shown
// broken, never guessed.
export type CryptoOption = {
  id: string
  label: string
  network: string
  candidates: string[]
}

export const CRYPTO_OPTIONS: CryptoOption[] = [
  { id: 'usdt-trc20', label: 'USDT', network: 'TRC-20 · Tron', candidates: ['usdttrc20', 'usdt_trc20', 'usdttrx'] },
  { id: 'usdt-arbitrum', label: 'USDT', network: 'Arbitrum', candidates: ['usdtarb', 'usdtarbitrum', 'usdt_arb'] },
  { id: 'usdc-arbitrum', label: 'USDC', network: 'Arbitrum', candidates: ['usdcarb', 'usdcarbitrum', 'usdc_arb'] },
  { id: 'usdt-erc20', label: 'USDT', network: 'ERC-20 · Ethereum', candidates: ['usdterc20', 'usdt_erc20'] },
  { id: 'btc', label: 'Bitcoin', network: 'BTC', candidates: ['btc'] },
  { id: 'eth', label: 'Ethereum', network: 'ERC-20 · Ethereum', candidates: ['eth'] },
]

export type ResolvedCryptoOption = CryptoOption & { ticker: string }

export function resolveAvailableOptions(availableTickers: string[]): ResolvedCryptoOption[] {
  const set = new Set(availableTickers.map((t) => t.toLowerCase()))
  const resolved: ResolvedCryptoOption[] = []
  for (const option of CRYPTO_OPTIONS) {
    const ticker = option.candidates.find((c) => set.has(c))
    if (ticker) resolved.push({ ...option, ticker })
  }
  return resolved
}

/** Re-validates a client-supplied (id, ticker) pair against the live,
 * resolved option list before ever creating a real payment — the create
 * route must never trust a ticker string handed to it by the browser. */
export function findResolvedOption(
  resolvedOptions: ResolvedCryptoOption[],
  id: string,
  ticker: string,
): ResolvedCryptoOption | null {
  return resolvedOptions.find((o) => o.id === id && o.ticker === ticker) ?? null
}
