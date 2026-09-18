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
const VERSION = 'v1'
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

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone())
    trim(cache)
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
    event.respondWith(cacheFirst(request))
  }
  // Everything else: untouched, straight to the network.
})
