'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Fade-and-rise entrance, fired when the element scrolls into view.
 *
 * THE INITIAL STATE IS VISIBLE, NOT HIDDEN — this is the whole point of the
 * rewrite. The previous version initialised `visible` to false, so the server
 * rendered `opacity-0 translate-y-12` into the HTML and every wrapped section
 * was blank until React hydrated and an IntersectionObserver fired. Measured
 * on the homepage: 7 such wrappers in the server response. Anyone on a slow
 * connection, with JS still parsing, or with JS disabled, saw an empty page
 * that then "snapped into place" — which is not a layout shift (CLS was 0)
 * but reads as one.
 *
 * The hidden state is therefore applied by the CLIENT, in a layout effect,
 * and only to elements that are actually off-screen. Anything already in the
 * viewport is never hidden at all, so above-the-fold content paints correct
 * on the first frame and stays correct.
 */

/**
 * useLayoutEffect warns during SSR because it cannot run there. The hidden
 * state must be applied BEFORE the browser paints, though, or an off-screen
 * element would flash visible for one frame — so the layout variant is used
 * in the browser and the passive one on the server, where it is inert anyway.
 */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  // `null` = not yet decided (server, and the first client frame). Rendered
  // exactly like `true`, so the markup is visible either way and hydration
  // matches; only the animation differs.
  const [state, setState] = useState<'pending' | 'hidden' | 'shown'>('pending')

  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    // No observer (very old browser, some webviews) — leave it visible. A
    // missing animation is a non-event; a permanently invisible page is not.
    if (typeof IntersectionObserver === 'undefined') {
      setState('shown')
      return
    }

    // Respect the OS setting rather than animating anyway: the reveal is
    // decoration, and this is the same rule globals.css applies elsewhere.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setState('shown')
      return
    }

    // Already on screen? Never hide it. This is what keeps the hero and the
    // first section stable from frame zero.
    const rect = el.getBoundingClientRect()
    const inView = rect.top < window.innerHeight && rect.bottom > 0
    if (inView) {
      setState('shown')
      return
    }

    setState('hidden')

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setState('shown')
          observer.unobserve(el)
        }
      },
      // Fires as soon as any part of the element enters, with a margin that
      // starts it slightly BEFORE it does. Measured: at threshold 0.15 with a
      // -8% inset, a fast scroll (or a jump-to-anchor) landed on a section
      // that was still blurred and empty — the reveal was arriving after the
      // reader did.
      { threshold: 0.01, rootMargin: '0px 0px 6% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const hidden = state === 'hidden'

  return (
    <div
      ref={ref}
      style={{ transitionDelay: state === 'shown' ? `${delay}ms` : '0ms' }}
      className={cn(
        // `reveal` carries the blur: a section resolving out of soft focus
        // reads as depth, where a plain slide reads as a UI transition. The
        // filter is on the wrapper only, so it rasterises once per element
        // rather than per child.
        'reveal transition-all duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
        // Promoted only while an animation is actually pending. Leaving
        // will-change on permanently keeps a compositor layer alive for every
        // wrapper on the page.
        hidden && 'will-change-transform',
        hidden ? 'reveal--hidden opacity-0 translate-y-10' : 'opacity-100 translate-y-0',
        className,
      )}
    >
      {children}
    </div>
  )
}
