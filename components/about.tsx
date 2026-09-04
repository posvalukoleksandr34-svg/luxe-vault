'use client'

import { Reveal } from '@/components/reveal'
import { useStore } from '@/lib/store'

export function About() {
  const { t } = useStore()

  const stats = [
    { label: t('about.stat1') },
    { label: t('about.stat2') },
    { label: t('about.stat3') },
    { label: t('about.stat4') },
  ]

  return (
    <section id="about" className="scroll-mt-20 border-t border-border py-24">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          <Reveal>
            <p className="mb-4 text-[11px] uppercase tracking-[0.4em] text-gold/70">
              {t('about.subtitle')}
            </p>
            <h2 className="font-serif text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
              {t('about.title')}
            </h2>
          </Reveal>

          <Reveal delay={150} className="flex flex-col justify-center gap-6">
            <p className="text-[15px] font-light leading-relaxed text-muted-foreground">
              {t('about.p1')}
            </p>
            <p className="text-[15px] font-light leading-relaxed text-muted-foreground">
              {t('about.p2')}
            </p>
          </Reveal>
        </div>

        <div className="mt-16 grid grid-cols-2 gap-8 border-t border-border pt-10 md:grid-cols-4">
          {stats.map((stat, i) => (
            <Reveal key={i} delay={i * 100} className="flex flex-col items-center text-center">
              <span className="font-serif text-3xl font-bold text-gold/80">
                0{i + 1}
              </span>
              <span className="mt-3 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                {stat.label}
              </span>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
