'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { CONSENT_EVENT } from '@/lib/cookie-consent'
import { applyConsent, trackMetaPageView } from '@/lib/analytics-vendors'

/**
 * Starts GA4 and the Meta Pixel for visitors who consented, and keeps them in
 * step with the cookie banner. Renders nothing.
 *
 * Mounted from the root layout through components/deferred-ui.tsx, so its
 * code is not in any page's first-load JS; and it waits for the browser to go
 * idle before touching the vendors, so their scripts never compete with the
 * first paint, hydration or the LCP image. Events raised earlier still reach
 * them — see dispatch() in lib/analytics-vendors.ts.
 */
export function AnalyticsManager() {
  const pathname = usePathname()
  const firstPath = useRef(true)

  useEffect(() => {
    let idle: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    if ('requestIdleCallback' in window) idle = window.requestIdleCallback(applyConsent, { timeout: 4000 })
    else timer = setTimeout(applyConsent, 2000)

    // Granted, changed or withdrawn from the banner or the footer link.
    window.addEventListener(CONSENT_EVENT, applyConsent)
    return () => {
      if (idle !== undefined) window.cancelIdleCallback(idle)
      if (timer !== undefined) clearTimeout(timer)
      window.removeEventListener(CONSENT_EVENT, applyConsent)
    }
  }, [])

  // The Pixel's first PageView is sent when it starts; later client-side
  // navigations are reported here.
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false
      return
    }
    trackMetaPageView()
  }, [pathname])

  return null
}
