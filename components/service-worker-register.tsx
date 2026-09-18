'use client'

import { useEffect } from 'react'

/**
 * Registers public/sw.js — static-asset caching, the offline page, and the
 * installability Chrome requires for "Install app".
 *
 * Production only: in development the worker would serve stale hot-reload
 * bundles, so any worker left over from a production build is removed
 * instead. Registered after the page has loaded, so it never competes with
 * the first paint for bandwidth. Renders nothing.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.forEach((r) => void r.unregister()))
        .catch(() => {})
      return
    }

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
        console.warn('[pwa] service worker registration failed:', error)
      })
    }
    if (document.readyState === 'complete') {
      register()
      return
    }
    window.addEventListener('load', register, { once: true })
    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
