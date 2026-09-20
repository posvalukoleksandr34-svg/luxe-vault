'use client'

import { AlertTriangle, LayoutGrid, RefreshCw, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { ProductCard } from '@/components/products/product-card'
import { EmptyState } from '@/components/state-view'
import type { SkippedSteps } from '@/components/stylist/consultation'
import {
  STYLIST_COLOR_LABELS,
  STYLIST_OCCASION_LABELS,
  STYLIST_STYLE_LABELS,
} from '@/lib/i18n'
import { formatPrice, useStore } from '@/lib/store'
import type { StylistBrief } from '@/lib/stylist/types'
import type { Product } from '@/lib/types'

/**
 * The customer's answers, as a quiet panel above the looks.
 *
 * Said back so the result reads as a response to what they asked — and so a
 * look that misses is traceable to an answer they can change ("Edit answers"
 * returns to the questions with everything still filled in).
 */
export function StylistSummary({
  brief,
  skipped,
  onEdit,
}: {
  brief: StylistBrief
  skipped: SkippedSteps
  /** Absent while the looks are being built. */
  onEdit?: () => void
}) {
  const { t, tf, localize, products } = useStore()

  const rows: { key: string; label: string; value: string | null }[] = [
    {
      key: 'occasion',
      label: t('stylist.sum.occasion'),
      value: brief.occasion ? localize(STYLIST_OCCASION_LABELS[brief.occasion]) : null,
    },
    {
      key: 'style',
      label: t('stylist.sum.style'),
      value: brief.style ? localize(STYLIST_STYLE_LABELS[brief.style]) : null,
    },
    {
      key: 'colors',
      label: t('stylist.sum.colors'),
      value: brief.colors?.length
        ? brief.colors.map((c) => localize(STYLIST_COLOR_LABELS[c])).join(', ')
        : null,
    },
    {
      key: 'budget',
      label: t('stylist.sum.budget'),
      // "No limit" was chosen (it is the default answer); skipping says so.
      value: skipped.budget
        ? null
        : brief.budget
          ? tf('stylist.budgetUpTo', { price: formatPrice(brief.budget) })
          : t('stylist.anyBudget'),
    },
    {
      key: 'sizes',
      label: t('stylist.sum.sizes'),
      value: brief.sizes?.length ? brief.sizes.join(', ') : null,
    },
    { key: 'notes', label: t('stylist.sum.notes'), value: brief.notes?.trim() || null },
  ]

  const anchor = brief.anchorProductId
    ? products.find((p) => p.id === brief.anchorProductId)
    : undefined

  return (
    <section aria-labelledby="stylist-summary" className="mb-12 border border-border/60 p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="stylist-summary" className="text-[11px] uppercase tracking-[0.3em] text-gold/80">
          {t('stylist.summaryTitle')}
        </h2>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="tap-safe text-[11px] uppercase tracking-[0.15em] text-muted-foreground/70 transition hover:text-gold"
          >
            {t('stylist.editAnswers')}
          </button>
        )}
      </div>

      {anchor && (
        <p className="mb-4 text-[12px] font-light text-muted-foreground">
          {t('stylist.sum.anchor')}: <span className="text-foreground">{localize(anchor.name)}</span>
        </p>
      )}

      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.key} className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">{r.label}</dt>
            <dd className="mt-1 break-words text-[13px] font-light text-foreground">
              {r.value ?? <span className="text-muted-foreground/50">{t('stylist.skipped')}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * Up to four pieces straight from the catalogue the store already holds —
 * in stock, within the budget, carrying one of the sizes asked for, newest
 * first. No request, so it works exactly when the stylist does not.
 */
function fallbackPicks(products: Product[], brief: StylistBrief): Product[] {
  const buyable = products.filter(
    (p) =>
      !p.statuses.includes('out_of_stock') && (!p.variants?.length || p.variants.some((v) => v.stock > 0)),
  )
  const budget = brief.budget
  const inBudget = budget ? buyable.filter((p) => p.price <= budget) : buyable
  const pool = inBudget.length ? inBudget : buyable
  const wanted = brief.sizes ?? []
  const sized = wanted.length ? pool.filter((p) => p.sizes.some((s) => wanted.indexOf(s) !== -1)) : pool
  const chosen = sized.length ? sized : pool
  return chosen
    .slice()
    .sort((a, b) => Number(Boolean(b.isNew)) - Number(Boolean(a.isNew)))
    .slice(0, 4)
}

/**
 * When no look can be built — the stylist is unreachable, or the catalogue
 * cannot fill one yet. Keeps the answers (they are shown above), says what
 * happened in one line, offers the way on, and still shows something to buy.
 */
export function StylistFallback({
  brief,
  kind,
  hint,
  onRetry,
}: {
  brief: StylistBrief
  /** 'failed' — the request did not work; 'empty' — it worked, nothing fits. */
  kind: 'failed' | 'empty'
  hint?: string
  onRetry?: () => void
}) {
  const { t, products } = useStore()
  const picks = useMemo(() => fallbackPicks(products, brief), [products, brief])

  return (
    <div>
      <EmptyState
        role={kind === 'failed' ? 'alert' : undefined}
        icon={kind === 'failed' ? AlertTriangle : Sparkles}
        title={kind === 'failed' ? t('stylist.failed') : t('stylist.noLookTitle')}
        hint={hint ?? (kind === 'failed' ? t('stylist.fallbackHint') : undefined)}
        action={
          onRetry
            ? { label: t('common.retry'), onClick: onRetry, icon: RefreshCw }
            : { label: t('state.goToCatalog'), href: '/catalog', icon: LayoutGrid }
        }
        secondary={onRetry ? { label: t('state.goToCatalog'), href: '/catalog' } : undefined}
        className="border border-border/60 px-6"
      />

      {picks.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-6 text-[11px] uppercase tracking-[0.3em] text-gold/80">
            {t('stylist.fallbackPicks')}
          </h2>
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:gap-x-7 md:grid-cols-4">
            {picks.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
