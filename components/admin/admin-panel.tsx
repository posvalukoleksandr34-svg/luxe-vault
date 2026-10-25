'use client'

import { AlertTriangle, CheckCircle2, ChevronRight, Edit2, ExternalLink, Plus, Search, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { adminLocalize as localize, adminT as t } from '@/lib/admin-i18n'
import { ORDER_STATUS_LABELS_RU } from '@/lib/admin-labels'
import { tabFrom } from '@/lib/admin-nav'
import { STATUS_LABELS } from '@/lib/i18n'
import { formatChf, useFullCatalog, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { AdminPageHeader, useAdminAttention } from './admin-shell'
import { CollectionsManager } from './collections-manager'
import { ConfirmDialog } from './confirm-dialog'
import { CustomersManager } from './customers-manager'
import { InventoryManager } from './inventory-manager'
import { ProductForm } from './product-form'
import { TranslateCatalogButton } from './translate-catalog-button'
import { GAP_LABELS, productGaps } from '@/lib/product-gaps'
import { LISTING_STATUSES, LISTING_STATUS_LABELS } from '@/lib/listing'
import { ReviewsManager } from './reviews-manager'
import { ProductReviewsQueue } from './product-reviews-queue'
import { STATUS_COLORS } from './order-controls'
import { SupportManager } from './support-manager'
import type { DashboardMetrics } from '@/lib/admin-metrics'
import type { Order, Product } from '@/lib/types'

/**
 * /admin: the dashboard and the sections that are views of this page
 * (`?tab=products`, `?tab=inventory`, …). The navigation around it is the
 * shell's (components/admin/admin-shell.tsx); which view shows is the
 * address, so a reload or a shared link lands where it was.
 */
export function AdminPanel() {
  const params = useSearchParams()
  const tab = tabFrom(params.get('tab'))

  return (
    <>
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'products' && <ProductsSection />}
      {tab === 'collections' && <CollectionsManager />}
      {tab === 'inventory' && <InventoryManager />}
      {tab === 'customers' && <CustomersManager />}
      {tab === 'reviews' && <ReviewsManager />}
      {tab === 'productReviews' && <ProductReviewsQueue />}
      {tab === 'support' && <SupportManager />}
    </>
  )
}

// ---------------------------------------------------------------- dashboard

/**
 * What needs doing first, then the figures. Every number comes from the
 * database (lib/server/admin-attention.ts, lib/server/admin-metrics.ts); a
 * count that could not be read shows as "—", not 0.
 */
function Dashboard() {
  const { products, catalogLoading } = useFullCatalog()
  const { attention, failed: attentionFailed, refresh } = useAdminAttention()

  const [orders, setOrders] = useState<Order[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [ordersError, setOrdersError] = useState(false)
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [metricsError, setMetricsError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const json = (res: Response) => {
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    }
    fetch('/api/admin/orders?limit=6')
      .then(json)
      .then((data) => !cancelled && setOrders(data.orders ?? []))
      .catch(() => !cancelled && setOrdersError(true))
      .finally(() => !cancelled && setOrdersLoading(false))
    fetch('/api/admin/metrics')
      .then(json)
      .then((data: DashboardMetrics) => !cancelled && setMetrics(data))
      .catch(() => !cancelled && setMetricsError(true))
    // The shell's counts may be up to 30 s old; the dashboard wants them now.
    refresh()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const incomplete = catalogLoading ? null : products.filter((p) => productGaps(p).length > 0).length
  // Not on sale yet (0062): waiting for the owner's rights record. Unknown
  // (null) while the catalogue loads or when 0062 is not applied.
  const drafts =
    catalogLoading || !products.some((p) => p.listing)
      ? null
      : products.filter((p) => p.listing && p.listing.status !== 'published').length

  type Item = { count: number | null; label: string; href: string; tone: 'urgent' | 'normal' | 'info' }
  const items: Item[] = attention
    ? [
        { count: attention.ordersToShip, label: 'Оплачены и ждут отправки', href: '/admin/orders?view=toship', tone: 'urgent' },
        { count: attention.ordersFlagged, label: 'Заказы с отметкой риска — проверить до отправки', href: '/admin/orders?view=toship', tone: 'urgent' },
        { count: attention.refundCasesWaiting, label: 'Заявки на возврат ждут решения', href: '/admin/returns', tone: 'urgent' },
        { count: attention.supportWaiting, label: 'Обращения ждут ответа', href: '/admin?tab=support', tone: 'urgent' },
        { count: attention.outOfStock, label: 'Вариантов нет в наличии', href: '/admin?tab=inventory', tone: 'normal' },
        { count: attention.lowStock, label: 'Вариантов заканчивается', href: '/admin?tab=inventory', tone: 'normal' },
        { count: attention.productReviewsPending, label: 'Отзывы о товарах на модерации', href: '/admin?tab=productReviews', tone: 'normal' },
        { count: attention.storeReviewsPending, label: 'Отзывы о магазине на модерации', href: '/admin?tab=reviews', tone: 'normal' },
        { count: drafts, label: 'Товары не в продаже — проверьте права и опубликуйте', href: '/admin?tab=products&pub=draft', tone: 'normal' },
        { count: incomplete, label: 'Товары с незаполненными полями', href: '/admin?tab=products&gaps=1', tone: 'normal' },
        { count: attention.reviewRequestsFailed, label: 'Письма с просьбой об отзыве не ушли', href: '/admin/review-requests?status=failed', tone: 'normal' },
        { count: attention.ordersAwaitingPayment, label: 'Ждут оплаты', href: '/admin/orders?view=unpaid', tone: 'info' },
      ]
    : []
  const waiting = items.filter((i) => i.count !== null && i.count > 0)
  const unknown = items.filter((i) => i.count === null)

  return (
    <div>
      <AdminPageHeader
        title="Обзор"
        description="Что ждёт действий — сначала, показатели — ниже."
        actions={
          <>
            <Link
              href="/admin/orders?view=toship"
              className="inline-flex min-h-[40px] items-center rounded-lg border border-border px-4 text-sm text-foreground transition hover:bg-accent"
            >
              Заказы к отправке
            </Link>
            <Link
              href="/admin?tab=products&new=1"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition hover:bg-foreground/90"
            >
              <Plus className="size-4" aria-hidden />
              Добавить товар
            </Link>
          </>
        }
      />

      <section aria-labelledby="attention-title" className="rounded-xl border border-border bg-card">
        <h2 id="attention-title" className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">
          Требует внимания
        </h2>
        {attentionFailed && !attention ? (
          <p role="alert" className="px-5 py-4 text-sm text-red-700">
            Не удалось загрузить список. Обновите страницу; если повторится — проверьте журнал сервера.
          </p>
        ) : !attention ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">Загрузка…</p>
        ) : waiting.length === 0 ? (
          <p className="flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-700" aria-hidden />
            Всё обработано — новых заказов к отправке, обращений и заявок нет.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {waiting.map((i) => (
              <li key={i.label}>
                <Link href={i.href} className="flex items-center gap-3 px-5 py-3 transition hover:bg-accent/60">
                  <span
                    className={cn(
                      'min-w-[2.25rem] rounded-md px-2 py-0.5 text-center text-sm font-semibold tabular-nums',
                      i.tone === 'urgent' ? 'bg-red-600 text-white' : i.tone === 'info' ? 'bg-muted text-muted-foreground' : 'bg-muted text-foreground',
                    )}
                  >
                    {i.count}
                  </span>
                  <span className="flex-1 text-sm text-foreground">{i.label}</span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {unknown.length > 0 && (
          <p className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
            Нет данных: {unknown.map((i) => i.label.toLowerCase()).join(', ')} — источник не прочитан (журнал сервера).
          </p>
        )}
      </section>

      <section aria-label="Показатели" className="mt-6">
        {metricsError ? (
          <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            Не удалось загрузить показатели. Обновите страницу; если ошибка повторяется — проверьте журнал сервера.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Выручка (оплачено − возвраты)" value={metrics ? formatChf(metrics.netRevenueMinor / 100) : '…'} />
              <StatCard label="Оплаченных заказов" value={metrics ? String(metrics.paidOrders) : '…'} />
              <StatCard label="Средний чек (оплаченные)" value={metrics ? formatChf(metrics.avgOrderMinor / 100) : '…'} />
              <StatCard label="За 30 дней" value={metrics ? formatChf(metrics.netRevenue30dMinor / 100) : '…'} hint={metrics ? `${metrics.paidOrders30d} оплач. заказов` : undefined} />
            </div>
            {metrics && (
              <p className="mt-2 text-xs text-muted-foreground">
                Возвращено всего: {formatChf(metrics.refundedMinor / 100)} · Всего заказов: {metrics.orders} · Товаров в каталоге:{' '}
                {catalogLoading ? '…' : products.length}
              </p>
            )}
          </>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="recent-orders" className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="recent-orders" className="text-sm font-semibold text-foreground">
              Последние заказы
            </h2>
            <Link href="/admin/orders?view=all" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Все заказы
            </Link>
          </div>
          <div className="space-y-1">
            {ordersError && <p className="text-sm text-red-700">Не удалось загрузить заказы.</p>}
            {ordersLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
            {!ordersLoading && !ordersError && orders.length === 0 && <p className="text-sm text-muted-foreground">Заказов пока нет.</p>}
            {orders.map((order) => (
              <Link
                key={order.id}
                href={`/admin/orders?order=${encodeURIComponent(order.id)}`}
                className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{order.id}</p>
                  <p className="truncate text-xs text-muted-foreground">{order.customer.name}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm tabular-nums text-foreground">{formatChf(order.total)}</span>
                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', STATUS_COLORS[order.status])}>
                    {ORDER_STATUS_LABELS_RU[order.status]}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="stock-alerts" className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="stock-alerts" className="text-sm font-semibold text-foreground">
              Заканчивается на складе
            </h2>
            <Link href="/admin?tab=inventory" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Все остатки
            </Link>
          </div>
          {!attention ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : attention.stockItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {attention.outOfStock === null ? 'Остатки не загрузились.' : 'Всё в наличии выше порогов.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {attention.stockItems.map((v) => (
                <li key={v.variantId} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{v.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {v.size} · {v.color}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums',
                      v.stock === 0 ? 'bg-red-500/10 text-red-700' : 'bg-amber-500/10 text-amber-800',
                    )}
                  >
                    {v.stock === 0 ? 'нет' : `${v.stock} шт.`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

// ----------------------------------------------------------------- products

type Availability = 'all' | 'in_stock' | 'out_of_stock'
type Sort = 'name' | 'price_asc' | 'price_desc'

/**
 * The product list. Filters live in the address (?q=&cat=&avail=&gaps=1&sort=)
 * so going to another section and back — or reloading — keeps them, and
 * `?edit=<slug>` / `?new=1` open the editor, which is how the dashboard links
 * straight to "add a product".
 */
function ProductsSection() {
  const { products, catalogLoading } = useFullCatalog()
  const { deleteProduct, categoryLabels, categoryLabel } = useStore()
  const pathname = usePathname()
  const params = useSearchParams()

  const q = params.get('q') ?? ''
  const cat = params.get('cat') ?? ''
  const avail = (['in_stock', 'out_of_stock'] as const).find((a) => a === params.get('avail')) ?? 'all'
  const gapsOnly = params.get('gaps') === '1'
  // Sale state (0062): ?pub=draft|published|withdrawn.
  const pub = LISTING_STATUSES.find((s) => s === params.get('pub')) ?? 'all'
  const sort: Sort = (['price_asc', 'price_desc'] as const).find((s) => s === params.get('sort')) ?? 'name'
  const editSlug = params.get('edit')
  const creating = params.get('new') === '1'

  const [search, setSearch] = useState(q)
  const [toDelete, setToDelete] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)

  function setParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    // The history API: filtering is client-side, and a router navigation
    // would re-render the server page for nothing (Next keeps
    // useSearchParams in step with replaceState).
    window.history.replaceState(null, '', `${pathname}?${next.toString()}`)
  }

  // Typing filters at once; the address follows a moment later.
  useEffect(() => {
    const id = setTimeout(() => {
      if (search !== q) setParams({ q: search.trim() || null })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))).sort((a, b) => localize(categoryLabels[a] ?? {}).localeCompare(localize(categoryLabels[b] ?? {}))),
    [products, categoryLabels],
  )

  const needsAttention = products.filter((p) => productGaps(p).length > 0).length
  const needle = search.trim().toLowerCase()
  const filtered = products
    .filter((p) => {
      if (needle && !(localize(p.name).toLowerCase().includes(needle) || p.id.toLowerCase().includes(needle))) return false
      if (cat && p.category !== cat) return false
      if (avail !== 'all' && !p.statuses.includes(avail)) return false
      if (gapsOnly && productGaps(p).length === 0) return false
      if (pub !== 'all' && p.listing?.status !== pub) return false
      return true
    })
    .sort((a, b) =>
      sort === 'price_asc' ? a.price - b.price : sort === 'price_desc' ? b.price - a.price : localize(a.name).localeCompare(localize(b.name)),
    )
  const filtersOn = Boolean(needle || cat || avail !== 'all' || gapsOnly || pub !== 'all')
  const onSale = products.filter((p) => p.listing?.status === 'published').length

  const editing = editSlug ? products.find((p) => p.id === editSlug) ?? null : null
  const formOpen = creating || Boolean(editing)

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    const ok = await deleteProduct(toDelete.id)
    setDeleting(false)
    if (ok) setToDelete(null)
  }

  const selectClass = 'min-h-[40px] rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-foreground'

  return (
    <div>
      <AdminPageHeader
        title={t('admin.products')}
        description={
          catalogLoading
            ? 'Загрузка каталога…'
            : `${products.length} в каталоге · ${onSale} в продаже${needsAttention ? ` · ${needsAttention} требуют заполнения` : ''}`
        }
        actions={
          <>
            <TranslateCatalogButton />
            <button
              type="button"
              onClick={() => setParams({ new: '1', edit: null })}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition hover:bg-foreground/90"
            >
              <Plus className="size-4" aria-hidden />
              {t('admin.addProduct')}
            </button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex min-h-[40px] w-full items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-foreground sm:w-auto sm:max-w-xs sm:flex-1">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Название или адрес"
            aria-label="Поиск товара"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </label>
        <select aria-label="Категория" value={cat} onChange={(e) => setParams({ cat: e.target.value || null })} className={selectClass}>
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {localize(categoryLabels[c] ?? {}) || c}
            </option>
          ))}
        </select>
        <select aria-label="Наличие" value={avail} onChange={(e) => setParams({ avail: e.target.value === 'all' ? null : e.target.value })} className={selectClass}>
          <option value="all">Любое наличие</option>
          <option value="in_stock">В наличии</option>
          <option value="out_of_stock">Нет в наличии</option>
        </select>
        <select aria-label="Продажа" value={pub} onChange={(e) => setParams({ pub: e.target.value === 'all' ? null : e.target.value })} className={selectClass}>
          <option value="all">Любой статус продажи</option>
          {LISTING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LISTING_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select aria-label="Сортировка" value={sort} onChange={(e) => setParams({ sort: e.target.value === 'name' ? null : e.target.value })} className={selectClass}>
          <option value="name">По названию</option>
          <option value="price_asc">Сначала дешёвые</option>
          <option value="price_desc">Сначала дорогие</option>
        </select>
        {/* Products still missing something a customer needs — a photo, a
            description, a translation, a size chart, specs, their own
            delivery time, a plausible price (lib/product-gaps.ts). */}
        <button
          type="button"
          onClick={() => setParams({ gaps: gapsOnly ? null : '1' })}
          aria-pressed={gapsOnly}
          className={cn(
            'inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-sm transition',
            gapsOnly ? 'border-amber-500/60 bg-amber-500/10 text-amber-800' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          <AlertTriangle className="size-4" aria-hidden />
          Требуют заполнения · {needsAttention}
        </button>
      </div>

      {catalogLoading ? (
        <p className="rounded-xl border border-border px-6 py-12 text-center text-sm text-muted-foreground">Загрузка каталога…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">{products.length === 0 ? 'В каталоге пока нет товаров.' : 'Под эти условия товаров нет.'}</p>
          {filtersOn && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setParams({ q: null, cat: null, avail: null, gaps: null, pub: null })
              }}
              className="mt-3 text-sm text-foreground underline underline-offset-4"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      ) : (
        <>
          {filtersOn && (
            <p className="mb-2 text-xs text-muted-foreground">
              Показано {filtered.length} из {products.length}
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Товар</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">Категория</th>
                  <th className="px-4 py-3 font-medium">Цена</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Статусы</th>
                  <th className="px-4 py-3 text-right font-medium">
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((p) => {
                  const gaps = productGaps(p)
                  const name = localize(p.name)
                  return (
                    <tr key={p.id} className="transition hover:bg-accent/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.image} alt="" loading="lazy" className="size-10 shrink-0 rounded-lg bg-muted object-cover" />
                          <div className="min-w-0">
                            {/* The name opens the editor: the most common thing to do with a row. */}
                            <button
                              type="button"
                              onClick={() => setParams({ edit: p.id, new: null })}
                              className="text-left text-sm font-medium text-foreground underline-offset-4 hover:underline"
                            >
                              {name}
                            </button>
                            <p className="truncate font-mono text-[11px] text-muted-foreground">
                              {p.id}
                              {p.listing && (
                                <span
                                  className={cn(
                                    'ml-2 rounded border px-1.5 py-0.5 font-sans text-[10px]',
                                    p.listing.status === 'published'
                                      ? 'border-emerald-600/40 bg-emerald-600/10 text-emerald-800'
                                      : 'border-border text-muted-foreground',
                                  )}
                                >
                                  {LISTING_STATUS_LABELS[p.listing.status]}
                                </span>
                              )}
                            </p>
                            {gaps.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {gaps.map((g) => (
                                  <span key={g} className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-800">
                                    {GAP_LABELS[g]}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <span className="text-sm text-muted-foreground">{localize(categoryLabel(p.group, p.category)) || p.category}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">{formatChf(p.price)}</span>
                          {p.oldPrice && <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground line-through">{formatChf(p.oldPrice)}</span>}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {p.statuses.map((s) => (
                            <span
                              key={s}
                              className={cn(
                                'whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px]',
                                s === 'out_of_stock' ? 'border-red-500/30 bg-red-500/10 text-red-700' : 'border-border text-muted-foreground',
                              )}
                            >
                              {localize(STATUS_LABELS[s])}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <a
                            href={`/product/${encodeURIComponent(p.id)}`}
                            target="_blank"
                            rel="noopener"
                            aria-label={`Открыть «${name}» на сайте`}
                            title="Открыть на сайте"
                            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          >
                            <ExternalLink className="size-4" aria-hidden />
                          </a>
                          <button
                            type="button"
                            onClick={() => setParams({ edit: p.id, new: null })}
                            aria-label={`Редактировать «${name}»`}
                            title="Редактировать"
                            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          >
                            <Edit2 className="size-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => setToDelete(p)}
                            aria-label={`Удалить «${name}»`}
                            title="Удалить"
                            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-red-500/10 hover:text-red-700"
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editSlug && !catalogLoading && !editing && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          Товар «{editSlug}» не найден — возможно, его удалили.
        </p>
      )}

      {formOpen && (
        <ProductForm
          // A new key per product: the form's state starts from that product.
          key={editing?.id ?? 'new'}
          product={editing}
          onClose={() => setParams({ edit: null, new: null })}
        />
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Удалить «${toDelete ? localize(toDelete.name) : ''}»?`}
        description="Товар, его варианты и остатки будут удалены из каталога навсегда. Отменить это нельзя."
        details={
          <ul className="list-disc space-y-1 pl-5">
            <li>Страница товара будет отвечать «снят с продажи», он исчезнет из поиска и корзин.</li>
            <li>Прошлые заказы сохранят название, размер и цену — история не теряется.</li>
            <li>Если товар временно недоступен, лучше поставить остаток 0 на странице «Остатки».</li>
          </ul>
        }
        confirmLabel="Удалить товар"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  )
}
