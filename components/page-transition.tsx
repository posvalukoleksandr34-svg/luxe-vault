'use client'

import { usePathname } from 'next/navigation'

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
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  )
}
