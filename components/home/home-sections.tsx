'use client'

import { ArrowRight, CreditCard, Headphones, MapPin, Truck } from 'lucide-react'
import Image from 'next/image'
import { useState } from 'react'
import { FaqAccordion } from '@/components/info/faq-accordion'
import { Link } from '@/components/locale-link'
import { ProductCard } from '@/components/products/product-card'
import { DiscountBadge, discountPercent } from '@/components/products/discount-badge'
import { Reveal } from '@/components/reveal'
import { HOME, HOME_FAQ_IDS } from '@/lib/content/home'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { fill } from '@/lib/support/copy'
import { FAQ } from '@/lib/support/faq'
import { PRODUCT_PLACEHOLDER, productImage } from '@/lib/product-image'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'

/**
 * The homepage's trust-and-conversion sections. Each claim is a fact about
 * how the shop works (see lib/content/home.ts), never a badge for its own
 * sake: no ratings, customer counts or seals that nothing stands behind.
 */

function useHomeCopy() {
  const { locale } = useStore()
  const c = HOME[locale] ?? HOME.en
  const vars = {
    reply: describeBusinessDays(FULFILMENT.supportReply, locale, { genitive: true }),
    returnDays: FULFILMENT.returnWindowDays,
  }
  return { c, f: (text: string) => fill(text, vars) }
}

/**
 * A section's heading row. THE ALIGNMENT RULE for the homepage:
 *
 *   - a section that offers a way onwards ("View all", "About us", "All
 *     questions") is LEFT-aligned on the page's 1400px container, its link
 *     at the right end of the same row;
 *   - an editorial section with nothing beside its title (departments, the
 *     FAQ, the closing call) is CENTRED over its own column.
 *
 * So every heading is either flush with the container's left edge or on the
 * page's centre line — never somewhere in between.
 */
function SectionHeading({
  eyebrow,
  title,
  id,
  action,
  align = 'left',
}: {
  eyebrow: string
  title: string
  id: string
  action?: React.ReactNode
  align?: 'left' | 'center'
}) {
  if (align === 'center') {
    return (
      <div className="mb-10 text-center">
        <p className="mb-3 t-eyebrow text-gold">{eyebrow}</p>
        <h2 id={id} className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h2>
      </div>
    )
  }
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <p className="mb-3 t-eyebrow text-gold">{eyebrow}</p>
        <h2 id={id} className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h2>
      </div>
      {action}
    </div>
  )
}

/** The "onwards" link at the right end of a heading row. */
function HeadingLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group inline-flex min-h-[44px] items-center gap-2 t-label text-foreground/85 hover:text-foreground">
      {children}
      <ArrowRight className="size-3.5 text-gold transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden />
    </Link>
  )
}

const TRUST_ICONS = [CreditCard, Truck, MapPin, Headphones]

