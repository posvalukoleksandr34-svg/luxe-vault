'use client'

import { AlertTriangle, ArrowLeft, Check, Copy, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Order, PaymentStatus } from '@/lib/types'

type ResolvedCryptoOption = {
  id: string
  label: string
  network: string
  ticker: string
}

type Stage = 'loading' | 'select' | 'creating' | 'awaiting' | 'paid' | 'error' | 'unavailable'

const POLL_INTERVAL_MS = 4000
const TERMINAL_STATUSES: PaymentStatus[] = ['paid', 'failed', 'expired']

/**
 * Opens a crypto gateway session for an order that already exists in the
 * database. The order is always created first (as `pending_payment`), so
 * abandoning this screen leaves a payable order behind rather than losing
 * the purchase — the same session can be reopened later from the account.
 */
export function CryptoPayment({
  orderId,
  token,
  onPaid,
  onBack,
}: {
  orderId: string
  token: string
  onPaid: () => void
  onBack: () => void
}) {
  const { t } = useStore()
  const [stage, setStage] = useState<Stage>('loading')
  const [options, setOptions] = useState<ResolvedCryptoOption[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('pending_payment')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load the currently payable currency/network options once on mount.
  useEffect(() => {
    let cancelled = false
    fetch('/api/payments/crypto/currencies')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (!data.configured || !Array.isArray(data.options) || data.options.length === 0) {
          setStage('unavailable')
          return
        }
        setOptions(data.options)
        setStage('select')
      })
      .catch(() => {
        if (!cancelled) setStage('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  async function selectOption(option: ResolvedCryptoOption) {
    setStage('creating')
    setErrorMessage(null)
    try {
      // The amount comes from the stored order, never from the browser.
      const res = await fetch('/api/payments/crypto/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, token, optionId: option.id, ticker: option.ticker }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMessage(data?.error || 'Не удалось создать платёж')
        setStage('error')
        return
      }

      const createdOrder: Order = data.order
      setOrder(createdOrder)
      setExpiresAt(data.expiresAt)
      setPaymentStatus('pending_payment')
      setStage('awaiting')

      QRCode.toDataURL(createdOrder.paymentAddress || '', {
        margin: 1,
        width: 240,
        color: { dark: '#f5f3ef', light: '#00000000' },
      })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(null))

      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/payments/crypto/status?orderId=${encodeURIComponent(createdOrder.id)}`)
          if (!statusRes.ok) return
          const statusData = await statusRes.json()
          const next: PaymentStatus = statusData.paymentStatus || 'pending_payment'
          setPaymentStatus(next)
          if (TERMINAL_STATUSES.includes(next)) {
            stopPolling()
            if (next === 'paid') {
              setStage('paid')
              setTimeout(onPaid, 1800)
            }
          }
        } catch {
          // transient network error — keep polling
        }
      }, POLL_INTERVAL_MS)
    } catch {
      setErrorMessage('Сеть недоступна')
      setStage('error')
    }
  }

  async function copyAddress() {
    if (!order?.paymentAddress) return
    try {
      await navigator.clipboard.writeText(order.paymentAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API unavailable — the address is still visible to copy manually
    }
  }

  if (stage === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="size-5 animate-spin text-gold" />
        <p className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground">{t('crypto.loading')}</p>
      </div>
    )
  }

  if (stage === 'unavailable') {
    return (
      <div className="flex flex-col items-center gap-5 border border-border py-12 text-center">
        <AlertTriangle className="size-6 text-muted-foreground" />
        <p className="max-w-xs text-[13px] font-light text-muted-foreground">{t('crypto.unavailable')}</p>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] uppercase tracking-[0.15em] text-gold transition hover:text-gold-light"
        >
          <ArrowLeft className="size-3.5" />
          {t('crypto.back')}
        </button>
      </div>
    )
  }

  if (stage === 'select') {
    return (
      <div>
        <button
          type="button"
          onClick={onBack}
          className="mb-5 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t('crypto.back')}
        </button>
        <p className="mb-4 text-[11px] uppercase tracking-[0.15em] text-foreground">
          {t('crypto.selectNetwork')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => selectOption(opt)}
              className="flex flex-col items-start gap-0.5 border border-border px-4 py-3 text-left transition-all duration-200 hover:border-gold/50 hover:bg-gold/5"
            >
              <span className="font-mono text-sm font-medium text-foreground">{opt.label}</span>
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{opt.network}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (stage === 'creating') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="size-5 animate-spin text-gold" />
        <p className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground">{t('crypto.creating')}</p>
      </div>
    )
  }

  if (stage === 'error') {
    return (
      <div className="flex flex-col items-center gap-5 border border-destructive/30 py-12 text-center">
        <AlertTriangle className="size-6 text-destructive" />
        <p className="max-w-xs text-[13px] font-light text-muted-foreground">{errorMessage}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setStage('select')}
            className="text-[12px] uppercase tracking-[0.15em] text-gold transition hover:text-gold-light"
          >
            {t('crypto.tryAgain')}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground transition hover:text-foreground"
          >
            {t('crypto.back')}
          </button>
        </div>
      </div>
    )
  }

  // stage is 'awaiting' or 'paid' from here — both render the payment view,
  // differing only in the status indicator and QR/copy affordances.
  if (!order) return null

  return (
    <div className="card-gold flex flex-col items-center p-6 text-center">
      <StatusIndicator status={paymentStatus} />

      {paymentStatus !== 'paid' && (
        <>
          <div className="mt-5 flex size-[168px] items-center justify-center border border-border bg-background p-2">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt={t('crypto.address')} className="size-full" />
            ) : (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            )}
          </div>

          <p className="mt-6 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            {t('crypto.amountDue')}
          </p>
          <p className="mt-1 font-mono text-xl font-medium text-gold">
            {order.paymentAmount} {order.paymentCurrency?.toUpperCase()}
          </p>

          <p className="mt-5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            {t('crypto.address')}
          </p>
          <div className="mt-2 flex w-full items-center gap-2 border border-border bg-background px-3 py-2.5">
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] text-foreground">
              {order.paymentAddress}
            </span>
            <button
              type="button"
              onClick={copyAddress}
              className={cn(
                'flex shrink-0 items-center gap-1 border px-2 py-1 text-[10px] uppercase tracking-wider transition',
                copied
                  ? 'border-gold/50 text-gold'
                  : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
              )}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? t('crypto.copied') : t('crypto.copy')}
            </button>
          </div>

          <p className="mt-4 max-w-xs text-[11px] font-light leading-relaxed text-muted-foreground/70">
            {t('crypto.sendExactly')}
          </p>
          {expiresAt && (
            <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground/50">
              {new Date(expiresAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          <p className="mt-5 text-[10px] uppercase tracking-[0.15em] text-gold/70">
            {t('crypto.doNotClose')}
          </p>
        </>
      )}

      {paymentStatus === 'paid' && (
        <p className="mt-4 max-w-xs text-[13px] font-light leading-relaxed text-muted-foreground">
          {t('crypto.thankYou')}
        </p>
      )}
    </div>
  )
}

function StatusIndicator({ status }: { status: PaymentStatus }) {
  const { t } = useStore()

  const config: Record<PaymentStatus, { label: string; dot: string; text: string }> = {
    pending_payment: { label: t('crypto.waiting'), dot: 'bg-gold animate-pulse', text: 'text-gold' },
    confirming: { label: t('crypto.confirming'), dot: 'bg-gold animate-pulse', text: 'text-gold' },
    paid: { label: t('crypto.paid'), dot: 'bg-emerald-400', text: 'text-emerald-400' },
    failed: { label: t('crypto.failed'), dot: 'bg-destructive', text: 'text-destructive' },
    expired: { label: t('crypto.expired'), dot: 'bg-destructive', text: 'text-destructive' },
  }
  const c = config[status]

  return (
    <div className="flex items-center gap-2 border border-border px-4 py-2">
      <span className={cn('size-1.5 rounded-full', c.dot)} />
      <span className={cn('text-[11px] uppercase tracking-[0.15em]', c.text)}>{c.label}</span>
    </div>
  )
}
