'use client'

import Image from 'next/image'
import { Link } from '@/components/locale-link'
import { useMemo, useState } from 'react'
import { Reveal } from '@/components/reveal'
import { CORE_DEPARTMENTS } from '@/lib/departments'
import { useStore } from '@/lib/store'
import type { UIKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * "Выберите раздел" — the storefront's top-level departments, directly under
 * the hero. Replaces the old <Collections /> grid (which listed the catalogue's
 * own collections) with the three marketplace departments.
 *
 * Each card leads to its department's own page — /category/women and so on —
 * as soon as that department exists in the catalogue (admin → Разделы), and to
 * the full catalogue (/catalog) until then. Never to the homepage's own shop
 * section: choosing a department should open the catalogue, not scroll to it.
 *
 * Artwork: the cover image set in the admin wins, then public/images
 * (women.jpg, men.jpg, kids.jpg), and a card whose photograph is missing or
 * fails to load keeps its own dark gradient rather than a broken frame.
 *
 * Keeps id="collections": the header and footer both scroll to that anchor.
 */

/** The look of each department card, keyed by its slug. The departments
 *  themselves come from lib/departments.ts, so adding one there is all it
 *  takes for a card to appear (with the gradient below as its cover). */
/**
 * Card art. Each URL is an Unsplash photograph chosen for this grid: dark,
 * tailored, editorial. `w=1400&q=80&auto=format` asks Unsplash's own CDN for a
 * card-sized, modern-format file — the source files are 4000px and would
 * otherwise be downloaded in full.
 *
 * These are DEFAULTS. A cover set in the admin (Разделы → card image) wins, and
 * a file dropped at the /images path below wins over the remote one only if
 * you change `image` to point at it. Unsplash is allowed by both the CSP and
 * next.config's remotePatterns.
 */
const VISUALS: Record<string, { labelKey: UIKey; image: string; fallback: string }> = {
  women: {
    labelKey: 'sections.women',
    image:
      'https://images.unsplash.com/photo-1759873911531-f6ea6a178378?w=1400&q=80&auto=format&fit=crop',
    fallback: 'radial-gradient(120% 90% at 20% 0%, #232323 0%, #0c0c0c 70%)',
  },
  men: {
    labelKey: 'sections.men',
    image:
      'https://images.unsplash.com/photo-1764698072732-ea0230fc5d8e?w=1400&q=80&auto=format&fit=crop',
    fallback: 'radial-gradient(120% 90% at 80% 10%, #1e1e20 0%, #0a0a0a 70%)',
  },
  kids: {
    labelKey: 'sections.kids',
    image:
      // `sat=-100` (an imgix transform Unsplash's CDN honours) puts this one in
      // black and white like the other two — it is the only colour shot of the
      // three, and side by side the difference read as a mistake.
      'https://images.unsplash.com/photo-1775322124421-19ba223a107c?w=1400&q=80&auto=format&fit=crop&sat=-100',
    fallback: 'radial-gradient(120% 90% at 30% 100%, #262220 0%, #0b0a09 70%)',
  },
}

const FALLBACK_GRADIENT = 'radial-gradient(120% 90% at 50% 0%, #1f1f1f 0%, #0a0a0a 70%)'

export function SectionsGrid() {
  const { t, localize, collections, categoryImages } = useStore()

  // A department that exists in the catalogue gets its own page; one that does
  // not yet gets /catalog, so the card always leads somewhere real.
  const live = useMemo(() => new Set(collections.map((c) => c.slug)), [collections])
  const coverOf = (slug: string) =>
    categoryImages[slug] || collections.find((c) => c.slug === slug)?.image || ''
  // Which photographs are missing. Set from <Image onError>, which is also how
  // the product card handles a dead image URL.
  const [failed, setFailed] = useState<Record<string, boolean>>({})

  return (
    <section id="collections" className="scroll-mt-20 border-t border-border py-20">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <Reveal className="mb-10 text-center">
          <span aria-hidden className="mx-auto mb-5 block h-px w-12 bg-gold/60" />
          <h2 className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('sections.title')}
          </h2>
        </Reveal>

        {/* One column on a phone, then three equal columns from tablet up —
            `1fr` each, so the row always fills the container exactly. Two
            columns at an intermediate width would strand the third card alone
            on its own row, which is why the jump is straight to three. */}
        <div className="-mx-4 grid grid-cols-1 gap-px sm:-mx-6 md:mx-0 md:grid-cols-3 md:gap-4">
          {CORE_DEPARTMENTS.map((department, i) => {
            const section = VISUALS[department.slug]
            // A department with no card art of its own still renders, labelled
            // from the catalogue rather than from a missing i18n key.
            const label = section ? t(section.labelKey) : localize(department.name)
            // Its own department page when that department exists, the full
            // catalogue when it does not — never the homepage's shop section,
            // which was a stop on the way rather than a destination.
            const href = live.has(department.slug) ? `/category/${department.slug}` : '/catalog'
            const cover = coverOf(department.slug) || section?.image || ''
            return (
              <Reveal key={department.slug} delay={i * 90}>
                <Link
                  href={href}
                  aria-label={label}
                  className={cn(
                    'card-gold product-card group relative block w-full overflow-hidden text-left',
                    // Tall editorial portrait only once the cards sit three to
                    // a row; while they are stacked full-width, a landscape
                    // crop keeps each one from running past a screen height.
                    'aspect-[4/3] md:aspect-[3/4]',
                  )}
                  style={{ background: section?.fallback ?? FALLBACK_GRADIENT }}
                >
                  {cover && !failed[department.slug] && (
                    <Image
                      src={cover}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      priority={i === 0}
                      onError={() => setFailed((prev) => ({ ...prev, [department.slug]: true }))}
                      className="size-full object-cover opacity-80 transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.06] group-hover:opacity-100"
                    />
                  )}

                  {/* Keeps the label legible over any photograph. */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

                  <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                    <h3 className="font-sans text-lg font-bold uppercase leading-none tracking-[0.16em] text-white sm:text-xl">
                      {label}
                    </h3>
                    <span
                      aria-hidden
                      className="mt-3 block h-px w-8 bg-gold/70 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-16"
                    />
                  </div>

                  <span className="absolute left-0 top-0 h-px w-0 bg-gold transition-all duration-500 group-hover:w-full" />
                </Link>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
