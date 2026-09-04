'use client'

import { ArrowLeft, Loader2, Package, RefreshCw, Wallet } from 'lucide-react'
import { useState } from 'react'
import { CryptoPayment } from '@/components/crypto-payment'
import { tokenFor } from '@/lib/order-registry'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Order, OrderStatus, PaymentStatus } from '@/lib/types'

const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  'В обработке': 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  'Отправлен': 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  'Доставлен': 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  'Отменён': 'text-red-400 bg-red-400/10 border-red-400/30',
}

/** An order still owes money whenever it carries a payment status that isn't
 * `paid` — cash-on-delivery orders carry none at all, so they never show up
 * in the unpaid list. */
export function isUnpaid(order: Order): boolean {
  return Boolean(order.paymentStatus) && order.paymentStatus !== 'paid'
}

export function AccountOrders({
  orders,
  loading,
  onReload,
  unpaidOnly = false,
}: {
  orders: Order[]
  loading: boolean
  onReload: () => void
  unpaidOnly?: boolean
}) {
  const { t, locale } = useStore()
  const [paying, setPaying] = useState<{ orderId: string; token: string } | null>(null)

  const load = onReload
  const unpaid = orders.filter(isUnpaid)
  const history = orders.filter((o) => !isUnpaid(o))

  function startPayment(order: Order) {
    const token = order.lookupToken ?? tokenFor(order.id)
    if (!token) return
    setPaying({ orderId: order.id, token })
  }

  if (paying) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setPaying(null)}
          className="mb-5 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t('crypto.back')}
        </button>
        <p className="mb-4 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          {t('orders.payingFor')} <span className="text-foreground">{paying.orderId}</span>
        </p>
        <CryptoPayment
          orderId={paying.orderId}
          token={paying.token}
          onPaid={() => {
            setPaying(null)
            load()
          }}
          onBack={() => setPaying(null)}
        />
      </div>
    )
  }

  // The guest-facing block stays silent unless there is actually something
  // unpaid to act on.
  if (unpaidOnly && (loading || unpaid.length === 0)) return null

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12">
        <Loader2 className="size-4 animate-spin text-gold" />
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground">
          {t('crypto.loading')}
        </span>
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Package className="size-9 text-muted-foreground/30" strokeWidth={1} />
        <p className="text-sm font-light text-muted-foreground">{t('user.noOrders')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {unpaid.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-gold/30 pb-2">
            <h3 className="text-[11px] uppercase tracking-[0.2em] text-gold">
              {t('orders.unpaidTitle')} · {unpaid.length}
            </h3>
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground transition hover:text-foreground"
            >
              <RefreshCw className="size-3" />
              {t('orders.refresh')}
            </button>
          </div>
          <p className="mb-4 text-[11px] font-light leading-relaxed text-muted-foreground/70">
            {t('orders.unpaidHint')}
          </p>
          <div className="space-y-3">
            {unpaid.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                locale={locale}
                highlight
                action={
                  <button
                    type="button"
                    onClick={() => startPayment(order)}
                    className="flex items-center justify-center gap-2 border border-gold/40 bg-gold/10 px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
                  >
                    <Wallet className="size-3.5" />
                    {t('orders.payNow')}
                  </button>
                }
              />
            ))}
          </div>
        </section>
      )}

      {!unpaidOnly && history.length > 0 && (
        <section>
          <h3 className="mb-3 border-b border-border pb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {t('orders.historyTitle')} · {history.length}
          </h3>
          <div className="space-y-3">
            {history.map((order) => (
              <OrderCard key={order.id} order={order} locale={locale} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function PaymentBadge({ status }: { status: PaymentStatus }) {
  const { t } = useStore()
  const map: Record<PaymentStatus, { label: string; className: string }> = {
    pending_payment: { label: t('orders.awaitingPayment'), className: 'text-gold border-gold/40 bg-gold/10' },
    confirming: { label: t('crypto.confirming'), className: 'text-blue-400 border-blue-400/30 bg-blue-400/10' },
    paid: { label: t('crypto.paid'), className: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' },
    failed: { label: t('crypto.failed'), className: 'text-red-400 border-red-400/30 bg-red-400/10' },
    expired: { label: t('crypto.expired'), className: 'text-red-400 border-red-400/30 bg-red-400/10' },
  }
  const c = map[status]
  return (
    <span className={cn('border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em]', c.className)}>
      {c.label}
    </span>
  )
}

function OrderCard({
  order,
  locale,
  action,
  highlight,
}: {
  order: Order
  locale: string
  action?: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className={cn('border p-4', highlight ? 'border-gold/30 bg-gold/[0.03]' : 'border-border bg-card')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[13px] font-medium text-foreground">{order.id}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {new Date(order.createdAt).toLocaleDateString(locale)} · {order.payment}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="font-serif text-lg text-gold">{formatPrice(order.total)}</span>
          <div className="flex flex-wrap justify-end gap-1.5">
            <span
              className={cn(
                'border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em]',
                ORDER_STATUS_COLORS[order.status],
              )}
            >
              {order.status}
            </span>
            {order.paymentStatus && <PaymentBadge status={order.paymentStatus} />}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
        {order.items.map((item) => (
          <div key={item.key} className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.image} alt={item.name} className="size-10 shrink-0 object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-light text-foreground">{item.name}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                {item.size} · {item.color} · ×{item.qty}
              </p>
            </div>
            <span className="shrink-0 text-[12px] font-light text-foreground">
              {formatPrice(item.price * item.qty)}
            </span>
          </div>
        ))}
      </div>

      {action && <div className="mt-4 flex justify-end">{action}</div>}
    </div>
  )
}
