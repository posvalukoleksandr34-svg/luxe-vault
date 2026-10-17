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
    fallback: 'radial-gradient(120% 90% at 20% 0%, #f3ece0 0%, #e4d8c4 75%)',
  },
  men: {
    labelKey: 'sections.men',
    image:
      'https://images.unsplash.com/photo-1764698072732-ea0230fc5d8e?w=1400&q=80&auto=format&fit=crop',
    fallback: 'radial-gradient(120% 90% at 80% 10%, #f1eadf 0%, #e1d5c1 75%)',
  },
  kids: {
    labelKey: 'sections.kids',
    image:
      // `sat=-100` (an imgix transform Unsplash's CDN honours) puts this one in
      // black and white like the other two — it is the only colour shot of the
      // three, and side by side the difference read as a mistake.
      'https://images.unsplash.com/photo-1775322124421-19ba223a107c?w=1400&q=80&auto=format&fit=crop&sat=-100',
    fallback: 'radial-gradient(120% 90% at 30% 100%, #f2ebdf 0%, #e2d6c2 75%)',
  },
}

// Light sand, the page's own tone: what a card shows while its photograph
// loads, or if none can be loaded. It was near-black, so a slow or failed
// photo left three dark slabs reading DONNA / UOMO / BAMBINI — which looked
// like a separate, cheaper row of buttons rather than this section.
const FALLBACK_GRADIENT = 'radial-gradient(120% 90% at 50% 0%, #f2ebdf 0%, #e2d6c2 75%)'

export function SectionsGrid() {
  const { t, localize, collections, categoryImages } = useStore()

  // A department that exists in the catalogue gets its own page; one that does
  // not yet gets /catalog, so the card always leads somewhere real.
  const live = useMemo(() => new Set(collections.map((c) => c.slug)), [collections])
  const coverOf = (slug: string) =>
    categoryImages[slug] || collections.find((c) => c.slug === slug)?.image || ''
  // How many photographs have failed per card. Set from <Image onError>,
  // which is also how the product card handles a dead image URL.
  //
  // A card tries its photographs in turn — the admin's cover first, then the
  // bundled one — and only when both fail does it show the dark panel with
  // the label. With a single source, one broken cover URL turned all three
  // cards into black "buttons" reading DONNA / UOMO / BAMBINI, which looked
  // like a second, cheaper section rather than this one.
  const [failed, setFailed] = useState<Record<string, number>>({})
  // Which cards have a photograph on screen (set from <Image onLoad>).
  const [loaded, setLoaded] = useState<Record<string, string>>({})

  return (
    <section id="collections" className="section-y scroll-mt-20">
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
          {CORE_DEPARTMENTS.map((department, i) => {
            const section = VISUALS[department.slug]
            // A department with no card art of its own still renders, labelled
            // from the catalogue rather than from a missing i18n key.
            const label = section ? t(section.labelKey) : localize(department.name)
            // Its own department page when that department exists, the full
            // catalogue when it does not — never the homepage's shop section,
            // which was a stop on the way rather than a destination.
            const href = live.has(department.slug) ? `/category/${department.slug}` : '/catalog'
            const sources = Array.from(
              new Set([coverOf(department.slug), section?.image].filter((x): x is string => Boolean(x))),
            )
            const cover = sources[failed[department.slug] ?? 0] ?? ''
            const shown = Boolean(cover) && loaded[department.slug] === cover
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
                  {cover && (
                    <Image
                      key={cover}
                      src={cover}
                      alt=""
                      fill
                      // Must match the grid above, or the browser picks the
                      // wrong candidate from the srcset. It did at three of
                      // four breakpoints: one column until md (not two, so
                      // 50vw between 640 and 768 fetched a half-width file for
                      // a full-width card), and three columns after it (~33vw,
                      // not the 25vw declared, which fetched a quarter-width
                      // file for a third-width card). Under-fetching is the
                      // expensive kind of wrong: the card renders soft on
                      // exactly the large screens this artwork is for.
                      sizes="(max-width: 767px) 100vw, 33vw"
                      // All three, eagerly: directly under the hero now, so
                      // they are the next thing seen, not a scroll away.
                      priority
                      onLoad={() => setLoaded((prev) => ({ ...prev, [department.slug]: cover }))}
                      onError={() =>
                        setFailed((prev) => ({ ...prev, [department.slug]: (prev[department.slug] ?? 0) + 1 }))
                      }
                      className={cn(
                        'size-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.06]',
                        // WHERE THE CROP FALLS. These are portrait photographs
                        // (375x562) in a LANDSCAPE box until md — 375x281 on a
                        // phone. `cover` scales to fill the width and then has
                        // 281px of height spare, and the default 50% centre
                        // takes half of that off the top: 140px, which on an
                        // editorial portrait is exactly the head. Every card
                        // was decapitated on a phone, Kids most obviously.
                        //
                        // 20% takes 56px off the top instead, keeping faces in
                        // frame while still trimming the empty space above
                        // them. From md the card is portrait itself (3/4) and
                        // close to the image's own ratio, so the crop is
                        // horizontal and slight, and centre is right again.
                        'object-[50%_20%] md:object-center',
                      )}
                    />
                  )}

                  {/* Keeps the label legible over any photograph. */}
                  {/* Keeps the white label legible over a photograph — only
                      once there is one; on the sand placeholder the label is
                      dark instead. */}
                  {shown && (
                    <>
                      {/* The same depth the photo had at 80% opacity on the
                          old dark card, lifting on hover as it did. */}
                      <div className="absolute inset-0 bg-black/20 transition-opacity duration-700 group-hover:opacity-0" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                    </>
                  )}

                  <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                    <h3
                      className={cn(
                        'font-sans text-lg font-bold uppercase leading-none tracking-[0.16em] transition-colors duration-500 sm:text-xl',
                        shown ? 'text-white' : 'text-foreground',
                      )}
                    >
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
