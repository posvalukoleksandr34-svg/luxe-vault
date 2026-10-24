'use client'

import { ChevronDown, ClipboardList, FileDown, RefreshCw, Search, ShieldAlert, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { ORDER_STATUS_LABELS_RU, PAYMENT_STATUS_LABELS_RU } from '@/lib/admin-labels'
import { formatCharged, orderCharge } from '@/lib/currency'
import { cancellationRefusal } from '@/lib/payment-state'
import { formatChf, useStore } from '@/lib/store'
import { ORDER_STATUSES, type Order, type OrderStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { OrderRisk } from '@/lib/server/payment-fraud'
import { AdminPageHeader } from './admin-shell'
import { ConfirmDialog } from './confirm-dialog'
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

type Tab = 'toship' | 'paid' | 'unpaid' | 'closed' | 'all'

/** Which tab an order belongs in (besides "all"). */
function tabOf(order: Order): Exclude<Tab, 'all' | 'toship'> {
  if (order.status === 'cancelled' || order.status === 'refunded' || order.paymentStatus === 'refunded') {
    return 'closed'
  }
  if (order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded') return 'paid'
  return 'unpaid'
}

/** Paid and not yet handed to the carrier: the day's work. */
function toShip(order: Order): boolean {
  return tabOf(order) === 'paid' && (order.status === 'pending' || order.status === 'processing')
}

function inTab(order: Order, tab: Tab): boolean {
  if (tab === 'all') return true
  if (tab === 'toship') return toShip(order)
  return tabOf(order) === tab
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'toship', label: 'К отправке' },
  { key: 'paid', label: 'Оплаченные' },
  { key: 'unpaid', label: 'Не оплачены' },
  { key: 'closed', label: 'Отменённые и возвраты' },
  { key: 'all', label: 'Все' },
]

const PERIODS = [
  { key: '', label: 'За всё время', days: 0 },
  { key: '7', label: 'За 7 дней', days: 7 },
  { key: '30', label: 'За 30 дней', days: 30 },
  { key: '90', label: 'За 90 дней', days: 90 },
] as const

/** orders.return_status, kept by the refund workflow (syncOrderSummary). */
const RETURN_LABELS: Partial<Record<NonNullable<Order['returnStatus']>, string>> = {
  requested: 'Заявка на возврат открыта',
  approved: 'Возврат одобрен, ждёт выплаты',
  refunded: 'Возврат по заявке',
  rejected: 'Заявка на возврат отклонена',
}

/** The order's refund requests, one click away — so a refund is not also
 *  made here while a case for it is open in «Возвраты». */
function ReturnLink({ order }: { order: Order }) {
  const label = order.returnStatus ? RETURN_LABELS[order.returnStatus] : undefined
  if (!label) return null
  const open = order.returnStatus === 'requested' || order.returnStatus === 'approved'
  return (
    <Link
      href={`/admin/returns?q=${encodeURIComponent(order.id)}`}
      onClick={(e) => e.stopPropagation()}
      className={cn('mt-1 block text-[11px] underline-offset-2 hover:underline', open ? 'font-medium text-amber-700' : 'text-muted-foreground')}
    >
      {label} →
    </Link>
  )
}

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
  cappedAt,
  risk: initialRisk = {},
}: {
  initialOrders: Order[]
  initialOrderId: string | null
  loadError: boolean
  /** Fraud-guard state by order number (lib/server/payment-fraud.ts). */
  risk?: Record<string, OrderRisk>
  /** Set when only the newest N orders were loaded (see readOrders). */
  cappedAt: number | null
}) {
  const { pushToast } = useStore()
  const [orders, setOrders] = useState<Order[]>(initialOrders)
  const [risk, setRisk] = useState<Record<string, OrderRisk>>(initialRisk)

  async function unlockPayment(id: string) {
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}/unlock-payment`, { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      setRisk((prev) => ({ ...prev, [id]: { ...prev[id], failures: 0, lockedAt: undefined, lockReason: undefined } }))
      pushToast({ title: `Оплата картой для ${id} разблокирована`, variant: 'default' })
    } catch {
      pushToast({ title: 'Не удалось разблокировать оплату', variant: 'error' })
    }
  }
  const [openId, setOpenId] = useState<string | null>(initialOrderId)
  // Filters live in the address (?view=&status=&q=&period=): a reload, the
  // back button or a link from elsewhere (a customer's orders) lands on the
  // same list.
  const pathname = usePathname()
  const params = useSearchParams()
  const [tab, setTabState] = useState<Tab>(() => {
    // Arriving for one order: open the tab it is in, not one that hides it.
    const target = initialOrderId ? initialOrders.find((o) => o.id === initialOrderId) : undefined
    if (target) return tabOf(target)
    const view = params.get('view')
    return TABS.some((t) => t.key === view) ? (view as Tab) : 'toship'
  })
  const [statusFilter, setStatusFilterState] = useState<OrderStatus | 'any'>(() => {
    const st = params.get('status')
    return ORDER_STATUSES.includes(st as OrderStatus) ? (st as OrderStatus) : 'any'
  })
  const [period, setPeriodState] = useState<string>(() => PERIODS.find((p) => p.key === params.get('period'))?.key ?? '')
  const [query, setQueryState] = useState(() => params.get('q') ?? '')
  const [reloading, setReloading] = useState(false)
  // One layout at a time (not both, one hidden by CSS): the open order's
  // controls exist once on the page.
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const apply = () => setNarrow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  function syncUrl(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    next.delete('order')
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    const qs = next.toString()
    // The history API, not router.replace: the filtering happens here, and a
    // router navigation would re-render the server page — re-reading every
    // order — on each keystroke. Next keeps useSearchParams in step with it.
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)
  }
  const setTab = (t: Tab) => {
    setTabState(t)
    syncUrl({ view: t === 'toship' ? null : t })
  }
  const setStatusFilter = (v: OrderStatus | 'any') => {
    setStatusFilterState(v)
    syncUrl({ status: v === 'any' ? null : v })
  }
  const setPeriod = (v: string) => {
    setPeriodState(v)
    syncUrl({ period: v || null })
  }
  const setQuery = (v: string) => setQueryState(v)
  // The search box writes to the address a moment after typing stops.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('q') ?? '') !== query.trim()) syncUrl({ q: query.trim() || null })
    }, 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [refundOpenId, setRefundOpenId] = useState<string | null>(null)
  const [refundingId, setRefundingId] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { toship: 0, paid: 0, unpaid: 0, closed: 0, all: orders.length }
    for (const o of orders) {
      c[tabOf(o)] += 1
      if (toShip(o)) c.toship += 1
    }
    return c
  }, [orders])

  const visible = useMemo(() => {
    const q = normalise(query.trim())
    const days = PERIODS.find((p) => p.key === period)?.days ?? 0
    const since = days ? Date.now() - days * 86_400_000 : 0
    return orders.filter((o) => {
      if (!inTab(o, tab)) return false
      if (since && o.createdAt < since) return false
      if (statusFilter !== 'any' && o.status !== statusFilter) return false
      if (!q) return true
      const haystack = normalise(
        [o.id, o.customer.name, o.customer.firstName, o.customer.lastName, o.customer.email, o.trackingNumber]
          .filter(Boolean)
          .join(' '),
      )
      return haystack.includes(q)
    })
  }, [orders, tab, statusFilter, query, period])

  const replace = (updated: Order) => setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))

  /** Re-reads the list: after a conflict, or when the admin asks. */
  async function reload(): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/orders', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      setOrders(data.orders ?? [])
      return true
    } catch {
      pushToast({ title: 'Не удалось обновить список заказов', variant: 'error' })
      return false
    }
  }

  async function handleUpdateStatus(id: string, status: OrderStatus, trackingNumber?: string, courierName?: string): Promise<boolean> {
    const before = orders.find((o) => o.id === id)
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // The status this screen showed: the server refuses (409) if the
        // order has moved on since — another admin, or the payment webhook.
        body: JSON.stringify({ status, trackingNumber, courierName, expectedStatus: before?.status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        pushToast({
          title: typeof data?.error === 'string' ? data.error : 'Не удалось обновить статус заказа',
          variant: 'error',
        })
        if (data?.code === 'STATUS_CONFLICT') await reload()
        return false
      }
      // Trust the server's copy: the status timestamps are stamped by a
      // database trigger.
      if (data.order) replace(data.order)
      pushToast({
        title: `${id}: ${ORDER_STATUS_LABELS_RU[status]}`,
        description: status === 'shipped' && trackingNumber ? `Трек-номер ${trackingNumber}` : undefined,
        variant: 'success',
      })
      return true
    } catch {
      pushToast({ title: 'Не удалось обновить статус заказа — проверьте соединение', variant: 'error' })
      return false
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
    // What this screen shows as already refunded: the server refuses (409)
    // when the order has moved on, e.g. a refund from another tab.
    const expectedRefunded = orders.find((o) => o.id === id)?.refundedAmount ?? 0
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(amount === undefined ? { expectedRefunded } : { amount, expectedRefunded }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Staff routes answer a code in `error` and the sentence in `message`.
        pushToast({
          title: data.message || data.error || 'Не удалось оформить возврат',
          description:
            data.error === 'STAFF_REQUIRED'
              ? 'Откройте «Возвраты», выберите себя и введите личный пароль — затем повторите возврат.'
              : undefined,
          variant: 'error',
        })
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
      pushToast({ title: 'Не удалось оформить возврат — проверьте в Stripe, прошёл ли он, прежде чем повторять', variant: 'error' })
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
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(typeof data?.error === 'string' ? data.error : '')
      }
      pushToast({ title: 'Заказ удалён', variant: 'default' })
    } catch (e) {
      setOrders(previous)
      // The server says why — e.g. a paid order, which is kept on record.
      pushToast({ title: 'Не удалось удалить заказ', description: (e as Error).message || undefined, variant: 'error' })
    }
  }

  return (
    <div>
      <div>

        <AdminPageHeader
          title="Заказы"
          description={
            counts.toship > 0
              ? `Оплачено и ждёт отправки: ${counts.toship}. Откройте заказ, чтобы сменить статус, добавить трек-номер или оформить возврат.`
              : 'Откройте заказ, чтобы сменить статус, добавить трек-номер или оформить возврат.'
          }
          actions={
            <button
              type="button"
              disabled={reloading}
              onClick={async () => {
                setReloading(true)
                await reload()
                setReloading(false)
              }}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-border px-4 text-sm text-foreground transition hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className={cn('size-4', reloading && 'animate-spin')} aria-hidden />
              Обновить
            </button>
          }
        />

        {cappedAt && (
          <p className="mb-6 rounded-xl border border-gold/30 p-4 text-xs leading-relaxed text-muted-foreground">
            Показаны последние {cappedAt} заказов — более старые здесь не загружаются. Найти старый заказ можно по номеру
            на его странице заказа.
          </p>
        )}

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
                    ? 'border-gold/50 bg-gold/10 font-medium text-foreground'
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
            <select
              aria-label="Период"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-gold"
            >
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <label className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 focus-within:border-gold sm:w-auto">
              <Search className="size-3.5 text-muted-foreground" aria-hidden />
              <input
                id="orders-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Номер, имя, email, трек"
                aria-label="Поиск заказа"
                className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/55 sm:w-52"
              />
            </label>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
            {orders.length === 0
              ? 'Заказов пока нет.'
              : tab === 'toship' && !query && statusFilter === 'any' && !period
                ? 'Все оплаченные заказы отправлены — ждать нечего.'
                : 'Под эти условия заказов нет.'}
          </p>
        ) : narrow ? (
          // Phones: one card per order (number, who, how much, where it
          // stands) instead of a 900-pixel table scrolled sideways.
          <ul className="space-y-2">
            {visible.map((order) => {
              const open = openId === order.id
              return (
                <li key={order.id} className="rounded-xl border border-border bg-card">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : order.id)}
                    aria-expanded={open}
                    aria-controls={`order-detail-${order.id}`}
                    className="flex w-full items-start justify-between gap-3 p-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{order.id}</span>
                      <span className="block truncate text-xs text-muted-foreground">{order.customer.name}</span>
                      <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">{formatDate(order.createdAt)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-medium tabular-nums text-foreground">{formatChf(order.total)}</span>
                      <Badge className={STATUS_COLORS[order.status]}>{ORDER_STATUS_LABELS_RU[order.status]}</Badge>
                      {order.paymentStatus && (
                        <Badge className={PAYMENT_STATUS_COLORS[order.paymentStatus]}>{PAYMENT_STATUS_LABELS_RU[order.paymentStatus]}</Badge>
                      )}
                    </span>
                  </button>
                  <div className="px-3 pb-2">
                    <RiskBadges risk={risk[order.id]} onUnlock={() => void unlockPayment(order.id)} />
                    <ReturnLink order={order} />
                  </div>
                  {open && (
                    <div id={`order-detail-${order.id}`} className="border-t border-border p-3">
                      <OrderDetail
                        order={order}
                        refundOpen={refundOpenId === order.id}
                        refunding={refundingId === order.id}
                        onToggleRefund={() => setRefundOpenId((prev) => (prev === order.id ? null : order.id))}
                        onRefund={(amount) => handleRefund(order.id, amount)}
                        onSaveStatus={(status, tracking, courier) => handleUpdateStatus(order.id, status, tracking, courier)}
                        onDelete={() => setConfirmDeleteId(order.id)}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
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
                            className="whitespace-nowrap font-medium text-foreground underline-offset-4 hover:underline"
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
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-foreground">
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
                          <RiskBadges risk={risk[order.id]} onUnlock={() => void unlockPayment(order.id)} />
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={STATUS_COLORS[order.status]}>{ORDER_STATUS_LABELS_RU[order.status]}</Badge>
                          {order.trackingNumber && (
                            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{order.trackingNumber}</p>
                          )}
                          <ReturnLink order={order} />
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

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
        title={`Удалить заказ ${confirmDeleteId ?? ''}?`}
        description="Заказ и его позиции будут безвозвратно удалены из базы. Отменить это нельзя."
        details={
          <p>
            Удалить можно только заказ без оплаты. Оплаченный заказ сохраняется для учёта — его отменяют и оформляют возврат.
          </p>
        }
        confirmLabel="Удалить навсегда"
        onConfirm={() => confirmDeleteId && void handleDeleteOrder(confirmDeleteId)}
      />
    </div>
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
  onSaveStatus: (status: OrderStatus, trackingNumber?: string, courierName?: string) => Promise<boolean>
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
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/85" title={order.paymentAddress}>
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
          {/* Only an order no money arrived for can be deleted (the server
              enforces it too); a paid one stays on record. */}
          {cancellationRefusal(order) === null ? (
            <button
              type="button"
              onClick={onDelete}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Удалить заказ
            </button>
          ) : (
            <span className="ml-auto self-center text-[11px] text-muted-foreground/80">Оплаченный заказ не удаляется</span>
          )}
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
    <span className={cn('inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium', className)}>
      {children}
    </span>
  )
}

const FRAUD_FLAG_LABELS: Record<NonNullable<OrderRisk['fraudFlag']>, string> = {
  elevated_risk: 'Повышенный риск — проверить до отправки',
  early_fraud_warning: 'Предупреждение банка о мошенничестве',
  dispute: 'Спор (chargeback)',
}

/** The fraud guard's view of an order: a flag to check, a card-payment lock. */
function RiskBadges({ risk, onUnlock }: { risk?: OrderRisk; onUnlock: () => void }) {
  if (!risk || (!risk.fraudFlag && !risk.lockedAt)) return null
  return (
    <div className="mt-1 flex flex-col items-start gap-1">
      {risk.fraudFlag && (
        <Badge className="border-red-500/40 bg-red-500/10 text-red-700">
          <span className="inline-flex items-center gap-1">
            <ShieldAlert className="size-3" aria-hidden />
            {FRAUD_FLAG_LABELS[risk.fraudFlag]}
          </span>
        </Badge>
      )}
      {risk.lockedAt && (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Badge className="border-red-500/40 bg-red-500/10 text-red-700">Карта заблокирована</Badge>
          <button
            type="button"
            title={risk.lockReason}
            onClick={(event) => {
              event.stopPropagation()
              onUnlock()
            }}
            className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Разблокировать
          </button>
        </span>
      )}
    </div>
  )
}
