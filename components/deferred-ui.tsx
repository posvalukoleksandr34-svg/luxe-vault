'use client'

import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'

/**
 * Root-layout pieces nothing on the first paint depends on, loaded after
 * hydration in their own chunks instead of in every page's first-load JS.
 *
 * A client wrapper because the root layout is a Server Component and
 * `dynamic(..., { ssr: false })` needs a client module — the same pattern as
 * PointerAtmosphereLazy.
 */

// The UI sound layer acts only inside an effect and has nothing to do before
// the visitor's first interaction, so there is no server markup to lose.
const AudioFeedback = dynamic(
  () => import('@/components/audio-feedback').then((m) => m.AudioFeedback),
  { ssr: false },
)

// The banner already renders nothing until mounted — the server cannot know
// the stored answer — so ssr: false changes nothing a visitor sees.
const CookieConsent = dynamic(
  () => import('@/components/cookie-consent').then((m) => m.CookieConsent),
  { ssr: false },
)

// GA4 and the Meta Pixel. Nothing to render, and nothing to do before consent
// and an idle browser — see components/analytics/analytics-manager.tsx.
const AnalyticsManager = dynamic(
  () => import('@/components/analytics/analytics-manager').then((m) => m.AnalyticsManager),
  { ssr: false },
)

export function AnalyticsManagerLazy() {
  return <AnalyticsManager />
}

export function AudioFeedbackLazy() {
  return <AudioFeedback />
}

export function CookieConsentLazy() {
  return <CookieConsent />
}

// The ribbon glow behind every storefront page (components/hero-ribbons.tsx).
// Purely decorative, so it can arrive after hydration; the admin console is a
// work tool with its own chrome and does not get it.
const HeroRibbons = dynamic(
  () => import('@/components/hero-ribbons').then((m) => m.HeroRibbons),
  { ssr: false },
)

export function SiteRibbonsLazy() {
  const pathname = usePathname()
  if (pathname?.startsWith('/admin')) return null
  return <HeroRibbons layer="page" />
}
