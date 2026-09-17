'use client'

import { useEffect } from 'react'

/** The sticky header's height, so a section lands below it, not under it. */
const HEADER_OFFSET = 72

/**
 * Scrolls to the section named in the address (/#shop, /#about) once the page
 * has rendered.
 *
 * The browser's own jump to a fragment happens before the client has laid the
 * page out, and the app router then resets the scroll — so an address such as
 * /#about (a header link from another page, or /about via next.config.js)
 * landed at the top of the homepage instead of at the section. Renders nothing.
 */
export function HashScroll() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id) return
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id)
      if (!el) return
      // A jump, not the site's smooth scroll: arriving at a section should
      // not start with a two-second glide down the homepage.
      const root = document.documentElement
      const previous = root.style.scrollBehavior
      root.style.scrollBehavior = 'auto'
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET })
      root.style.scrollBehavior = previous
    }, 80)
    return () => window.clearTimeout(timer)
  }, [])
  return null
}
