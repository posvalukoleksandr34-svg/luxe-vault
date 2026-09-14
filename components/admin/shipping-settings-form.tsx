'use client'

import { ArrowLeft, Check, Loader2, Truck } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { SHIPPING_LIMITS, type ShippingSettings } from '@/config/shipping'
import { describeBusinessDays } from '@/lib/fulfilment'
import { formatChf } from '@/lib/store'
import { cn } from '@/lib/utils'

type Source = 'database' | 'defaults'

const INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold'

/**
 * The shop's shipping settings: the standard fee, the free-shipping threshold
 * and the default delivery window. Saved to store_settings through
 * /api/admin/settings. The server prices every new order from these at once;
 * the storefront shows them from its next render.
 */
export function ShippingSettingsForm({
  initial,
  initialSource,
}: {
  initial: ShippingSettings
  initialSource: Source
}) {
  const [price, setPrice] = useState(String(initial.shippingPrice))
  const [threshold, setThreshold] = useState(String(initial.freeShippingThreshold))
  const [minDays, setMinDays] = useState(String(initial.deliveryTimeframe.min))
  const [maxDays, setMaxDays] = useState(String(initial.deliveryTimeframe.max))
  const [source, setSource] = useState<Source>(initialSource)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const draft: ShippingSettings = {
    shippingPrice: Number(price),
    freeShippingThreshold: Number(threshold),
    deliveryTimeframe: { min: Number(minDays), max: Number(maxDays) },
  }
  const previewable =
    Number.isFinite(draft.shippingPrice) &&
    Number.isFinite(draft.freeShippingThreshold) &&
    Number.isInteger(draft.deliveryTimeframe.min) &&
    Number.isInteger(draft.deliveryTimeframe.max) &&
    draft.deliveryTimeframe.min >= 1 &&
    draft.deliveryTimeframe.max >= draft.deliveryTimeframe.min

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `Ошибка ${res.status}`)
      setSource('database')
      setStatus({
        kind: 'ok',
        text: 'Сохранено. Новые заказы уже считаются по этим значениям; витрина обновится в течение минуты.',
      })
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const days = SHIPPING_LIMITS.businessDays

  return (
    <main id="main" className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/admin"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Назад в админ-панель
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gold/10">
            <Truck className="size-5 text-gold" />
          </div>
          <div>
            <h1 className="font-serif text-xl font-semibold text-foreground">Доставка</h1>
            <p className="text-xs text-muted-foreground">
              Стоимость, порог бесплатной доставки и срок — для всей витрины и всех новых заказов.
            </p>
          </div>
        </div>

        {source === 'defaults' && (
          <p className="mb-6 rounded-xl border border-gold/30 p-4 text-xs leading-relaxed text-muted-foreground">
            Сейчас действуют значения по умолчанию из <code className="text-foreground">config/shipping.ts</code>:
            в базе ещё ничего не сохранено. Если сохранение не проходит, в Supabase ещё не создана таблица{' '}
            <code className="text-foreground">store_settings</code> — примените миграцию 0028.
          </p>
        )}

        <form onSubmit={save} className="space-y-6 rounded-2xl border border-border bg-card p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs text-muted-foreground">Стоимость доставки, CHF</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min={SHIPPING_LIMITS.shippingPrice.min}
                max={SHIPPING_LIMITS.shippingPrice.max}
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-muted-foreground">Бесплатная доставка от, CHF</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min={SHIPPING_LIMITS.freeShippingThreshold.min}
                max={SHIPPING_LIMITS.freeShippingThreshold.max}
                required
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className={INPUT}
              />
              <span className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground/70">
                По сумме товаров после скидки. 0 — доставка всегда бесплатна.
              </span>
            </label>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-xs text-muted-foreground">Срок доставки, рабочих дней</legend>
            <div className="flex items-center gap-3">
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min={days.min}
                max={days.max}
                required
                aria-label="От, рабочих дней"
                value={minDays}
                onChange={(e) => setMinDays(e.target.value)}
                className={cn(INPUT, 'w-24')}
              />
              <span className="text-muted-foreground">–</span>
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min={days.min}
                max={days.max}
                required
                aria-label="До, рабочих дней"
                value={maxDays}
                onChange={(e) => setMaxDays(e.target.value)}
                className={cn(INPUT, 'w-24')}
              />
            </div>
            <span className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground/70">
              Для товаров без собственного срока (его можно задать в карточке товара). Покупатели
              видят срок на своём языке.
            </span>
          </fieldset>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-gold px-5 py-2.5 text-sm font-medium text-gold-foreground transition disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Сохранить
            </button>
            {status && (
              <p
                role={status.kind === 'error' ? 'alert' : 'status'}
                className={cn('text-xs leading-relaxed', status.kind === 'ok' ? 'text-gold' : 'text-red-400')}
              >
                {status.text}
              </p>
            )}
          </div>
        </form>

        {previewable && (
          <section className="mt-6 rounded-2xl border border-border p-6">
            <h2 className="mb-3 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              Так увидят покупатели
            </h2>
            <ul className="space-y-2 text-sm text-foreground">
              <li>
                Стандартная доставка — {formatChf(draft.shippingPrice)}, бесплатно для заказов от{' '}
                {formatChf(draft.freeShippingThreshold)}.
              </li>
              <li>Срок доставки: {describeBusinessDays(draft.deliveryTimeframe, 'ru')}</li>
              <li className="text-muted-foreground">
                EN: {describeBusinessDays(draft.deliveryTimeframe, 'en')} · DE:{' '}
                {describeBusinessDays(draft.deliveryTimeframe, 'de')} · IT:{' '}
                {describeBusinessDays(draft.deliveryTimeframe, 'it')} · FR:{' '}
                {describeBusinessDays(draft.deliveryTimeframe, 'fr')}
              </li>
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}
