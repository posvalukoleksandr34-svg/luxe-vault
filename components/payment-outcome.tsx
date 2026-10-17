'use client'

import { AlertCircle, CheckCircle2, Clock, LayoutGrid, RefreshCw } from 'lucide-react'
import { Header } from '@/components/header'
import { StateActionButton } from '@/components/state-view'
import { useStore } from '@/lib/store'

export type PaymentOutcomeState = 'succeeded' | 'processing' | 'declined' | 'incomplete'

/**
 * Where a payment that had to leave the site comes back to (3-D Secure, bank
 * redirects) when the result is not simply "paid".
 *
 * In the visitor's language — this page used to be hardcoded Russian — and in
 * the shop's own tones: a declined card is news, not an alarm, so the icon is
 * gold rather than red. Every outcome offers the next step: pay again (from
 * the account drawer, where unpaid orders live — guests' included), or see
 * the order, or go back to the catalogue.
 *
 * Purely a display. `redirect_status` in the URL is a hint anyone can type;
 * the order's real state is set only by the signed webhook.
 */
const COPY: Record<
  PaymentOutcomeState,
  { title: Parameters<ReturnType<typeof useStore>['t']>[0]; body: Parameters<ReturnType<typeof useStore>['t']>[0] }
> = {
  succeeded: { title: 'pay.successTitle', body: 'pay.successBody' },
  processing: { title: 'pay.processingTitle', body: 'pay.processingBody' },
  declined: { title: 'pay.declinedTitle', body: 'pay.declinedBody' },
  incomplete: { title: 'pay.incompleteTitle', body: 'pay.incompleteBody' },
}

export function PaymentOutcome({ state, orderId }: { state: PaymentOutcomeState; orderId?: string }) {
  const { t, openAccount } = useStore()
  const copy = COPY[state]
  const Icon = state === 'succeeded' ? CheckCircle2 : state === 'processing' ? Clock : AlertCircle
  const canRetry = state === 'declined' || state === 'incomplete'

  return (
    <>
      <Header />
      <main
        id="main"
        className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center gap-6 px-6 py-16 text-center"
      >
        <Icon className="size-10 text-gold" strokeWidth={1.25} aria-hidden />

        <div className="space-y-3">
          <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">{t(copy.title)}</h1>
          <p className="text-[14px] font-light leading-relaxed text-muted-foreground">{t(copy.body)}</p>
        </div>

        {orderId && (
          <p className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground">
            {t('pay.orderLabel')} <span className="text-gold">{orderId}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3">
          {canRetry ? (
            <StateActionButton
              action={{ label: t('pay.tryAgain'), icon: RefreshCw, onClick: () => openAccount('orders') }}
            />
          ) : orderId ? (
            <StateActionButton action={{ label: t('pay.viewOrder'), href: `/order/${encodeURIComponent(orderId)}` }} />
          ) : null}
          {canRetry && orderId ? (
            <StateActionButton
              variant="secondary"
              action={{ label: t('pay.viewOrder'), href: `/order/${encodeURIComponent(orderId)}` }}
            />
          ) : (
            <StateActionButton
              variant="secondary"
              action={{ label: t('state.goToCatalog'), href: '/catalog', icon: LayoutGrid }}
            />
          )}
        </div>
      </main>
    </>
  )
}
