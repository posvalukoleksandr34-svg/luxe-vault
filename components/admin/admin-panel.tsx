'use client'

import {
  Boxes,
  ChevronLeft,
  Gift,
  ChevronRight,
  Edit2,
  Images,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Package,
  Plus,
  Star,
  Tag,
  Trash2,
  TrendingUp,
  Truck,
  Users,
  Mail,
  RotateCcw,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { adminLocalize as localize, adminT as t } from '@/lib/admin-i18n'
import { ORDER_STATUS_LABELS_RU } from '@/lib/admin-labels'
import { STATUS_LABELS } from '@/lib/i18n'
import { formatChf, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { CollectionsManager } from './collections-manager'
import { CustomersManager } from './customers-manager'
import { InventoryManager } from './inventory-manager'
import { ProductForm } from './product-form'
import { TranslateCatalogButton } from './translate-catalog-button'
import { GAP_LABELS, productGaps } from '@/lib/product-gaps'
import { ReviewsManager } from './reviews-manager'
import { STATUS_COLORS } from './order-controls'
import { SupportManager } from './support-manager'
import type { Order, Product } from '@/lib/types'

type AdminTab =
  | 'dashboard'
  | 'products'
  | 'collections'
  | 'inventory'
  | 'customers'
  | 'reviews'
  | 'support'
  | 'promos'

/** Russian labels for the admin console, which is internal and Russian-only.
 *  The stored values are the English enum. */
const STATUS_LABELS_RU = ORDER_STATUS_LABELS_RU

export function AdminPanel() {
  const {
    products,
    promos,
    deleteProduct,
    addPromo,
    removePromo,
    pushToast,
    categoryLabels,
  } = useStore()

  const [tab, setTab] = useState<AdminTab>('dashboard')
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  // Only the products an admin still needs to fill in — see lib/product-gaps.
  const [gapsOnly, setGapsOnly] = useState(false)
  const [newPromo, setNewPromo] = useState({ code: '', percent: '' })

  // Orders are the durable, server-side record (see /api/admin/orders) —
  // fetched fresh here for the dashboard's figures and recent orders. They
  // are MANAGED at /admin/orders (status, tracking, refunds, deletion).
  const [orders, setOrders] = useState<Order[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/orders')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setOrders(data.orders ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setOrdersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/'
  }

  const stats = useMemo(() => {
    const revenue = orders
      .filter((o) => o.status !== 'cancelled')
      .reduce((sum, o) => sum + o.total, 0)
    const avgCheck = orders.length > 0 ? Math.round(revenue / orders.length) : 0
    return {
      revenue,
      totalOrders: orders.length,
      totalProducts: products.length,
      avgCheck,
    }
  }, [orders, products])

  const needsAttention = products.filter((p) => productGaps(p).length > 0).length
  const filteredProducts = products.filter(
    (p) =>
      localize(p.name).toLowerCase().includes(search.toLowerCase()) &&
      (!gapsOnly || productGaps(p).length > 0),
  )

  function handleAddProduct() {
    setEditingProduct(null)
    setShowForm(true)
  }

  function handleEditProduct(p: Product) {
    setEditingProduct(p)
    setShowForm(true)
  }

  function handleAddPromo(e: React.FormEvent) {
    e.preventDefault()
    if (!newPromo.code || !newPromo.percent) return
    addPromo({
      code: newPromo.code.toUpperCase(),
      percent: Number(newPromo.percent),
      active: true,
    })
    setNewPromo({ code: '', percent: '' })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-7xl gap-0">
        {/* Sidebar */}
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col border-r border-border bg-card/30 lg:flex">
          <div className="px-4 py-6">
            <div className="mb-6 flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-gold/10">
                <LayoutDashboard className="size-4 text-gold" />
              </div>
              <span className="font-serif text-sm font-semibold text-foreground">
                {t('admin.title')}
              </span>
            </div>

            <nav className="space-y-1">
              <NavButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')} icon={<LayoutDashboard className="size-4" />}>
                {t('admin.dashboard')}
              </NavButton>
              <NavButton active={tab === 'products'} onClick={() => setTab('products')} icon={<Package className="size-4" />}>
                {t('admin.products')}
              </NavButton>
              <NavButton active={tab === 'collections'} onClick={() => setTab('collections')} icon={<Images className="size-4" />}>
                {t('admin.collections')}
              </NavButton>
              <NavButton active={tab === 'inventory'} onClick={() => setTab('inventory')} icon={<Boxes className="size-4" />}>
              Остатки
            </NavButton>
            {/* Its own page: a table with filters, status, tracking, refunds. */}
            <Link
              href="/admin/orders"
              className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Truck className="size-4" />
              {t('admin.orders')}
            </Link>
              <NavButton active={tab === 'customers'} onClick={() => setTab('customers')} icon={<Users className="size-4" />}>
              Клиенты
            </NavButton>
            <NavButton active={tab === 'reviews'} onClick={() => setTab('reviews')} icon={<Star className="size-4" />}>
                {t('reviews.title')}
              </NavButton>
              <NavButton active={tab === 'support'} onClick={() => setTab('support')} icon={<LifeBuoy className="size-4" />}>
                {t('support.title')}
              </NavButton>
              <NavButton active={tab === 'promos'} onClick={() => setTab('promos')} icon={<Tag className="size-4" />}>
                {t('admin.promos')}
              </NavButton>
              {/* Its own page (app/admin/settings), not a tab: the values are
                  read fresh from the database on every visit. */}
              <Link
                href="/admin/settings"
                className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <Truck className="size-4" />
                Доставка
              </Link>
              <Link
                href="/admin/newsletter"
                className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <Mail className="size-4" />
                Рассылка
              </Link>
              {/* Its own page (app/admin/returns): the queue is read fresh on
                  every visit, because a decision made by a colleague a minute
                  ago must not still look pending here. */}
              <Link
                href="/admin/returns"
                className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="size-4" />
                Возвраты
              </Link>
              <Link
                href="/admin/referrals"
                className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <Gift className="size-4" />
                Рефералы
              </Link>
            </nav>

            <button
              type="button"
              onClick={handleLogout}
              className="mt-8 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <LogOut className="size-3.5" />
              {t('admin.exit')}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {/* Mobile nav */}
          <div className="mb-6 flex gap-1 overflow-x-auto lg:hidden">
            <NavButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')} icon={<LayoutDashboard className="size-4" />}>
              {t('admin.dashboard')}
            </NavButton>
            <NavButton active={tab === 'products'} onClick={() => setTab('products')} icon={<Package className="size-4" />}>
              {t('admin.products')}
            </NavButton>
            <NavButton active={tab === 'collections'} onClick={() => setTab('collections')} icon={<Images className="size-4" />}>
              {t('admin.collections')}
            </NavButton>
            <NavButton active={tab === 'inventory'} onClick={() => setTab('inventory')} icon={<Boxes className="size-4" />}>
              Остатки
            </NavButton>
            <Link
              href="/admin/orders"
              className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Truck className="size-4" />
              {t('admin.orders')}
            </Link>
            <NavButton active={tab === 'customers'} onClick={() => setTab('customers')} icon={<Users className="size-4" />}>
              Клиенты
            </NavButton>
            <NavButton active={tab === 'reviews'} onClick={() => setTab('reviews')} icon={<Star className="size-4" />}>
              {t('reviews.title')}
            </NavButton>
            <NavButton active={tab === 'support'} onClick={() => setTab('support')} icon={<LifeBuoy className="size-4" />}>
              {t('support.title')}
            </NavButton>
            <NavButton active={tab === 'promos'} onClick={() => setTab('promos')} icon={<Tag className="size-4" />}>
              {t('admin.promos')}
            </NavButton>
            <Link
              href="/admin/settings"
              className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Truck className="size-4" />
              Доставка
            </Link>
            <Link
              href="/admin/newsletter"
              className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Mail className="size-4" />
              Рассылка
            </Link>
            <Link
              href="/admin/returns"
              className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-4" />
              Возвраты
            </Link>
            <Link
              href="/admin/referrals"
              className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Gift className="size-4" />
              Рефералы
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground"
            >
              {t('admin.exit')}
            </button>
          </div>

          {tab === 'dashboard' && (
            <div>
              <h1 className="mb-6 font-serif text-2xl font-semibold text-foreground">
                {t('admin.dashboard')}
              </h1>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                  label={t('admin.revenue')}
                  value={formatChf(stats.revenue)}
                  icon={<TrendingUp className="size-5 text-gold" />}
                />
                <StatCard
                  label={t('admin.totalOrders')}
                  value={stats.totalOrders.toString()}
                  icon={<Truck className="size-5 text-gold" />}
                />
                <StatCard
                  label={t('admin.totalProducts')}
                  value={stats.totalProducts.toString()}
                  icon={<Package className="size-5 text-gold" />}
                />
                <StatCard
                  label={t('admin.avgCheck')}
                  value={formatChf(stats.avgCheck)}
                  icon={<TrendingUp className="size-5 text-gold" />}
                />
              </div>

              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border border-border bg-card p-5">
                  <h2 className="mb-4 font-serif text-lg font-medium text-foreground">
                    {t('admin.orders')}
                  </h2>
                  <div className="space-y-3">
                    {/* Each opens on the orders page, where it can be acted on. */}
                    {orders.slice(0, 5).map((order) => (
                      <Link
                        key={order.id}
                        href={`/admin/orders?order=${encodeURIComponent(order.id)}`}
                        className="-mx-2 flex items-center justify-between rounded-lg px-2 py-1 transition hover:bg-accent"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">{order.id}</p>
                          <p className="text-xs text-muted-foreground">{order.customer.name}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-foreground">
                            {formatChf(order.total)}
                          </span>
                          <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', STATUS_COLORS[order.status])}>
                            {STATUS_LABELS_RU[order.status]}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-5">
                  <h2 className="mb-4 font-serif text-lg font-medium text-foreground">
                    {t('admin.products')}
                  </h2>
                  <div className="space-y-3">
                    {products.slice(0, 5).map((p) => (
                      <div key={p.id} className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.image} alt={localize(p.name)} className="size-10 rounded-lg object-cover" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground">{localize(p.name)}</p>
                          <p className="text-xs text-muted-foreground">
                            {localize(categoryLabels[p.category] ?? {})}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-foreground">
                          {formatChf(p.price)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'products' && (
            <div>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-serif text-2xl font-semibold text-foreground">
                  {t('admin.products')}
                </h1>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Поиск..."
                    className="w-40 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold sm:w-56"
                  />
                  {/* Products still missing something a customer needs — a
                      photo, a description, a translation, a size chart,
                      specs, their own delivery time, a plausible price. */}
                  <button
                    type="button"
                    onClick={() => setGapsOnly((v) => !v)}
                    aria-pressed={gapsOnly}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${
                      gapsOnly
                        ? 'border-amber-400/60 bg-amber-400/10 text-amber-300'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Требуют заполнения · {needsAttention}
                  </button>
                  <TranslateCatalogButton />
                  <button
                    type="button"
                    onClick={handleAddProduct}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                  >
                    <Plus className="size-4" />
                    {t('admin.addProduct')}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="w-full">
                  <thead className="bg-card/50">
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Товар</th>
                      <th className="hidden px-4 py-3 font-medium sm:table-cell">Категория</th>
                      <th className="px-4 py-3 font-medium">Цена</th>
                      <th className="hidden px-4 py-3 font-medium md:table-cell">Статусы</th>
                      <th className="px-4 py-3 text-right font-medium">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredProducts.map((p) => (
                      <tr key={p.id} className="transition hover:bg-card/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.image} alt={localize(p.name)} className="size-10 rounded-lg object-cover" />
                            <div>
                              <p className="text-sm font-medium text-foreground">{localize(p.name)}</p>
                              {productGaps(p).length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {productGaps(p).map((g) => (
                                    <span
                                      key={g}
                                      className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300"
                                    >
                                      {GAP_LABELS[g]}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {p.images && p.images.length > 1 && (
                                <p className="text-xs text-muted-foreground">{p.images.length} фото</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell">
                          <span className="text-sm text-muted-foreground">
                            {localize(categoryLabels[p.category] ?? {})}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-foreground">
                              {formatChf(p.price)}
                            </span>
                            {p.oldPrice && (
                              <span className="text-xs text-muted-foreground line-through">
                                {formatChf(p.oldPrice)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {p.statuses.map((s) => (
                              <span
                                key={s}
                                className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                              >
                                {localize(STATUS_LABELS[s])}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleEditProduct(p)}
                              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-gold"
                            >
                              <Edit2 className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteProduct(p.id)}
                              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-destructive"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'collections' && <CollectionsManager />}

          {tab === 'inventory' && <InventoryManager />}

          {tab === 'customers' && <CustomersManager />}

          {tab === 'reviews' && <ReviewsManager />}

          {tab === 'support' && <SupportManager />}

          {tab === 'promos' && (
            <div>
              <h1 className="mb-6 font-serif text-2xl font-semibold text-foreground">
                {t('admin.promos')}
              </h1>

              <form onSubmit={handleAddPromo} className="mb-6 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newPromo.code}
                  onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value })}
                  placeholder="Код"
                  className="w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold"
                />
                <input
                  type="number"
                  value={newPromo.percent}
                  onChange={(e) => setNewPromo({ ...newPromo, percent: e.target.value })}
                  placeholder="%"
                  className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold"
                />
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                >
                  <Plus className="size-4" />
                  Добавить
                </button>
              </form>

              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="w-full">
                  <thead className="bg-card/50">
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Код</th>
                      <th className="px-4 py-3 font-medium">Скидка</th>
                      <th className="px-4 py-3 font-medium">Статус</th>
                      <th className="px-4 py-3 text-right font-medium">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {promos.map((promo) => (
                      <tr key={promo.code} className="transition hover:bg-card/30">
                        <td className="px-4 py-3">
                          <span className="font-mono text-sm font-medium text-gold">{promo.code}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-foreground">{promo.percent}%</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
                            promo.active
                              ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
                              : 'text-muted-foreground bg-muted border-border',
                          )}>
                            {promo.active ? 'Активен' : 'Выключен'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => addPromo({ ...promo, active: !promo.active })}
                              className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
                            >
                              {promo.active ? 'Выкл' : 'Вкл'}
                            </button>
                            <button
                              type="button"
                              onClick={() => removePromo(promo.code)}
                              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-destructive"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {showForm && (
        <ProductForm
          product={editingProduct}
          onClose={() => setShowForm(false)}
        />
      )}

    </div>
  )
}

function NavButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition whitespace-nowrap',
        active ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-gold/10">
        {icon}
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  )
}
