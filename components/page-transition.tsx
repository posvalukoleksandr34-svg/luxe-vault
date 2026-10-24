'use client'

import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { pageTransitionRunning } from '@/lib/page-transition'

/**
 * A short dissolve on every route change.
 *
 * Keyed on the pathname, so React remounts the page subtree and the CSS
 * animation runs again. That is the same subtree the App Router already
 * swaps on navigation, so the key costs nothing extra — it only gives the
 * swap a frame to happen in.
 *
 * Deliberately keyed on the PATH and not the full URL: /account?tab=orders is
 * the same page with a different tab, and re-dissolving the whole account
 * dashboard every time someone clicks a tab would read as a page load.
 *
 * The animation is short (420ms) and does not delay anything — the new page is
 * already painted, it simply arrives at full opacity a fraction later. A
 * transition long enough to notice as a transition is a transition that makes
 * the site feel slow.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return <PageEnter key={pathname}>{children}</PageEnter>
}

/**
 * The fade is the fallback. When the page arrives inside a view transition
 * (lib/page-transition.ts — a link click in a browser that supports them),
 * the browser is already crossfading the whole view and a second fade would
 * double it — and, starting only once the transition ends, would replay it.
 * Decided once, when this page mounts: on the server and at hydration no
 * transition is running, so both render the same class.
 */
function PageEnter({ children }: { children: React.ReactNode }) {
  const [fade] = useState(() => !pageTransitionRunning())
  return <div className={fade ? 'page-enter' : undefined}>{children}</div>
}
