'use client'

import { ArrowRight, CreditCard, Headphones, MapPin, Truck } from 'lucide-react'
import { Link } from '@/components/locale-link'
import { ProductCard } from '@/components/products/product-card'
import { HOME } from '@/lib/content/home'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { fill } from '@/lib/support/copy'
import { useStore } from '@/lib/store'
import type { Product } from '@/lib/types'

/**
 * The homepage's own sections, besides the hero and the departments: the four
 * facts under the hero, and four products. Nothing else — the homepage is
 * hero, departments, products and the footer (with its newsletter). Who runs
 * the shop, how ordering works and the FAQ have their own pages, linked from
 * the header and the footer.
 */

function useHomeCopy() {
  const { locale } = useStore()
  const c = HOME[locale] ?? HOME.en
  const vars = { reply: describeBusinessDays(FULFILMENT.supportReply, locale, { genitive: true }) }
  return { c, f: (text: string) => fill(text, vars) }
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
 * Four products in one row (two by two on a phone), chosen on the server —
 * see featuredProducts() in app/page.tsx. The heading is left-aligned with
 * "View all" at the right end of its row, like every heading with a way
 * onwards.
 */
export function FeaturedProducts({ products }: { products: Product[] }) {
  const { c } = useHomeCopy()
  if (products.length === 0) return null
  return (
    <section aria-labelledby="featured-title" className="section-y border-t border-border">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <p className="mb-3 t-eyebrow text-gold">{c.featuredEyebrow}</p>
            <h2 id="featured-title" className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {c.featuredTitle}
            </h2>
          </div>
          <Link href="/catalog" className="group inline-flex min-h-[44px] items-center gap-2 t-label text-foreground/85 hover:text-foreground">
            {c.featuredAll}
            <ArrowRight className="size-3.5 text-gold transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 lg:grid-cols-4 lg:gap-x-8">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  )
}
