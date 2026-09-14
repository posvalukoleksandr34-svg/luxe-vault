'use client'

import dynamic from 'next/dynamic'

/**
 * The floating support launcher and its message form, loaded after hydration.
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

export function SupportWidgetLazy() {
  return <SupportWidget />
}
