/*
 * LUXE VAULT service worker — deliberately small.
 *
 * What it caches: only files that never change under the same URL — Next's
 * content-hashed bundles (/_next/static), the self-hosted fonts, the app
 * icons. Cache-first, so repeat visits and the installed app open instantly.
 *
 * What it never caches: pages, API responses, product images. Prices, stock,
 * the cart and the signed-in session must always be live, and a stale page
 * in a shop is a wrong price. Those go straight to the network.
 *
 * Offline: a page navigation that fails with no network shows /offline.html
 * instead of the browser's error screen.
 *
 * Bump VERSION to drop every cache on the next visit.
 */
const VERSION = 'v2' // v2: new app icons (keyhole mark replaced the LV monogram)
const STATIC_CACHE = `lv-static-${VERSION}`
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png']
const MAX_STATIC_ENTRIES = 200

const CACHE_FIRST = [/^\/_next\/static\//, /^\/fonts\//, /^\/icons\//]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lv-') && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function trim(cache) {
  const keys = await cache.keys()
  // Oldest first: Cache Storage keeps insertion order.
  for (let i = 0; i < keys.length - MAX_STATIC_ENTRIES; i++) await cache.delete(keys[i])
}

/*
 * The cache is an optimisation, never a dependency. It used to be awaited:
 * the page got a chunk only after its whole body had been written to Cache
 * Storage, and a failed write (quota, private mode, a full disk) failed the
 * chunk itself — a "Loading chunk … failed" for a file the network had
 * delivered. Now the response goes to the page at once, the copy is stored in
 * the background (kept alive by waitUntil), and any cache error is ignored.
 */
async function cacheFirst(event, request) {
  let cache = null
  try {
    cache = await caches.open(STATIC_CACHE)
    const hit = await cache.match(request)
    if (hit) return hit
  } catch {
    cache = null
  }
  const response = await fetch(request)
  if (cache && response.ok && response.type === 'basic') {
    const copy = response.clone()
    event.waitUntil(
      cache
        .put(request, copy)
        .then(() => trim(cache))
        .catch(() => {}),
    )
  }
  return response
}

async function networkWithOfflineFallback(request) {
  try {
    return await fetch(request)
  } catch (error) {
    const offline = await caches.match(OFFLINE_URL)
    if (offline) return offline
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(networkWithOfflineFallback(request))
    return
  }
  if (CACHE_FIRST.some((pattern) => pattern.test(url.pathname))) {
    event.respondWith(cacheFirst(event, request))
  }
  // Everything else: untouched, straight to the network.
})
