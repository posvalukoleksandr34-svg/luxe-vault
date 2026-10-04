'use client'

import { ArrowRight, CreditCard, Headphones, MapPin, Truck } from 'lucide-react'
import { FaqAccordion } from '@/components/info/faq-accordion'
import { Link } from '@/components/locale-link'
import { ProductCard } from '@/components/products/product-card'
import { Reveal } from '@/components/reveal'
import { HOME, HOME_FAQ_IDS } from '@/lib/content/home'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { fill } from '@/lib/support/copy'
import { FAQ } from '@/lib/support/faq'
import { useStore } from '@/lib/store'
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

function SectionHeading({ eyebrow, title, id, action }: { eyebrow: string; title: string; id: string; action?: React.ReactNode }) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
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

/** A handful of pieces from the catalogue, chosen on the server. */
export function FeaturedProducts({ products }: { products: Product[] }) {
  const { c } = useHomeCopy()
  if (products.length === 0) return null
  return (
    <section aria-labelledby="featured-title" className="py-20">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <SectionHeading
          id="featured-title"
          eyebrow={c.featuredEyebrow}
          title={c.featuredTitle}
          action={
            <Link href="/catalog" className="group inline-flex min-h-[44px] items-center gap-2 t-label text-foreground/85 hover:text-foreground">
              {c.featuredAll}
              <ArrowRight className="size-3.5 text-gold transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden />
            </Link>
          }
        />
        <div className="grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 lg:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  )
}

/** Concrete reasons to buy here — each one something the shop does. */
export function WhyLuxeVault() {
  const { c, f } = useHomeCopy()
  return (
    <section aria-labelledby="why-title" className="border-t border-border py-20">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <SectionHeading id="why-title" eyebrow={c.whyEyebrow} title={c.whyTitle} />
        <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {c.why.map((item, i) => (
            <Reveal key={item.title} delay={i * 80}>
              <h3 className="font-serif text-[20px] font-normal leading-snug text-foreground">{f(item.title)}</h3>
              <p className="mt-3 text-[14px] font-light leading-relaxed text-muted-foreground">{f(item.body)}</p>
            </Reveal>
          ))}
        </div>
        <p className="mt-10">
          <Link href="/about" className="group inline-flex min-h-[44px] items-center gap-2 t-label text-foreground/85 hover:text-foreground">
            {c.heroSecondary}
            <ArrowRight className="size-3.5 text-gold transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </p>
      </div>
    </section>
  )
}

/** The four steps from choosing to tracking. */
export function HowOrdering() {
  const { c } = useHomeCopy()
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-t border-border bg-card/30 py-20">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <SectionHeading id="how-title" eyebrow={c.howEyebrow} title={c.howTitle} />
        <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
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

/** The questions most first-time customers ask, answered in place. */
export function HomeFaq() {
  const { c } = useHomeCopy()
  const entries = HOME_FAQ_IDS.map((id) => FAQ.find((e) => e.id === id)).filter((e): e is (typeof FAQ)[number] => Boolean(e))
  return (
    <section aria-labelledby="home-faq-title" className="border-t border-border py-20">
      <div className="mx-auto max-w-[880px] px-4 sm:px-6">
        <SectionHeading
          id="home-faq-title"
          eyebrow={c.faqEyebrow}
          title={c.faqTitle}
          action={
            <Link href="/faq" className="group inline-flex min-h-[44px] items-center gap-2 t-label text-foreground/85 hover:text-foreground">
              {c.faqAll}
              <ArrowRight className="size-3.5 text-gold transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden />
            </Link>
          }
        />
        <FaqAccordion entries={entries} />
      </div>
    </section>
  )
}

/** One last, quiet invitation — no countdown, no discount. */
export function FinalCta() {
  const { c } = useHomeCopy()
  return (
    <section aria-labelledby="final-cta-title" className="border-t border-border py-20">
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
