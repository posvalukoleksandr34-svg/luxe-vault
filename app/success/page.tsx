import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * Landing page for payments that had to leave the site.
 *
 * Most card payments never reach here: `redirect: 'if_required'` keeps them on
 * /checkout, and that page routes straight to /checkout/success. This page is
 * where a 3-D Secure step-up or a redirect-based method returns to.
 *
 * A successful return is forwarded to /checkout/success so a customer who was
 * bounced through their bank sees the same thank-you page as everyone else,
 * rather than a second, thinner confirmation screen. Only the outcomes that
 * page cannot express — still processing, or declined — are rendered here.
 *
 * IMPORTANT: `redirect_status` in this URL is a display hint, nothing more.
 * Anyone can type `?redirect_status=succeeded`, so neither this page nor the
 * one it forwards to marks anything paid or trusts the value: /checkout/success
 * re-reads the order as the signed-in customer, and the order's real state is
 * set only by the signed webhook at /api/payments/stripe/webhook.
 */
export default function SuccessPage({
  searchParams,
}: {
  searchParams: { order?: string; redirect_status?: string }
}) {
  const orderId = searchParams.order
  const status = searchParams.redirect_status

  const state =
    status === 'failed'
      ? ('failed' as const)
      : status === 'processing'
        ? ('processing' as const)
        : ('succeeded' as const)

  if (state === 'succeeded' && orderId) {
    redirect(`/checkout/success?order=${encodeURIComponent(orderId)}`)
  }

  const copy = {
    succeeded: {
      Icon: CheckCircle2,
      title: 'Оплата принята',
      body: 'Спасибо! Мы получили платёж и уже готовим заказ к отправке. Подтверждение придёт на вашу почту.',
    },
    processing: {
      Icon: Clock,
      title: 'Платёж обрабатывается',
      body: 'Банк ещё подтверждает операцию — это может занять несколько минут. Статус обновится в личном кабинете автоматически.',
    },
    failed: {
      Icon: XCircle,
      title: 'Платёж не прошёл',
      body: 'Списание не состоялось. Заказ сохранён — его можно оплатить повторно из личного кабинета.',
    },
  }[state]

  const { Icon } = copy

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <Icon
        className={state === 'failed' ? 'size-10 text-destructive' : 'size-10 text-gold'}
        strokeWidth={1.25}
      />

      <div className="space-y-3">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">
          {copy.title}
        </h1>
        <p className="text-[14px] font-light leading-relaxed text-muted-foreground">{copy.body}</p>
      </div>

      {orderId && (
        <p className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground/70">
          Заказ <span className="text-gold">{orderId}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {orderId && (
          <Link
            href={`/order/${orderId}`}
            className="border border-gold/30 bg-gold/5 px-6 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
          >
            Статус заказа
          </Link>
        )}
        <Link
          href="/"
          className="border border-border px-6 py-3 text-[12px] uppercase tracking-[0.15em] text-muted-foreground transition-all duration-300"
        >
          В магазин
        </Link>
      </div>
    </main>
  )
}
