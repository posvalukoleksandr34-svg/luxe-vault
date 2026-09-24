'use client'

import { ArrowLeft, ChevronDown, ClipboardList, FileDown, Search, Trash2, Truck } from 'lucide-react'
import Link from 'next/link'
import { Fragment, useMemo, useState } from 'react'
import { ORDER_STATUS_LABELS_RU, PAYMENT_STATUS_LABELS_RU } from '@/lib/admin-labels'
import { formatCharged, orderCharge } from '@/lib/currency'
import { formatChf, useStore } from '@/lib/store'
import { ORDER_STATUSES, type Order, type OrderStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { OrderStatusControl, PAYMENT_STATUS_COLORS, RefundControl, STATUS_COLORS } from './order-controls'

/**
 * /admin/orders, in the console's language (Russian, fixed).
 *
 * A table to find an order in, and — under the row, when it is opened —
 * everything that acts on it: status and tracking number, refund, the PDF
 * documents, deletion. These used to be cards in a tab of /admin; the
 * controls are the same ones (./order-controls), and they talk to the same
 * routes (/api/admin/orders/[id]).
 *
 * Opens on PAID orders: those are the ones to pack and ship. The other tabs
 * keep unpaid and closed orders one click away.
 */

type Tab = 'paid' | 'unpaid' | 'closed' | 'all'

/** Which tab an order belongs in. */
function tabOf(order: Order): Exclude<Tab, 'all'> {
  if (order.status === 'cancelled' || order.status === 'refunded' || order.paymentStatus === 'refunded') {
    return 'closed'
  }
  if (order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded') return 'paid'
  return 'unpaid'
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'paid', label: 'Оплаченные' },
  { key: 'unpaid', label: 'Не оплачены' },
  { key: 'closed', label: 'Отменённые и возвраты' },
  { key: 'all', label: 'Все' },
]

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalise(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

export function OrdersManager({
  initialOrders,
  initialOrderId,
  loadError,
}: {
  initialOrders: Order[]
  initialOrderId: string | null
  loadError: boolean
}) {
  const { pushToast } = useStore()
  const [orders, setOrders] = useState<Order[]>(initialOrders)
  const [openId, setOpenId] = useState<string | null>(initialOrderId)
  const [tab, setTab] = useState<Tab>(() => {
    // Arriving for one order: open the tab it is in, not one that hides it.
    const target = initialOrderId ? initialOrders.find((o) => o.id === initialOrderId) : undefined
    return target ? tabOf(target) : 'paid'
  })
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'any'>('any')
  const [query, setQuery] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [refundOpenId, setRefundOpenId] = useState<string | null>(null)
  const [refundingId, setRefundingId] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { paid: 0, unpaid: 0, closed: 0, all: orders.length }
    for (const o of orders) c[tabOf(o)] += 1
    return c
  }, [orders])

  // Of the paid ones, those still to leave the warehouse.
  const toShip = useMemo(
    () => orders.filter((o) => tabOf(o) === 'paid' && (o.status === 'pending' || o.status === 'processing')).length,
    [orders],
  )

  const visible = useMemo(() => {
    const q = normalise(query.trim())
    return orders.filter((o) => {
      if (tab !== 'all' && tabOf(o) !== tab) return false
      if (statusFilter !== 'any' && o.status !== statusFilter) return false
      if (!q) return true
      const haystack = normalise(
        [o.id, o.customer.name, o.customer.firstName, o.customer.lastName, o.customer.email, o.trackingNumber]
          .filter(Boolean)
          .join(' '),
      )
      return haystack.includes(q)
    })
  }, [orders, tab, statusFilter, query])

  const replace = (updated: Order) => setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))

  async function handleUpdateStatus(id: string, status: OrderStatus, trackingNumber?: string, courierName?: string) {
    const previous = orders
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              status,
              trackingNumber: trackingNumber ?? o.trackingNumber,
              courierName: courierName ?? o.courierName,
            }
          : o,
      ),
    )
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, trackingNumber, courierName }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'failed')
      // Trust the server's copy: the status timestamps are stamped by a
      // database trigger, so the optimistic row above is missing them.
      if (data.order) replace(data.order)
      pushToast({
        title: `${id}: ${ORDER_STATUS_LABELS_RU[status]}`,
        description: status === 'shipped' && trackingNumber ? `Трек-номер ${trackingNumber}` : undefined,
        variant: 'success',
      })
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
      if (data.order) replace(data.order)
      pushToast({
        title: data.fullyRefunded ? 'Возврат оформлен полностью' : 'Частичный возврат оформлен',
        description: `${formatChf(data.refunded)} · ${data.refundId}`,
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
    if (openId === id) setOpenId(null)
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      pushToast({ title: 'Заказ удалён', variant: 'default' })
    } catch {
      setOrders(previous)
      pushToast({ title: 'Не удалось удалить заказ', variant: 'default' })
    }
  }

  return (
    <main id="main" className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
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
            <h1 className="font-serif text-xl font-semibold text-foreground">Заказы</h1>
            <p className="text-xs text-muted-foreground">
              {toShip > 0 ? `Оплачено и ждёт отправки: ${toShip}. ` : ''}Нажмите на заказ, чтобы изменить статус,
              добавить трек-номер или оформить возврат.
            </p>
          </div>
        </div>

        {loadError && (
          <p role="alert" className="mb-6 rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
            Не удалось загрузить заказы из базы. Обновите страницу; если ошибка повторится — проверьте Supabase.
          </p>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <nav className="flex flex-wrap gap-2" aria-label="Фильтр заказов">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition',
                  tab === t.key
                    ? 'border-gold/50 bg-gold/10 text-gold'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
                <span className="tabular-nums text-xs opacity-70">{counts[t.key]}</span>
              </button>
            ))}
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              id="orders-status-filter"
              aria-label="Статус заказа"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'any')}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-gold"
            >
              <option value="any">Любой статус</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS_LABELS_RU[s]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 focus-within:border-gold">
              <Search className="size-3.5 text-muted-foreground" />
              <input
                id="orders-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Номер, имя, email, трек"
                aria-label="Поиск заказа"
                className="w-52 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
              />
            </label>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
            {orders.length === 0 ? 'Заказов пока нет.' : 'Под эти условия заказов нет.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Заказ</th>
                  <th className="px-4 py-3 font-medium">Дата</th>
                  <th className="px-4 py-3 font-medium">Имя</th>
                  <th className="px-4 py-3 font-medium">Фамилия</th>
                  <th className="px-4 py-3 text-right font-medium">Сумма</th>
                  <th className="px-4 py-3 font-medium">Оплата</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="w-10 px-2 py-3" aria-label="Открыть" />
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => {
                  const open = openId === order.id
                  const hasSplit = Boolean(order.customer.firstName && order.customer.lastName)
                  return (
                    <Fragment key={order.id}>
                      <tr
                        onClick={() => setOpenId(open ? null : order.id)}
                        className={cn(
                          'cursor-pointer border-b border-border transition hover:bg-accent/40',
                          open && 'bg-accent/40',
                        )}
                      >
                        <td className="px-4 py-3">
                          {/* The row is clickable for the mouse; this button is
                              what the keyboard and screen readers use. */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenId(open ? null : order.id)
                            }}
                            aria-expanded={open}
                            aria-controls={`order-detail-${order.id}`}
                            className="font-medium text-foreground underline-offset-4 hover:underline"
                          >
                            {order.id}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                          {formatDate(order.createdAt)}
                        </td>
                        {hasSplit ? (
                          <>
                            <td className="px-4 py-3 text-foreground">{order.customer.firstName}</td>
                            <td className="px-4 py-3 text-foreground">{order.customer.lastName}</td>
                          </>
                        ) : (
                          // Placed before checkout asked for the two halves:
                          // the full name as typed, not a guess at the split.
                          <td colSpan={2} className="px-4 py-3 text-foreground">
                            {order.customer.name}
                          </td>
                        )}
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                          {formatChf(order.total)}
                        </td>
                        <td className="px-4 py-3">
                          {order.paymentStatus ? (
                            <Badge className={PAYMENT_STATUS_COLORS[order.paymentStatus]}>
                              {PAYMENT_STATUS_LABELS_RU[order.paymentStatus]}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={STATUS_COLORS[order.status]}>{ORDER_STATUS_LABELS_RU[order.status]}</Badge>
                          {order.trackingNumber && (
                            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{order.trackingNumber}</p>
                          )}
                        </td>
                        <td className="px-2 py-3 text-muted-foreground">
                          <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} />
                        </td>
                      </tr>

                      {open && (
                        <tr id={`order-detail-${order.id}`} className="border-b border-border bg-card">
                          <td colSpan={8} className="px-4 py-5">
                            <OrderDetail
                              order={order}
                              refundOpen={refundOpenId === order.id}
                              refunding={refundingId === order.id}
                              onToggleRefund={() => setRefundOpenId((prev) => (prev === order.id ? null : order.id))}
                              onRefund={(amount) => handleRefund(order.id, amount)}
                              onSaveStatus={(status, tracking, courier) =>
                                handleUpdateStatus(order.id, status, tracking, courier)
                              }
                              onDelete={() => setConfirmDeleteId(order.id)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmDeleteId && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setConfirmDeleteId(null)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-order-title"
            className="animate-fade-up relative w-full max-w-sm border border-border bg-popover p-6 shadow-2xl"
          >
            <h3 id="delete-order-title" className="font-serif text-lg font-bold text-foreground">
              Удалить заказ?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Заказ <span className="text-foreground">{confirmDeleteId}</span> будет безвозвратно удалён из базы.
              Это действие нельзя отменить.
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
    </main>
  )
}

function OrderDetail({
  order,
  refundOpen,
  refunding,
  onToggleRefund,
  onRefund,
  onSaveStatus,
  onDelete,
}: {
  order: Order
  refundOpen: boolean
  refunding: boolean
  onToggleRefund: () => void
  onRefund: (amount?: number) => void
  onSaveStatus: (status: OrderStatus, trackingNumber?: string, courierName?: string) => void
  onDelete: () => void
}) {
  const charge = orderCharge(order)
  const c = order.customer
  const address = [c.street, [c.postalCode, c.city].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ')

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-4">
        <section aria-label="Покупатель" className="rounded-xl border border-border bg-background/50 p-3">
          <p className="text-sm text-foreground">{c.name}</p>
          {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
          <p className="text-xs text-muted-foreground">{c.phone}</p>
          <p className="mt-1 text-xs text-muted-foreground">{address || c.address}</p>
        </section>

        <section aria-label="Оплата" className="text-xs text-muted-foreground">
          <p>
            {order.payment}
            {charge.converted && (
              <>
                {' · '}оплачено <span className="text-foreground">{formatCharged(charge.amount, charge.currency)}</span>
              </>
            )}
          </p>
          {order.paymentAddress && (
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/60" title={order.paymentAddress}>
              {order.paymentAddress}
            </p>
          )}
          {order.promo && <p className="mt-0.5">Промокод: {order.promo}</p>}
        </section>

        <div className="flex flex-wrap gap-2">
          {/* Plain links, not fetch: the browser sends the admin cookie and
              saves the file under the name the route gives it. The
              documents are in English — they go to the customer and into the
              parcel. */}
          <a
            href={`/api/admin/orders/${encodeURIComponent(order.id)}/invoice`}
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition hover:border-gold/50 hover:text-gold"
          >
            <FileDown className="size-3.5" />
            Скачать счёт (PDF)
          </a>
          <a
            href={`/api/admin/orders/${encodeURIComponent(order.id)}/invoice?type=packing`}
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition hover:border-gold/50 hover:text-gold"
          >
            <ClipboardList className="size-3.5" />
            Упаковочный лист
          </a>
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Удалить заказ
          </button>
        </div>
      </div>

      <div>
        <ul className="space-y-2" aria-label="Товары">
          {order.items.map((item) => (
            <li key={item.key} className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.image} alt="" className="size-10 rounded-lg object-cover" />
              <div className="flex-1">
                <p className="text-sm text-foreground">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {item.size} · {item.color} · ×{item.qty}
                </p>
              </div>
              <span className="text-sm font-medium tabular-nums text-foreground">{formatChf(item.price * item.qty)}</span>
            </li>
          ))}
        </ul>

        <OrderStatusControl order={order} onSave={onSaveStatus} />
        <RefundControl order={order} open={refundOpen} busy={refunding} onToggle={onToggleRefund} onRefund={onRefund} />
      </div>
    </div>
  )
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium', className)}>
      {children}
    </span>
  )
}
