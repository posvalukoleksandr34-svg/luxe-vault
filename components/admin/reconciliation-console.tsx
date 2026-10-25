'use client'

import { RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { AdminPageHeader } from '@/components/admin/admin-shell'
import { ConfirmDialog } from '@/components/admin/confirm-dialog'
import { Badge, Button, Spinner, api, inputClass } from '@/components/admin/refunds/shared'
import type { Discrepancy, DiscrepancyKind } from '@/lib/payment-reconciliation'
import { cn } from '@/lib/utils'

type Report = {
  since: string
  payments: number
  orders: number
  truncated: boolean
  discrepancies: Discrepancy[]
}

/**
 * /admin/reconciliation — card payments in Stripe against the orders
 * (GET /api/admin/reconciliation). Each line says what disagrees and what to
 * do about it. One kind has a button: money Stripe took for an order that is
 * not marked paid. The server re-checks that payment with Stripe before
 * recording anything (app/api/admin/reconciliation/apply/route.ts); every
 * other kind is settled by a person in Stripe, the orders page or refunds.
 */
const KIND: Record<DiscrepancyKind, { title: string; advice: string; tone: 'red' | 'amber' | 'muted' }> = {
  paid_not_recorded: {
    title: 'Деньги в Stripe есть, заказ не отмечен оплаченным',
    advice:
      'Обычно это значит, что событие от Stripe не дошло до сайта. Проверьте платёж в Stripe и, если он ваш, отметьте заказ оплаченным — сайт ещё раз спросит Stripe перед записью.',
    tone: 'red',
  },
  processing_not_recorded: {
    title: 'Stripe ещё проводит платёж, заказ об этом не знает',
    advice:
      'Банковский перевод или Klarna подтверждаются до нескольких дней. Не отменяйте заказ. Если статус не меняется больше недели — проверьте платёж в Stripe.',
    tone: 'amber',
  },
  recorded_not_paid: {
    title: 'Заказ отмечен оплаченным, а в Stripe денег нет',
    advice: 'Не отправляйте заказ, пока не выясните. Найдите платёж в Stripe; если денег нет — свяжитесь с покупателем.',
    tone: 'red',
  },
  amount_mismatch: {
    title: 'Сумма платежа не совпадает с заказом',
    advice:
      'Не отправляйте заказ, пока не выясните. Недоплаченный заказ не отмечается оплаченным: свяжитесь с покупателем или верните деньги в Stripe. Переплату верните частичным возвратом в разделе «Возвраты».',
    tone: 'red',
  },
  currency_mismatch: {
    title: 'Валюта платежа не совпадает с заказом',
    advice: 'Сверьте платёж в Stripe с заказом и решите вручную: вернуть деньги или согласовать с покупателем.',
    tone: 'red',
  },
  refund_not_recorded: {
    title: 'Возврат сделан в Stripe, в заказе не записан',
    advice: 'Скорее всего, не дошло событие о возврате. Проверьте, что вебхук Stripe подписан на события возвратов (OA-08).',
    tone: 'amber',
  },
  refund_recorded_not_made: {
    title: 'Возврат записан в заказе, а в Stripe его нет',
    advice: 'Покупатель мог не получить деньги. Откройте заявку в «Возвратах» и проверьте возврат в Stripe.',
    tone: 'red',
  },
  payment_without_order: {
    title: 'Платёж в Stripe, к которому не привязан заказ',
    advice: 'Найдите покупателя по платежу в Stripe: верните деньги или оформите заказ вручную.',
    tone: 'amber',
  },
}

const SPANS = [7, 30, 90] as const

export function ReconciliationConsole() {
  const [days, setDays] = useState<number>(7)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<Discrepancy | null>(null)
  const [applying, setApplying] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api<Report>(`/api/admin/reconciliation?days=${days}`)
      .then(setReport)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [days])

  useEffect(() => load(), [load])

  async function apply(d: Discrepancy) {
    setApplying(true)
    try {
      const r = await api<{ order: string; unchanged?: boolean; receiptSent?: boolean }>('/api/admin/reconciliation/apply', {
        method: 'POST',
        json: { paymentId: d.paymentId, orderId: d.orderId },
      })
      setNotice(
        r.unchanged
          ? `Заказ ${r.order} уже был отмечен оплаченным.`
          : `Заказ ${r.order} отмечен оплаченным по данным Stripe.${r.receiptSent ? ' Покупателю отправлена квитанция.' : ''}`,
      )
      setPending(null)
      load()
    } catch (e) {
      setNotice(null)
      setError((e as Error).message)
      setPending(null)
    } finally {
      setApplying(false)
    }
  }

  const list = report?.discrepancies ?? []

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Сверка платежей"
        description="Платежи картой в Stripe сравниваются с заказами. Ничего не меняется само: каждое расхождение решаете вы."
        actions={
          <>
            <select
              aria-label="Период"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className={cn(inputClass, 'w-auto')}
            >
              {SPANS.map((d) => (
                <option key={d} value={d}>
                  За {d} дней
                </option>
              ))}
            </select>
            <Button onClick={load} busy={loading}>
              <RefreshCw className="size-4" /> Обновить
            </Button>
          </>
        }
      />

      {notice && (
        <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {!report && loading && <Spinner />}

      {report && (
        <>
          <p className="text-sm text-muted-foreground">
            С {new Date(report.since).toLocaleDateString('ru-RU')}: платежей в Stripe — {report.payments}, заказов — {report.orders}.
            {report.truncated && ' Платежей больше 1000 — показаны последние; сократите период.'}
          </p>

          {list.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              Расхождений нет: каждый платёж совпадает со своим заказом.
            </p>
          ) : (
            <ul aria-label="Расхождения" className="space-y-3">
              {list.map((d) => {
                const k = KIND[d.kind]
                return (
                  <li key={`${d.kind}:${d.paymentId}:${d.orderId ?? ''}`} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Badge tone={k.tone}>{k.title}</Badge>
                        <p className="mt-2 text-sm text-foreground">
                          {d.orderId ? (
                            <Link href={`/admin/orders?order=${encodeURIComponent(d.orderId)}`} className="font-mono hover:underline">
                              {d.orderId}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">Без заказа</span>
                          )}
                          <span className="mx-2 text-muted-foreground">·</span>
                          <span className="break-all font-mono text-xs text-muted-foreground">{d.paymentId}</span>
                        </p>
                        <p className="mt-1 break-words text-xs text-muted-foreground">{d.detail}</p>
                      </div>
                      {d.kind === 'paid_not_recorded' && d.orderId && (
                        <Button tone="primary" onClick={() => setPending(d)}>
                          Отметить оплаченным
                        </Button>
                      )}
                    </div>
                    <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{k.advice}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={`Отметить заказ ${pending?.orderId ?? ''} оплаченным?`}
        tone="default"
        busy={applying}
        confirmLabel="Отметить оплаченным"
        description="Сайт ещё раз запросит этот платёж в Stripe и запишет оплату, только если Stripe подтверждает её, платёж относится к этому заказу и сумма совпадает."
        details={
          <ul className="list-disc space-y-1 pl-5">
            <li>Будет сделано то же, что при обычной оплате: проверка остатков, уведомление в Telegram и квитанция покупателю на почту (если почта настроена).</li>
            <li>Отменить отметку отсюда нельзя.</li>
          </ul>
        }
        onConfirm={() => pending && void apply(pending)}
      />
    </div>
  )
}
