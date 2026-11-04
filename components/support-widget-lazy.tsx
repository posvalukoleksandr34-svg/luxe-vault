'use client'

import dynamic from 'next/dynamic'
import { LazyBoundary } from '@/components/lazy-boundary'

/**
 * The floating support launcher, loaded after hydration. It opens the support
 * center drawer, which GlobalPanels mounts.
 *
 * It is fixed-position, so appearing a moment later shifts nothing on the
 * page, and nobody needs it before the page is interactive. A client wrapper
 * so the pages that place it — Server Components among them — can keep
 * `ssr: false`.
 */
const SupportWidget = dynamic(
  () => import('@/components/support-widget').then((m) => m.SupportWidget),
  { ssr: false },
)

// The page must not depend on the support launcher: if its code does not
// download, the launcher is left out and the page carries on.
export function SupportWidgetLazy() {
  return (
    <LazyBoundary name="support launcher">
      <SupportWidget />
    </LazyBoundary>
  )
}
