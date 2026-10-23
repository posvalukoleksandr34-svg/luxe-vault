'use client'

import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ORDER_STATUS_LABELS_RU } from '@/lib/admin-labels'
import { formatCharged, orderCharge, orderChargeRate } from '@/lib/currency'
import { COURIER_NAMES } from '@/lib/fulfilment'
import { formatChf } from '@/lib/store'
import { ORDER_STATUSES, type Order, type OrderStatus, type PaymentStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from './confirm-dialog'

/**
 * The controls that act on one order: its status (with the tracking number
 * when it ships) and a refund. Shared by /admin/orders, where orders are
 * managed, and the badges also by the dashboard's recent-orders list.
 */

export const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'text-muted-foreground bg-muted/40 border-border',
  processing: 'text-amber-700 bg-amber-500/10 border-amber-500/30',
  shipped: 'text-blue-700 bg-blue-500/10 border-blue-500/30',
  delivered: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30',
  cancelled: 'text-red-700 bg-red-500/10 border-red-500/30',
  refunded: 'text-violet-700 bg-violet-500/10 border-violet-500/30',
}

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  pending_payment: 'text-amber-700 bg-amber-500/10 border-amber-500/30',
  confirming: 'text-blue-700 bg-blue-500/10 border-blue-500/30',
  paid: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30',
  failed: 'text-red-700 bg-red-500/10 border-red-500/30',
  expired: 'text-red-700 bg-red-500/10 border-red-500/30',
  refunded: 'text-violet-700 bg-violet-500/10 border-violet-500/30',
  partially_refunded: 'text-violet-700 bg-violet-500/10 border-violet-500/30',
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
  const [confirming, setConfirming] = useState(false)

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
      <p className="mt-3 text-xs text-violet-700/80">
        Возвращено: {formatChf(refunded)}
        {order.stripeRefundId && (
          <span className="ml-2 font-mono text-[10px] text-muted-foreground/85">
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

      {open && (order.returnStatus === 'requested' || order.returnStatus === 'approved') && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
          По этому заказу есть открытая заявка на возврат — лучше оформить выплату в ней (Возвраты), чтобы решение и
          сумма были записаны в заявке.
        </p>
      )}
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
              onClick={() => setConfirming(true)}
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
      {/* Money leaves the shop: one more, explicit step, with the amount. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Вернуть ${formatChf(amount.trim() === '' ? remaining : parsed)} по заказу ${order.id}?`}
        description="Деньги уйдут покупателю через Stripe на карту, которой он платил. Отменить возврат нельзя."
        details={
          amount.trim() === '' || parsed >= remaining ? (
            <p>Это весь остаток — заказ будет отмечен как возвращённый.</p>
          ) : (
            <p>Частичный возврат: заказ останется открытым.</p>
          )
        }
        confirmLabel="Вернуть деньги"
        busy={busy}
        onConfirm={() => {
          setConfirming(false)
          onRefund(amount.trim() === '' ? undefined : parsed)
        }}
      />
    </div>
  )
}

/** What changing to a status does beyond the label — said before saving. */
function consequence(order: Order, next: OrderStatus): string | null {
  if (next === order.status) return null
  const email = order.customer.email ? 'Покупатель получит письмо о новом статусе.' : ''
  switch (next) {
    case 'shipped':
      return `${email} Трек-номер попадёт в письмо и на страницу заказа.`.trim()
    case 'delivered':
      return `${email} С этого момента отсчитывается срок возврата и запрос отзыва.`.trim()
    case 'cancelled':
      return order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded'
        ? 'Заказ оплачен: отмена НЕ возвращает деньги — после отмены оформите возврат.'
        : 'Неоплаченный платёж будет отменён, товары вернутся в продажу.'
    case 'refunded':
      return 'Этот статус НЕ переводит деньги. Для возврата через Stripe используйте «Оформить возврат».'
    default:
      return email || null
  }
}

/**
 * Status, plus the tracking number and carrier when it ships.
 *
 * STAGED: nothing is saved until "Сохранить". Choosing a status in a dropdown
 * used to save it at once — and a status change emails the customer, and
 * cancelling releases the stock and the payment — so one slip of the mouse on
 * the wrong option was an email nobody meant to send. Now the change is shown
 * with what it will do, and saved deliberately; cancelling and "refunded" ask
 * once more.
 *
 * The save carries the status this screen showed (expectedStatus): if a
 * colleague or a payment webhook moved the order meanwhile, the server
 * refuses instead of overwriting it.
 */
export function OrderStatusControl({
  order,
  onSave,
}: {
  order: Order
  onSave: (status: OrderStatus, trackingNumber?: string, courierName?: string) => Promise<boolean>
}) {
  const [status, setStatus] = useState<OrderStatus>(order.status)
  const [tracking, setTracking] = useState(order.trackingNumber ?? '')
  // Defaulted rather than blank: nearly every parcel goes via Swiss Post, and
  // a carrier left empty means the customer gets a bare number with no link.
  const [courier, setCourier] = useState(order.courierName ?? COURIER_NAMES[0] ?? '')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // Re-sync when the server's copy comes back (or another admin changes it).
  useEffect(() => {
    setStatus(order.status)
    setTracking(order.trackingNumber ?? '')
    setCourier(order.courierName ?? COURIER_NAMES[0] ?? '')
  }, [order.status, order.trackingNumber, order.courierName])

  const needsTracking = status === 'shipped'
  const dirty =
    status !== order.status ||
    (needsTracking &&
      (tracking !== (order.trackingNumber ?? '') || courier !== (order.courierName ?? COURIER_NAMES[0] ?? '')))
  const trackingTooShort = needsTracking && tracking.trim().length > 0 && tracking.trim().length < 4
  const trackingMissing = needsTracking && tracking.trim().length === 0
  const note = consequence(order, status)
  const risky = status !== order.status && (status === 'cancelled' || status === 'refunded')

  function reset() {
    setStatus(order.status)
    setTracking(order.trackingNumber ?? '')
    setCourier(order.courierName ?? COURIER_NAMES[0] ?? '')
  }

  async function save() {
    setConfirming(false)
    setSaving(true)
    const ok = needsTracking ? await onSave('shipped', tracking.trim(), courier.trim()) : await onSave(status)
    setSaving(false)
    if (!ok) reset()
  }

  const selectId = `order-status-${order.id}`

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={selectId} className="text-xs text-muted-foreground">
          Статус
        </label>
        <select
          id={selectId}
          value={status}
          disabled={saving}
          onChange={(e) => setStatus(e.target.value as OrderStatus)}
          className={cn(
            'min-h-[36px] rounded-lg border bg-background px-2.5 py-1.5 text-[12px] font-medium outline-none transition focus:border-gold',
            STATUS_COLORS[status],
          )}
        >
          {ORDER_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s} className="bg-background text-foreground">
              {STATUS_LABELS_RU[s]}
            </option>
          ))}
        </select>
        {order.trackingNumber && !needsTracking && (
          <span className="text-[11px] text-muted-foreground">
            Трек: <span className="font-mono text-foreground">{order.trackingNumber}</span>
          </span>
        )}
      </div>

      {needsTracking && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            placeholder="Трек-номер"
            aria-label="Трек-номер"
            maxLength={64}
            disabled={saving}
            className="min-h-[36px] w-48 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-gold"
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
            aria-label="Перевозчик"
            maxLength={60}
            disabled={saving}
            className="min-h-[36px] w-40 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-gold"
          />
          <datalist id="courier-options">
            {COURIER_NAMES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {trackingTooShort && <span className="text-[11px] text-destructive">Минимум 4 символа</span>}
        </div>
      )}

      {dirty && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/60 p-2.5">
          {note && <p className="mr-auto text-[12px] text-muted-foreground">{note}</p>}
          {trackingMissing && (
            <p className="w-full text-[11px] text-amber-700">
              Без трек-номера покупатель получит письмо «отправлен» без ссылки на отслеживание.
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            disabled={saving}
            className="min-h-[34px] rounded-lg border border-border px-3 text-[12px] text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          >
            Не менять
          </button>
          <button
            type="button"
            disabled={saving || trackingTooShort}
            onClick={() => (risky ? setConfirming(true) : void save())}
            className={cn(
              'inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
              risky ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-foreground text-background hover:bg-foreground/90',
            )}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Сохранить: {STATUS_LABELS_RU[status]}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={status === 'cancelled' ? `Отменить заказ ${order.id}?` : `Отметить ${order.id} как «возвращён»?`}
        description={note ?? undefined}
        details={
          order.customer.email ? <p>Покупатель ({order.customer.email}) получит письмо об этом.</p> : undefined
        }
        confirmLabel={status === 'cancelled' ? 'Отменить заказ' : 'Сменить статус'}
        cancelLabel="Не менять"
        busy={saving}
        onConfirm={() => void save()}
      />
    </div>
  )
}
