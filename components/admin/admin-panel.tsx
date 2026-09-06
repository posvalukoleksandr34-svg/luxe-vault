'use client'

import {
  ChevronLeft,
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
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { STATUS_LABELS } from '@/lib/i18n'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { CollectionsManager } from './collections-manager'
import { ProductForm } from './product-form'
import { ReviewsManager } from './reviews-manager'
import { SupportManager } from './support-manager'
import { ORDER_STATUSES, type Order, type OrderStatus, PaymentStatus, Product } from '@/lib/types'

type AdminTab = 'dashboard' | 'products' | 'collections' | 'orders' | 'reviews' | 'support' | 'promos'

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'text-muted-foreground bg-muted/40 border-border',
  processing: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  shipped: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  delivered: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  cancelled: 'text-red-400 bg-red-400/10 border-red-400/30',
  refunded: 'text-violet-300 bg-violet-400/10 border-violet-400/30',
}

/** Russian labels for the admin console, which is internal and Russian-only.
 *  The stored values are the English enum. */
const STATUS_LABELS_RU: Record<OrderStatus, string> = {
  pending: 'Ожидает',
  processing: 'В обработке',
  shipped: 'Отправлен',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
  refunded: 'Возврат',
}

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending_payment: 'Ожидает оплаты',
  confirming: 'Подтверждается',
  paid: 'Оплачено',
  failed: 'Платёж не прошёл',
  expired: 'Истёк',
  refunded: 'Возвращено',
  partially_refunded: 'Частичный возврат',
}

const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  pending_payment: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  confirming: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  paid: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  failed: 'text-red-400 bg-red-400/10 border-red-400/30',
  expired: 'text-red-400 bg-red-400/10 border-red-400/30',
  refunded: 'text-violet-300 bg-violet-400/10 border-violet-400/30',
  partially_refunded: 'text-violet-300 bg-violet-400/10 border-violet-400/30',
}

const ORDER_STATUS_OPTIONS: OrderStatus[] = ORDER_STATUSES

