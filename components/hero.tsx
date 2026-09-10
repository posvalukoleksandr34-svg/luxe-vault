'use client'

import { ArrowDown, Sparkles } from 'lucide-react'
import Link from 'next/link'
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
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

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

  function scrollToShop() {
    const el = document.getElementById('shop')
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 72
      window.scrollTo({ top, behavior: 'smooth' })
    }
  }

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

      {/* 4. Scan lines, unchanged — they give the flat areas a texture that
             stops the gradients banding on a wide display. */}
      <div className="hero__lines" />

      <div
        ref={contentRef}
        className="relative z-10 flex flex-col items-center px-4 text-center will-change-transform"
      >
        <div className="animate-reveal-up mb-7 flex items-center gap-4">
          <span className="h-px w-10 bg-gradient-to-r from-transparent to-gold/50" />
          <span className="text-[10px] uppercase tracking-[0.5em] text-gold/75">
            Premium Collection 2026
          </span>
          <span className="h-px w-10 bg-gradient-to-l from-transparent to-gold/50" />
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
          <button
            onClick={scrollToShop}
            className="hero__cta group inline-flex items-center gap-2.5 border border-gold/25 px-8 py-3.5 text-[11px] uppercase tracking-[0.28em] text-foreground/90"
          >
            {t('hero.cta')}
            <ArrowDown className="size-3.5 transition-transform duration-500 group-hover:translate-y-1" />
          </button>

          {/* Secondary, not competing with the primary CTA: someone who knows
              what they want browses; someone who does not asks the stylist. */}
          <Link
            href="/stylist"
            className="tap-safe inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-gold/80 transition-colors duration-300 hover:text-gold"
          >
            <Sparkles className="size-3.5" />
            {t('stylist.cta')}
          </Link>
        </div>
      </div>

      {/* 5. Vignette, painted over everything but the content, so the frame
             darkens at the edges the way a lens does. */}
      <div className="hero__vignette" />

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 opacity-70">
        <div className="flex h-10 w-6 items-start justify-center border border-border/50 p-1.5">
          <div className="hero__scroll-dot h-2 w-0.5 bg-gold/60" />
        </div>
      </div>
    </section>
  )
}
