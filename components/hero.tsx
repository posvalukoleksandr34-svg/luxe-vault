'use client'

import { ArrowDown } from 'lucide-react'
import { Link } from '@/components/locale-link'
import { useEffect, useRef } from 'react'
import { useStore } from '@/lib/store'

/**
 * The hero.
 *
 * Three things carry the "cinematic" reading, and none of them is an extra
 * animation:
 *
 *   DEPTH — five stacked grounds instead of one flat gradient. A cool floor
 *   wash, a warm key light from above, a horizon glow behind the wordmark, the
 *   existing scan lines, and a vignette. Light that comes from somewhere is
 *   what separates a film frame from a coloured rectangle.
 *
 *   PARALLAX — the content drifts up at 0.35× the scroll rate and dissolves as
 *   it goes, so the wordmark hands over to the catalogue rather than being
 *   yanked off the top of the screen. Driven by one rAF-throttled scroll
 *   listener writing a transform, and it stops entirely once the hero is past.
 *
 *   THE SWEEP — a single slow specular pass across the gold word, on an
 *   11-second cycle. Long enough that it reads as light moving over metal
 *   rather than as a shimmer effect.
 */
export function Hero() {
  const { t } = useStore()
  const contentRef = useRef<HTMLDivElement>(null)

  // Parallax. Transform and opacity only — no layout, no paint — and the
  // listener does nothing but store a number; all writing happens in the
  // frame callback, so a fast scroll cannot queue up work per event.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    // The system setting, or the site's own "reduce animations" switch.
    if (
      document.documentElement.dataset.motion === 'reduce' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      return

    let frame = 0
    let queued = false

    function apply() {
      queued = false
      const y = window.scrollY
      // Past the hero there is nothing to move; leaving the element at its
      // last transform is both correct and free.
      if (y > window.innerHeight) return
      const shift = y * 0.35
      const fade = Math.max(0, 1 - y / (window.innerHeight * 0.75))
      el!.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`
      el!.style.opacity = String(fade)
    }

    function onScroll() {
      if (queued) return
      queued = true
      frame = requestAnimationFrame(apply)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    apply()
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <section className="hero relative flex min-h-[92vh] items-center justify-center overflow-hidden">
      {/* 1. Cool floor wash — the ground the warm light falls onto. Without a
             cool tone underneath, gold on charcoal reads as a colour cast
             rather than as lighting. */}
      <div className="hero__floor" />

      {/* 2. Key light from above. */}
      <div className="hero__key" />

      {/* 3. Horizon glow, sitting just under the wordmark's baseline so the
             letters appear to stand on a lit surface. */}
      <div className="hero__horizon" />

      <div
        ref={contentRef}
        className="relative z-10 flex flex-col items-center px-4 text-center will-change-transform"
      >
        <div className="animate-reveal-up mb-7 flex items-center gap-4">
          <span className="h-px w-10 bg-gradient-to-r from-transparent to-gold/40" />
          <span className="t-eyebrow text-muted-foreground">{t('hero.eyebrow')}</span>
          <span className="h-px w-10 bg-gradient-to-l from-transparent to-gold/40" />
        </div>

        {/* The two words rise separately, 140ms apart. A single block sliding
            up is an animation; a stagger reads as choreography. */}
        <h1 className="font-serif text-6xl font-bold leading-[0.88] tracking-[-0.03em] text-foreground sm:text-8xl lg:text-[9.5rem]">
          <span className="hero__word block sm:inline">LUXE</span>{' '}
          <span className="hero__word hero__word--2 hero__sheen block sm:inline">VAULT</span>
        </h1>

        <p className="animate-reveal-up mt-9 max-w-sm text-[13px] font-light leading-relaxed tracking-[0.02em] text-muted-foreground sm:text-[15px]">
          {t('hero.subtitle')}
        </p>

        <div className="animate-reveal-up mt-14 flex flex-col items-center gap-4 sm:flex-row">
          {/* Down to the departments block, the same place the header's
              "Departments" item goes. A real link rather than a scripted
              scroll: the section's scroll-margin clears the sticky header, the
              page's smooth scrolling (off under reduced motion) animates it,
              and the address can be copied. The hero only renders on the
              homepage, where #collections always exists. */}
          <a
            href="#collections"
            className="hero__cta t-cta group inline-flex items-center gap-3 border border-foreground/20 px-9 py-4 text-foreground/90"
          >
            {t('nav.collections')}
            <ArrowDown className="size-3.5 transition-transform duration-500 group-hover:translate-y-1" />
          </a>

          {/* Secondary, not competing with the primary CTA: someone who knows
              what they want browses; someone who does not asks the stylist. */}
          <Link href="/stylist" className="nav-link t-label tap-safe">
            {t('stylist.cta')}
          </Link>
        </div>
      </div>

      {/* 5. Vignette, painted over everything but the content, so the frame
             darkens at the edges the way a lens does. */}
      <div className="hero__vignette" />

      <div aria-hidden className="absolute bottom-10 left-1/2 -translate-x-1/2">
        <div className="hero__scroll-line" />
      </div>
    </section>
  )
}