export function AdminPanel() {
  const {
    products,
    promos,
    deleteProduct,
    addPromo,
    removePromo,
    pushToast,
    t,
    localize,
    categoryLabels,
  } = useStore()

  const [tab, setTab] = useState<AdminTab>('dashboard')
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [newPromo, setNewPromo] = useState({ code: '', percent: '' })

  // Orders are the durable, server-side record (see /api/admin/orders) —
  // fetched fresh here rather than read from the client-only cart/checkout
  // state, so the admin always sees every order across every customer
  // session, not just what happened to load in this browser tab.
  const [orders, setOrders] = useState<Order[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [refundOpenId, setRefundOpenId] = useState<string | null>(null)
  const [refundingId, setRefundingId] = useState<string | null>(null)

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

  async function handleUpdateStatus(
    id: string,
    status: OrderStatus,
    trackingNumber?: string,
  ) {
    const previous = orders
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? { ...o, status, trackingNumber: trackingNumber ?? o.trackingNumber }
          : o,
      ),
    )
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, trackingNumber }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      // Trust the server's copy: the status timestamps are stamped by a
      // database trigger, so the optimistic row above is missing them.
      if (data.order) {
        setOrders((prev) => prev.map((o) => (o.id === id ? data.order : o)))
      }
      pushToast({ title: 'Заказ обновлён', variant: 'success' })
    } catch {
      setOrders(previous)
      pushToast({ title: 'Не удалось обновить статус заказа', variant: 'default' })
    }
  }

  /**
   * Executes a real Stripe refund. This is the ONLY place money leaves — the
   * customer cabinet can request a refund but never trigger one, so every
   * refund passes a human first.
   *
   * No optimistic update: the server decides the resulting status (a partial
   * refund keeps the order open, a full one closes it) and guessing here would
   * show the wrong badge whenever Stripe rejected the amount.
   */
  async function handleRefund(id: string, amount?: number) {
    setRefundingId(id)
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(amount === undefined ? {} : { amount }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        pushToast({ title: data.error || 'Не удалось оформить возврат', variant: 'default' })
        return
      }
      if (data.order) {
        setOrders((prev) => prev.map((o) => (o.id === id ? data.order : o)))
      }
      pushToast({
        title: data.fullyRefunded ? 'Возврат оформлен полностью' : 'Частичный возврат оформлен',
        description: `${formatPrice(data.refunded)} · ${data.refundId}`,
        variant: 'success',
      })
      setRefundOpenId(null)
    } catch {
      pushToast({ title: 'Не удалось оформить возврат', variant: 'default' })
    } finally {
      setRefundingId(null)
    }
  }

  async function handleDeleteOrder(id: string) {
    setConfirmDeleteId(null)
    const previous = orders
    setOrders((prev) => prev.filter((o) => o.id !== id))
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
      pushToast({ title: 'Заказ удалён', variant: 'default' })
    } catch {
      setOrders(previous)
      pushToast({ title: 'Не удалось удалить заказ', variant: 'default' })
    }
  }

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

  const filteredProducts = products.filter((p) =>
    localize(p.name).toLowerCase().includes(search.toLowerCase()),
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
              <NavButton active={tab === 'orders'} onClick={() => setTab('orders')} icon={<Truck className="size-4" />}>
                {t('admin.orders')}
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
            <NavButton active={tab === 'orders'} onClick={() => setTab('orders')} icon={<Truck className="size-4" />}>
              {t('admin.orders')}
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
                  value={formatPrice(stats.revenue)}
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
                  value={formatPrice(stats.avgCheck)}
                  icon={<TrendingUp className="size-5 text-gold" />}
                />
              </div>

              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border border-border bg-card p-5">
                  <h2 className="mb-4 font-serif text-lg font-medium text-foreground">
                    {t('admin.orders')}
                  </h2>
                  <div className="space-y-3">
                    {orders.slice(0, 5).map((order) => (
                      <div key={order.id} className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">{order.id}</p>
                          <p className="text-xs text-muted-foreground">{order.customer.name}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-foreground">
                            {formatPrice(order.total)}
                          </span>
                          <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', STATUS_COLORS[order.status])}>
                            {STATUS_LABELS_RU[order.status]}
                          </span>
                        </div>
                      </div>
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
                          {formatPrice(p.price)}
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
                              {formatPrice(p.price)}
                            </span>
                            {p.oldPrice && (
                              <span className="text-xs text-muted-foreground line-through">
                                {formatPrice(p.oldPrice)}
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

          {tab === 'orders' && (
            <div>
              <h1 className="mb-6 font-serif text-2xl font-semibold text-foreground">
                {t('admin.orders')}
              </h1>
              {ordersLoading ? (
                <p className="text-sm text-muted-foreground">Загрузка заказов...</p>
              ) : orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">Заказов пока нет</p>
              ) : (
              <div className="space-y-3">
                {orders.map((order) => (
                  <div key={order.id} className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground">{order.id}</p>
                          <span className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium', STATUS_COLORS[order.status])}>
                            {STATUS_LABELS_RU[order.status]}
                          </span>
                          {order.paymentStatus && (
                            <span className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium', PAYMENT_STATUS_COLORS[order.paymentStatus])}>
                              {PAYMENT_STATUS_LABELS[order.paymentStatus]}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {new Date(order.createdAt).toLocaleString('ru-RU')}
                        </p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="text-right">
                          <p className="text-lg font-semibold text-gold">{formatPrice(order.total)}</p>
                          <p className="text-xs text-muted-foreground">{order.payment}</p>
                          {order.paymentAddress && (
                            <p className="mt-0.5 max-w-[160px] truncate font-mono text-[10px] text-muted-foreground/60" title={order.paymentAddress}>
                              {order.paymentAddress}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(order.id)}
                          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-destructive"
                          aria-label="Удалить заказ"
                          title="Удалить заказ"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-border bg-background/50 p-3">
                      <p className="text-xs text-muted-foreground">{order.customer.name}</p>
                      <p className="text-xs text-muted-foreground">{order.customer.phone}</p>
                      <p className="text-xs text-muted-foreground">{order.customer.address}</p>
                    </div>

                    <div className="mt-3 space-y-2">
                      {order.items.map((item) => (
                        <div key={item.key} className="flex items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.image} alt={item.name} className="size-10 rounded-lg object-cover" />
                          <div className="flex-1">
                            <p className="text-sm text-foreground">{item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.size} · {item.color} · ×{item.qty}
                            </p>
                          </div>
                          <span className="text-sm font-medium text-foreground">
                            {formatPrice(item.price * item.qty)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <OrderStatusControl
                      order={order}
                      onSave={(status, trackingNumber) =>
                        handleUpdateStatus(order.id, status, trackingNumber)
                      }
                    />

                    <RefundControl
                      order={order}
                      open={refundOpenId === order.id}
                      busy={refundingId === order.id}
                      onToggle={() =>
                        setRefundOpenId((prev) => (prev === order.id ? null : order.id))
                      }
                      onRefund={(amount) => handleRefund(order.id, amount)}
                    />
                  </div>
                ))}
              </div>
              )}
            </div>
          )}

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

      {confirmDeleteId && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setConfirmDeleteId(null)}
            aria-hidden
          />
          <div className="animate-fade-up relative w-full max-w-sm border border-border bg-popover p-6 shadow-2xl">
            <h3 className="font-serif text-lg font-bold text-foreground">
              Удалить заказ?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Заказ <span className="text-foreground">{confirmDeleteId}</span> будет безвозвратно удалён из базы. Это действие нельзя отменить.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 border border-border py-2.5 text-sm font-medium text-foreground transition hover:bg-accent"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => handleDeleteOrder(confirmDeleteId)}
                className="flex-1 border border-destructive/40 bg-destructive/10 py-2.5 text-sm font-medium text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
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

/**
 * Status dropdown plus a tracking-number field that appears only when the
 * chosen status is `shipped`.
 *
 * The control is staged rather than instant: picking "Отправлен" must not fire
 * a save before the courier reference has been typed, otherwise the customer
 * gets a "shipped" email with no tracking number in it. Any other status saves
 * on selection, since there is nothing further to fill in.
 */
/**
 * Refund control for a paid order.
 *
 * Collapsed behind a toggle on purpose: this is the one button in the console
 * that moves money out, and it should take a deliberate click to reach rather
 * than sitting next to the status dropdown where it can be hit by accident.
 *
 * The amount box is optional — empty means "refund whatever is left". The
 * server is the authority on how much that is (it reads Stripe's ledger), so
 * this input is a convenience, not a validation boundary.
 */
function RefundControl({
  order,
  open,
  busy,
  onToggle,
  onRefund,
}: {
  order: Order
  open: boolean
  busy: boolean
  onToggle: () => void
  onRefund: (amount?: number) => void
}) {
  const [amount, setAmount] = useState('')

  const refunded = order.refundedAmount ?? 0
  const remaining = Number((order.total - refunded).toFixed(2))
  const refundable =
    order.paymentProvider === 'stripe' &&
    Boolean(order.paymentId) &&
    (order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded') &&
    remaining > 0

  if (!refundable) {
    // Still show what has already been returned, so a fully refunded order
    // does not look identical to one that was never paid.
    return refunded > 0 ? (
      <p className="mt-3 text-xs text-violet-300/80">
        Возвращено: {formatPrice(refunded)}
        {order.stripeRefundId && (
          <span className="ml-2 font-mono text-[10px] text-muted-foreground/60">
            {order.stripeRefundId}
          </span>
        )}
      </p>
    ) : null
  }

  const parsed = Number(amount.replace(',', '.'))
  const amountInvalid = amount.trim() !== '' && (!Number.isFinite(parsed) || parsed <= 0 || parsed > remaining)

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="text-xs text-muted-foreground transition hover:text-destructive"
      >
        {open ? 'Скрыть возврат' : 'Оформить возврат'}
        {refunded > 0 && ` · уже возвращено ${formatPrice(refunded)}`}
      </button>

      {open && (
        <div className="mt-3 space-y-2 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-3">
          <p className="text-xs text-muted-foreground">
            Доступно к возврату: <span className="text-foreground">{formatPrice(remaining)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Сумма (пусто = ${formatPrice(remaining)})`}
              className="w-48 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold"
            />
            <button
              type="button"
              disabled={busy || amountInvalid}
              onClick={() => onRefund(amount.trim() === '' ? undefined : parsed)}
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive hover:text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Возврат…' : 'Вернуть'}
            </button>
          </div>
          {amountInvalid && (
            <p className="text-[11px] text-destructive">
              Введите сумму от 0 до {formatPrice(remaining)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function OrderStatusControl({
  order,
  onSave,
}: {
  order: Order
  onSave: (status: OrderStatus, trackingNumber?: string) => void
}) {
  const [status, setStatus] = useState<OrderStatus>(order.status)
  const [tracking, setTracking] = useState(order.trackingNumber ?? '')

  // Re-sync when the server's copy comes back (or another admin changes it).
  useEffect(() => {
    setStatus(order.status)
    setTracking(order.trackingNumber ?? '')
  }, [order.status, order.trackingNumber])

  const needsTracking = status === 'shipped'
  const dirty = status !== order.status || tracking !== (order.trackingNumber ?? '')
  const trackingTooShort = needsTracking && tracking.trim().length > 0 && tracking.trim().length < 4

  function handleSelect(next: OrderStatus) {
    setStatus(next)
    // Every status except `shipped` has nothing else to collect, so commit it
    // immediately and keep the one-click feel of the old buttons.
    if (next !== 'shipped') onSave(next)
  }

  return (
    <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-border pt-4">
      <label className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Статус:</span>
        <select
          value={status}
          onChange={(e) => handleSelect(e.target.value as OrderStatus)}
          className={cn(
            'rounded-lg border bg-background px-2.5 py-1.5 text-[12px] font-medium outline-none transition focus:border-gold',
            STATUS_COLORS[status],
          )}
        >
          {ORDER_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s} className="bg-background text-foreground">
              {STATUS_LABELS_RU[s]}
            </option>
          ))}
        </select>
      </label>

      {needsTracking && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            placeholder="Трек-номер"
            maxLength={64}
            className="w-48 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-gold"
          />
          <button
            type="button"
            disabled={!dirty || trackingTooShort}
            onClick={() => onSave('shipped', tracking.trim())}
            className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-1.5 text-[11px] font-medium text-gold transition hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
          >
            Сохранить
          </button>
          {trackingTooShort && (
            <span className="text-[11px] text-destructive">Минимум 4 символа</span>
          )}
        </div>
      )}

      {order.trackingNumber && !needsTracking && (
        <span className="text-[11px] text-muted-foreground">
          Трек: <span className="font-mono text-foreground">{order.trackingNumber}</span>
        </span>
      )}
    </div>
  )
}
