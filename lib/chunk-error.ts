/**
 * A piece of the site's JavaScript that did not download — and what to do
 * about it.
 *
 * Next splits the site into chunks the browser fetches as it needs them: when
 * a page hydrates, on a client-side navigation, and when a lazy part (the cart
 * drawer, the chat, the cookie banner) is first used. If that request hangs or
 * fails, webpack throws a ChunkLoadError:
 *
 *   Loading chunk 1043 failed.
 *   (timeout: https://www.luxe-vault.store/_next/static/chunks/1043-….js)
 *
 * "timeout" means the request hung for two minutes (a weak mobile connection,
 * a tab put to sleep, a stalled connection on the way); "error" means it
 * failed, which is also what an old tab sees after a deploy removed the files
 * its page was built with. Neither is a bug in the page, and neither is the
 * database — but the error used to reach the page's error boundary, which
 * replaced the whole page with "the catalogue is unavailable" and alerted the
 * owner as a "UI crash".
 *
 * The cure is a full reload: a fresh page with fresh chunk addresses, and a
 * new download. React also remembers a failed lazy import for the life of the
 * page, so without a reload a second attempt cannot succeed. So: reload once,
 * automatically; if it fails again within a short window, stop (no loop),
 * say it is a connection problem, and report it as one.
 */

/** Whether `error` is a failed download of a JS or CSS chunk. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  if (name === 'ChunkLoadError') return true
  const text = typeof message === 'string' ? message : ''
  return (
    /Loading (CSS )?chunk \S+ failed/i.test(text) ||
    // Native dynamic import(), in Chromium, Firefox and Safari wording.
    /Failed to fetch dynamically imported module/i.test(text) ||
    /error loading dynamically imported module/i.test(text) ||
    /Importing a module script failed/i.test(text)
  )
}

/** A reload within this long of the previous one is not tried again. */
export const CHUNK_RELOAD_WINDOW_MS = 30_000

/** Pure: may the page reload itself now, given when it last did for this? */
export function mayReloadForChunk(lastReloadAt: number | null, now: number): boolean {
  return lastReloadAt === null || !Number.isFinite(lastReloadAt) || now - lastReloadAt > CHUNK_RELOAD_WINDOW_MS
}

const RELOAD_KEY = 'lv.chunk-reload-at'

/**
 * Reloads the page once to recover from a chunk that did not download.
 * Returns true when a reload has been started (render nothing more), false
 * when it must not — it already reloaded moments ago, or the browser keeps no
 * session storage, where a reload could repeat forever.
 */
export function reloadOnceForChunkError(now = Date.now()): boolean {
  try {
    if (typeof window === 'undefined') return false
    const raw = window.sessionStorage.getItem(RELOAD_KEY)
    const last = raw === null ? null : Number(raw)
    if (!mayReloadForChunk(last, now)) return false
    window.sessionStorage.setItem(RELOAD_KEY, String(now))
    window.location.reload()
    return true
  } catch {
    return false
  }
}

/** The alert context for a chunk that did not download — not a "UI crash". */
export const CHUNK_ERROR_CONTEXT = 'Chunk load failed (network)'
