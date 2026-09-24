'use client'

import { useEffect, useState } from 'react'
import { ORDER_STATUS_LABELS_RU } from '@/lib/admin-labels'
import { formatCharged, orderCharge, orderChargeRate } from '@/lib/currency'
import { COURIER_NAMES } from '@/lib/fulfilment'
import { formatChf } from '@/lib/store'
import { ORDER_STATUSES, type Order, type OrderStatus, type PaymentStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * The controls that act on one order: its status (with the tracking number
 * when it ships) and a refund. Shared by /admin/orders, where orders are
 * managed, and the badges also by the dashboard's recent-orders list.
 */

export const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'text-muted-foreground bg-muted/40 border-border',
  processing: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  shipped: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  delivered: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  cancelled: 'text-red-400 bg-red-400/10 border-red-400/30',
  refunded: 'text-violet-300 bg-violet-400/10 border-violet-400/30',
}

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  pending_payment: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  confirming: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  paid: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  failed: 'text-red-400 bg-red-400/10 border-red-400/30',
  expired: 'text-red-400 bg-red-400/10 border-red-400/30',
  refunded: 'text-violet-300 bg-violet-400/10 border-violet-400/30',
  partially_refunded: 'text-violet-300 bg-violet-400/10 border-violet-400/30',
}

const STATUS_LABELS_RU = ORDER_STATUS_LABELS_RU
const ORDER_STATUS_OPTIONS: OrderStatus[] = ORDER_STATUSES

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
export function RefundControl({
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
  const charge = orderCharge(order)
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
        Возвращено: {formatChf(refunded)}
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
        {refunded > 0 && ` · уже возвращено ${formatChf(refunded)}`}
      </button>

      {open && (
        <div className="mt-3 space-y-2 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-3">
          {/* A card charged in EUR or USD is refunded in that currency, at
              the rate it was charged at — see refundPayment. */}
          {charge.converted && (
            <p className="text-xs text-muted-foreground">
              Клиент оплатил{' '}
              <span className="text-foreground">{formatCharged(charge.amount, charge.currency)}</span>{' '}
              по курсу {Number(orderChargeRate(order).toFixed(4))}. Сумма возврата вводится в CHF и
              пересчитывается в {charge.currency} по этому курсу.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Доступно к возврату: <span className="text-foreground">{formatChf(remaining)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Сумма (пусто = ${formatChf(remaining)})`}
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
              Введите сумму от 0 до {formatChf(remaining)}
            </p>
          )}
        </div>
      )}
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
export function OrderStatusControl({
  order,
  onSave,
}: {
  order: Order
  onSave: (status: OrderStatus, trackingNumber?: string, courierName?: string) => void
}) {
  const [status, setStatus] = useState<OrderStatus>(order.status)
  const [tracking, setTracking] = useState(order.trackingNumber ?? '')
  // Defaulted rather than blank: nearly every parcel goes via Swiss Post, and
  // a carrier left empty means the customer gets a bare number with no link.
  const [courier, setCourier] = useState(order.courierName ?? COURIER_NAMES[0] ?? '')

  // Re-sync when the server's copy comes back (or another admin changes it).
  useEffect(() => {
    setStatus(order.status)
    setTracking(order.trackingNumber ?? '')
    setCourier(order.courierName ?? COURIER_NAMES[0] ?? '')
  }, [order.status, order.trackingNumber, order.courierName])

  const needsTracking = status === 'shipped'
  const dirty =
    status !== order.status ||
    tracking !== (order.trackingNumber ?? '') ||
    courier !== (order.courierName ?? COURIER_NAMES[0] ?? '')
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
          {/* A datalist, not a select: these are the carriers we can deep-link
              to, but a private seller may use another and must not be blocked
              from typing it. */}
          <input
            type="text"
            list="courier-options"
            value={courier}
            onChange={(e) => setCourier(e.target.value)}
            placeholder="Перевозчик"
            maxLength={60}
            className="w-40 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-gold"
          />
          <datalist id="courier-options">
            {COURIER_NAMES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button
            type="button"
            disabled={!dirty || trackingTooShort}
            onClick={() => onSave('shipped', tracking.trim(), courier.trim())}
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
