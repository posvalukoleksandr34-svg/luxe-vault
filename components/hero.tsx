'use client'

import { ArrowDown } from 'lucide-react'
import { useStore } from '@/lib/store'

export function Hero() {
  const { t } = useStore()

  function scrollToShop() {
    const el = document.getElementById('shop')
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 72
      window.scrollTo({ top, behavior: 'smooth' })
    }
  }

  return (
    <section className="relative flex min-h-[88vh] items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 80% 50% at 50% 0%, hsl(var(--gold) / 0.06) 0%, transparent 60%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, hsl(var(--foreground)) 0px, hsl(var(--foreground)) 1px, transparent 1px, transparent 80px)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center px-4 text-center">
        <div className="animate-reveal-up mb-6 flex items-center gap-3">
          <span className="h-px w-8 bg-gold/40" />
          <span className="text-[11px] uppercase tracking-[0.4em] text-gold/80">
            Premium Collection 2026
          </span>
          <span className="h-px w-8 bg-gold/40" />
        </div>

        <h1 className="animate-reveal-up font-serif text-6xl font-bold leading-[0.9] tracking-tight text-foreground sm:text-8xl lg:text-[9rem]">
          LUXE
          <span className="text-gradient-gold"> VAULT</span>
        </h1>

        <p className="animate-reveal-up mt-8 max-w-sm text-sm font-light leading-relaxed text-muted-foreground sm:text-base">
          {t('hero.subtitle')}
        </p>

        <button
          onClick={scrollToShop}
          className="animate-reveal-up group mt-12 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.2em] text-foreground transition-colors hover:text-gold"
        >
          {t('hero.cta')}
          <ArrowDown className="size-4 transition-transform duration-300 group-hover:translate-y-1" />
        </button>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <div className="flex h-10 w-6 items-start justify-center rounded-full border border-border/60 p-1.5">
          <div className="h-2 w-0.5 animate-bounce rounded-full bg-gold/50" />
        </div>
      </div>
    </section>
  )
}
