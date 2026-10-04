'use client'

import { ArrowRight } from 'lucide-react'
import { Link } from '@/components/locale-link'
import { useEffect, useRef } from 'react'
import { HOME } from '@/lib/content/home'
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
  const { locale } = useStore()
  const c = HOME[locale] ?? HOME.en
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
    <section className="hero relative flex min-h-[80vh] items-center justify-center overflow-hidden py-16 sm:min-h-[86vh]">
      {/* 1. Cool floor wash — the ground the warm light falls onto. Without a
             cool tone underneath, gold on charcoal reads as a colour cast
             rather than as lighting. */}
      <div className="hero__floor" />

      {/* 2. Key light from above. */}
      <div className="hero__key" />

      {/* The ribbon glow shows through here from the page layer behind the
          whole site (components/hero-ribbons.tsx, from the root layout). */}

      {/* A soft ivory veil behind the wordmark and the buttons, so the
          ribbons pass BEHIND the text rather than through it. */}
      <div className="hero__veil" />

      {/* 3. Horizon glow, sitting just under the wordmark's baseline so the
             letters appear to stand on a lit surface. */}
      <div className="hero__horizon" />

      <div
        ref={contentRef}
        className="relative z-10 flex flex-col items-center px-4 text-center will-change-transform"
      >
        <div className="animate-reveal-up mb-7 flex items-center gap-4">
          <span className="h-px w-10 bg-gradient-to-r from-transparent to-gold/40" />
          <span className="t-eyebrow text-muted-foreground">{c.heroEyebrow}</span>
          <span className="h-px w-10 bg-gradient-to-l from-transparent to-gold/40" />
        </div>

        {/* The two words rise separately, 140ms apart. A single block sliding
            up is an animation; a stagger reads as choreography. */}
        <h1 className="font-serif text-6xl font-bold leading-[0.88] tracking-[-0.03em] text-foreground sm:text-8xl lg:text-[9.5rem]">
          <span className="hero__word block sm:inline">LUXE</span>{' '}
          <span className="hero__word hero__word--2 hero__sheen block sm:inline">VAULT</span>
        </h1>

        {/* What the shop sells, in one plain sentence — including that the
            pieces are replicas. The wordmark above is the brand; this line is
            the answer to "what is this place?". */}
        <p className="animate-reveal-up mt-9 max-w-md text-[15px] font-light leading-relaxed tracking-[0.01em] text-foreground/75 sm:text-[17px]">
          {c.heroLine}
        </p>

        <div className="animate-reveal-up mt-12 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
          <Link href="/catalog" className="btn-primary-lv group px-9">
            {c.heroPrimary}
            <ArrowRight className="size-3.5 transition-transform duration-500 group-hover:translate-x-1" aria-hidden />
          </Link>
          <Link href="/about" className="btn-secondary-lv px-9">
            {c.heroSecondary}
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