/** Four facts directly under the hero: the questions a first visit asks. */
export function TrustBar() {
  const { c, f } = useHomeCopy()
  return (
    <section aria-label={c.trustLabel} className="border-y border-border bg-card/30">
      <ul className="mx-auto grid max-w-[1400px] grid-cols-1 divide-y divide-border/60 px-4 sm:grid-cols-2 sm:divide-y-0 sm:px-6 lg:grid-cols-4 lg:divide-x lg:px-10">
        {c.trust.map((item, i) => {
          const Icon = TRUST_ICONS[i]
          return (
            <li key={item.title} className="flex items-start gap-4 py-5 sm:py-7 lg:px-6 lg:first:pl-0 lg:last:pr-0">
              <Icon className="mt-0.5 size-5 shrink-0 text-gold" strokeWidth={1.4} aria-hidden />
              <div>
                <p className="text-[13px] font-medium text-foreground">{item.title}</p>
                <p className="mt-1 text-[13px] font-light leading-relaxed text-muted-foreground">{f(item.body)}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * A handful of pieces from the catalogue, chosen on the server.
 *
 * Laid out by how many there are, so the row is never mostly empty:
 *   4+    the four-column grid;
 *   2–3   the same card width, centred on the page;
 *   1     a single featured piece — photograph left, details right — rather
 *         than one card stranded in the first of four columns.
 */
export function FeaturedProducts({ products }: { products: Product[] }) {
  const { c } = useHomeCopy()
  if (products.length === 0) return null
  const count = products.length
  return (
    <section aria-labelledby="featured-title" className="section-y">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <SectionHeading
          id="featured-title"
          eyebrow={c.featuredEyebrow}
          title={c.featuredTitle}
          action={<HeadingLink href="/catalog">{c.featuredAll}</HeadingLink>}
        />
        {count === 1 ? (
          <FeaturedSingle product={products[0]} />
        ) : count < 4 ? (
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-10 sm:gap-x-5 lg:gap-x-8">
            {products.map((p) => (
              // A quarter of the row less its share of the three 2rem gaps —
              // exactly the width a card has in the four-column grid.
              <div key={p.id} className="w-[calc(50%-6px)] sm:w-[calc(50%-10px)] lg:w-[calc((100%-6rem)/4)]">
                <ProductCard product={p} />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 lg:grid-cols-4 lg:gap-x-8">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/** One piece, given the row to itself. */
function FeaturedSingle({ product }: { product: Product }) {
  const { localize, t, categoryLabels } = useStore()
  const [failed, setFailed] = useState(false)
  const name = localize(product.name)
  const description = localize(product.description).trim()
  const href = `/product/${encodeURIComponent(product.id)}`
  const discount = discountPercent(product.price, product.oldPrice)
  return (
    // The photograph's left edge on the container's — the same line as the
    // heading above it — and the details in the wider column beside it.
    <article className="grid items-center gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12 lg:gap-16">
      <Link href={href} className="group relative block aspect-[4/5] overflow-hidden rounded-xl bg-card" tabIndex={-1} aria-hidden>
        <Image
          src={failed ? PRODUCT_PLACEHOLDER : productImage(product.image)}
          onError={() => setFailed(true)}
          alt=""
          fill
          sizes="(max-width: 767px) 100vw, 40vw"
          className="size-full object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
        />
      </Link>
      <div>
        <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <span>{localize(categoryLabels[product.category] ?? {})}</span>
          <span aria-hidden className="text-border">·</span>
          <span className="text-foreground/70">{t('product.replicaTag')}</span>
        </p>
        <h3 className="mt-3 font-serif text-3xl font-normal leading-tight tracking-tight text-foreground sm:text-4xl">
          <Link href={href} className="hover:text-gold">
            {name}
          </Link>
        </h3>
        <p className="mt-4 flex flex-wrap items-baseline gap-3">
          <span className="text-xl font-light text-foreground">{formatPrice(product.price)}</span>
          {discount > 0 && (
            <>
              <span className="text-[14px] font-light text-muted-foreground line-through">{formatPrice(product.oldPrice as number)}</span>
              <DiscountBadge price={product.price} oldPrice={product.oldPrice} className="px-2 py-1 text-[11px]" />
            </>
          )}
        </p>
        {description && (
          <p className="mt-5 line-clamp-4 max-w-md text-[15px] font-light leading-relaxed text-muted-foreground">{description}</p>
        )}
        <Link href={href} className={cn('btn-primary-lv mt-8')}>
          {t('stylist.viewProduct')}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  )
}

/** Concrete reasons to buy here — each one something the shop does. */
export function WhyLuxeVault() {
  const { c, f } = useHomeCopy()
  return (
    <section aria-labelledby="why-title" className="section-y border-t border-border">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <SectionHeading
          id="why-title"
          eyebrow={c.whyEyebrow}
          title={c.whyTitle}
          action={<HeadingLink href="/about">{c.heroSecondary}</HeadingLink>}
        />
        <div className="grid-4">
          {c.why.map((item, i) => (
            <Reveal key={item.title} delay={i * 80}>
              <h3 className="font-serif text-[20px] font-normal leading-snug text-foreground">{f(item.title)}</h3>
              <p className="mt-3 text-[14px] font-light leading-relaxed text-muted-foreground">{f(item.body)}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/** The four steps from choosing to tracking. */
export function HowOrdering() {
  const { c } = useHomeCopy()
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="section-y scroll-mt-20 border-t border-border bg-card/30">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <SectionHeading id="how-title" eyebrow={c.howEyebrow} title={c.howTitle} />
        <ol className="grid-4">
          {c.how.map((step, i) => (
            <li key={step.title} className="border-t border-gold/40 pt-5">
              <span className="font-serif text-[15px] text-gold" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-2 text-[15px] font-medium text-foreground">{step.title}</h3>
              <p className="mt-2 text-[14px] font-light leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/** The questions most first-time customers ask, answered in place. A
 *  narrow reading column with its heading centred over it, and the way to
 *  the full FAQ centred beneath. */
export function HomeFaq() {
  const { c } = useHomeCopy()
  const entries = HOME_FAQ_IDS.map((id) => FAQ.find((e) => e.id === id)).filter((e): e is (typeof FAQ)[number] => Boolean(e))
  return (
    <section aria-labelledby="home-faq-title" className="section-y border-t border-border">
      <div className="mx-auto max-w-[880px] px-4 sm:px-6">
        <SectionHeading id="home-faq-title" eyebrow={c.faqEyebrow} title={c.faqTitle} align="center" />
        <FaqAccordion entries={entries} />
        <p className="mt-8 text-center">
          <HeadingLink href="/faq">{c.faqAll}</HeadingLink>
        </p>
      </div>
    </section>
  )
}

/** One last, quiet invitation — no countdown, no discount. */
export function FinalCta() {
  const { c } = useHomeCopy()
  return (
    <section aria-labelledby="final-cta-title" className="section-y border-t border-border">
      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 text-center sm:px-6">
        <h2 id="final-cta-title" className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {c.finalTitle}
        </h2>
        <p className="mt-4 text-[15px] font-light leading-relaxed text-muted-foreground">{c.finalBody}</p>
        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link href="/catalog" className="btn-primary-lv">
            {c.finalPrimary}
          </Link>
          <Link href="/contact" className="btn-secondary-lv">
            {c.finalSecondary}
          </Link>
        </div>
      </div>
    </section>
  )
}
