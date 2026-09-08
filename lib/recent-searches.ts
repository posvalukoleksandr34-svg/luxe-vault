/**
 * The last few things this person searched for.
 *
 * Deliberately local-only. A search history is a sensitive little record — it
 * says what someone was looking for and did not buy — and there is no reason
 * for it to reach a server that has no use for it. The POPULAR list is
 * aggregate and lives in Postgres; this one never leaves the browser.
 *
 * Every access is wrapped in try/catch: localStorage throws outright in some
 * contexts (Safari private mode, embedded webviews, storage disabled by
 * policy) rather than returning null, and a search box must not be taken down
 * by a storage preference.
 */

const STORAGE_KEY = 'lv.recent-searches.v1'
const MAX = 6

export function readRecentSearches(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((t): t is string => typeof t === 'string' && t.trim().length >= 2)
      .slice(0, MAX)
  } catch {
    return []
  }
}

export function rememberSearch(term: string): void {
  if (typeof window === 'undefined') return
  const trimmed = term.trim()
  if (trimmed.length < 2) return

  try {
    // Case-insensitive de-duplication, most recent first: searching the same
    // thing twice should move it up the list, not appear twice in it.
    const existing = readRecentSearches().filter(
      (t) => t.toLowerCase() !== trimmed.toLowerCase(),
    )
    const next = [trimmed, ...existing].slice(0, MAX)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota or storage blocked. The search still works; it is simply not
    // remembered.
  }
}

export function clearRecentSearches(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing useful to do — the caller has already updated its own state.
  }
}
