'use client'

import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import {
  LISTING_STATUS_LABELS,
  PUBLISH_BLOCKER_LABELS,
  RIGHTS_BASES,
  RIGHTS_BASIS_LABELS,
  RIGHTS_REFERENCE_LIMITS,
  publishBlockers,
  rightsProblem,
  type ProductListing,
  type RightsBasis,
} from '@/lib/listing'
import { useStore } from '@/lib/store'
import type { Product } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Sale state of one product, at the top of the product editor.
 *
 * A product is on sale only once it is published, and it can be published
 * only with the owner's own record of why the shop may sell it (lib/listing.ts,
 * migration 0062). The panel never fills that record in: the basis, the
 * reference and the confirmation are the owner's.
 *
 * It acts on the product AS SAVED: with unsaved edits in the form, publishing
 * is disabled, so what goes on sale is exactly what was checked.
 */
export function ProductListingPanel({ product, dirty }: { product: Product; dirty: boolean }) {
  const { pushToast, reloadCatalog } = useStore()
  const [listing, setListing] = useState<ProductListing | undefined>(product.listing)
  const [basis, setBasis] = useState<RightsBasis | ''>(product.listing?.rights?.basis ?? '')
  const [reference, setReference] = useState(product.listing?.rights?.reference ?? '')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<'publish' | 'withdraw' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // No listing data at all: the database has no 0062 yet.
  if (!listing) {
    return (
      <div role="status" className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-[13px] text-foreground">
        <p className="font-medium">Публикация недоступна: не применена миграция 0062.</p>
        <p className="mt-1 text-muted-foreground">
          Пока она не применена, витрина не продаёт ни одного товара. Примените
          <span className="font-mono"> 0062_product_publication.sql</span> в Supabase.
        </p>
      </div>
    )
  }

  const blockers = publishBlockers(product)
  const published = listing.status === 'published'
  const problem = rightsProblem({ basis, reference, confirmed })

  async function send(action: 'publish' | 'withdraw') {
    setBusy(action)
    setError(null)
    try {
      const res = await fetch('/api/admin/products/listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'publish'
            ? { slug: product.id, action, basis, reference, confirmed }
            : { slug: product.id, action },
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const details = Array.isArray(data.details) ? `: ${data.details.join('; ')}` : ''
        setError(`${data.error ?? 'Не удалось изменить статус'}${details}`)
        return
      }
      const next = (data.product as Product | undefined)?.listing
      if (next) setListing(next)
      setConfirmed(false)
      pushToast({
        title: action === 'publish' ? 'Товар опубликован' : 'Товар снят с продажи',
        variant: 'success',
      })
      await reloadCatalog()
    } catch {
      setError('Сеть недоступна — статус не изменён')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="listing-title" className="mb-4 rounded-xl border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 id="listing-title" className="text-sm font-medium text-foreground">Продажа</h4>
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
            published ? 'border-emerald-600/40 bg-emerald-600/10 text-emerald-800' : 'border-border text-muted-foreground',
          )}
        >
          {LISTING_STATUS_LABELS[listing.status]}
        </span>
      </div>

      {published ? (
        <div className="space-y-2 text-[13px]">
          <p className="text-muted-foreground">
            Основание: {listing.rights ? RIGHTS_BASIS_LABELS[listing.rights.basis] : '—'}
            {listing.rights?.reference ? ` · ${listing.rights.reference}` : ''}
          </p>
          <button
            type="button"
            onClick={() => void send('withdraw')}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
          >
            {busy === 'withdraw' && <Loader2 className="size-3.5 animate-spin" />}
            Снять с продажи
          </button>
        </div>
      ) : (
        <div className="space-y-3 text-[13px]">
          <p className="text-muted-foreground">
            Товар не виден покупателям. Чтобы выставить его на продажу, укажите, на каком основании магазин
            вправе его продавать. Эти сведения видите только вы; покупателям они не показываются.
          </p>

          {blockers.length > 0 && (
            <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/5 p-2.5 text-red-800">
              <p className="font-medium">Перед публикацией заполните:</p>
              <ul className="mt-1 list-disc pl-5">
                {blockers.map((b) => (
                  <li key={b}>{PUBLISH_BLOCKER_LABELS[b]}</li>
                ))}
              </ul>
            </div>
          )}

          <fieldset className="space-y-1.5">
            <legend className="mb-1 block text-[11px] text-muted-foreground">Основание продажи</legend>
            {RIGHTS_BASES.map((b) => (
              <label key={b} className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`rights-basis-${product.id}`}
                  value={b}
                  checked={basis === b}
                  onChange={() => setBasis(b)}
                  className="mt-0.5"
                />
                <span>{RIGHTS_BASIS_LABELS[b]}</span>
              </label>
            ))}
          </fieldset>

          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">
              Чем подтверждается (номер счёта поставщика, договор, файл дизайна — то, что вы сможете показать по запросу)
            </span>
            <textarea
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={RIGHTS_REFERENCE_LIMITS.max}
              rows={2}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground"
            />
          </label>

          <label className="flex items-start gap-2">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
            <span>
              Подтверждаю, что сведения верны и что товар не нарушает чужих прав на товарные знаки и дизайн.
            </span>
          </label>

          {dirty && <p className="text-amber-800">Сначала сохраните изменения: публикуется сохранённая версия товара.</p>}
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void send('publish')}
            disabled={busy !== null || dirty || blockers.length > 0 || problem !== null}
            title={problem ?? undefined}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-1.5 text-[13px] font-medium text-background transition hover:bg-foreground/85 disabled:opacity-40"
          >
            {busy === 'publish' && <Loader2 className="size-3.5 animate-spin" />}
            Опубликовать
          </button>
        </div>
      )}
    </section>
  )
}
