import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Crumb = { name: string; url: string }

const SITE_URL = 'https://luxe-vault.store'

/**
 * The catalogue trail: Shop › Clothing › Hoodies › Product.
 *
 * A server component with no client JavaScript — it is the same static markup
 * on every render, and a <nav><ol> is what assistive technology and crawlers
 * both expect. Extracted from the product page once the category routes needed
 * the identical thing; two hand-written copies of a breadcrumb are how one of
 * them ends up with a different separator or a missing aria-current.
 */
export function Breadcrumbs({ trail, className }: { trail: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('mb-8', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
        {trail.map((crumb, i) => (
          <li key={`${crumb.url}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3 text-muted-foreground/40" aria-hidden />}
            {i === trail.length - 1 ? (
              // The current page is not a link — a self-link is noise for a
              // screen reader and a wasted crawl for a bot.
              <span aria-current="page" className="text-foreground/70">
                {crumb.name}
              </span>
            ) : (
              <Link href={crumb.url} className="transition hover:text-gold">
                {crumb.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/**
 * schema.org/BreadcrumbList for the same trail.
 *
 * Gives search results the "Shop › Clothing › Hoodies" path instead of a bare
 * URL. Built from the trail actually rendered, so the structured data can
 * never describe a route the page does not show.
 */
export function breadcrumbJsonLd(trail: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: `${SITE_URL}${crumb.url}`,
    })),
  }
}
