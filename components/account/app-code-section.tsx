'use client'

import { Check, Copy, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { LoadError } from '@/components/load-error'
import { Link } from '@/components/locale-link'
import type { AppCodeView, PromoKind } from '@/lib/promo-codes'
import { isStandalone } from '@/lib/pwa'
import { formatPrice, useStore } from '@/lib/store'

/** "−10%" or "−CHF 20" (in the shopper's display currency). */
export function appDiscountLabel(kind: PromoKind, value: number): string {
  return kind === 'percent' ? `−${value}%` : `−${formatPrice(value, true)}`
}

/**
 * The customer's personal app code: the code as text with a copy button, the
 * same code as a QR code, and its terms.
 *
 * Issued only inside the installed app (display-mode: standalone): opened in
 * a browser tab, the section explains how to install instead. One code per
 * account — /api/app/welcome-code never issues a second.
 */
export function AppCodeSection() {
  const { t, tf, locale, pushToast } = useStore()
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'failed' } | { kind: 'loaded'; view: AppCodeView; inApp: boolean }>({
    kind: 'loading',
  })
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    const inApp = isStandalone()
    try {
      // In the app, asking IS the first launch's issue; in a tab, only look.
      const res = await fetch('/api/app/welcome-code', { method: inApp ? 'POST' : 'GET', cache: 'no-store' })
      const view = (await res.json().catch(() => null)) as AppCodeView | null
      if (!view || !('status' in view)) return setState({ kind: 'failed' })
      setState({ kind: 'loaded', view, inApp })
    } catch {
      setState({ kind: 'failed' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const code = state.kind === 'loaded' && 'code' in state.view ? state.view.code : null

  // The QR is drawn in the browser, from the code alone — nothing leaves the
  // page. Loaded on demand: the library is only needed here.
  useEffect(() => {
    if (!code) return
    let cancelled = false
    import('qrcode')
      .then((QRCode) =>
        QRCode.toDataURL(code, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#0A0A0A', light: '#F5F1E8' } }),
      )
      .then((url) => {
        if (!cancelled) setQr(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [code])

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      pushToast({ title: t('appCode.copied'), variant: 'success' })
    } catch {
      pushToast({ title: t('ref.copyFailed'), variant: 'default' })
    }
  }

  if (state.kind === 'loading') {
    return <div className="h-[280px] max-w-2xl animate-pulse border border-white/10 bg-white/[0.02]" aria-busy="true" aria-label={t('common.loading')} />
  }
  if (state.kind === 'failed') return <LoadError title={t('appCode.unavailable')} onRetry={load} />

  const { view, inApp } = state
  const note = (text: string) => (
    <div className="max-w-xl border border-white/10 p-6">
      <p className="text-[14px] font-light leading-relaxed text-foreground/75">{text}</p>
    </div>
  )

  if (view.status === 'unavailable') return note(t('appCode.unavailable'))
  if (view.status === 'signed_out') return note(t('appCode.unavailable'))
  if (view.status === 'disabled') {
    if (inApp) return note(t('appCode.disabled'))
    // In a browser tab with no code yet: the way to get one.
    return (
      <div className="max-w-xl border border-white/10 p-6">
        <Smartphone className="size-5 text-foreground/60" strokeWidth={1.5} aria-hidden />
        <p className="mt-4 text-[14px] font-light leading-relaxed text-foreground/75">{t('appCode.installFirst')}</p>
        <Link href="/#app" className="nav-link t-label tap-safe mt-5 inline-block">
          {t('appCode.installLink')}
        </Link>
      </div>
    )
  }

  if (!('code' in view)) return note(t('appCode.unavailable'))

  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <section className="max-w-2xl border border-white/10 p-6 sm:p-8">
      <h2 className="text-balance font-serif text-[24px] font-normal leading-[1.15] tracking-tight text-foreground sm:text-[30px]">
        {tf('appCode.title', { discount: appDiscountLabel(view.kind, view.value) })}
      </h2>

      <div className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-start">
        <div className="shrink-0">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={tf('appCode.qrAlt', { code: view.code })} width={180} height={180} className="size-[180px]" />
          ) : (
            <div className="size-[180px] animate-pulse bg-white/[0.04]" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className={view.status === 'ready' ? '' : 'opacity-50'}>
            <span className="block font-mono text-[28px] tracking-[0.12em] text-foreground">{view.code}</span>
          </p>

          {view.status === 'ready' ? (
            <>
              <button
                type="button"
                onClick={() => copy(view.code)}
                className="mt-4 inline-flex min-h-[44px] items-center gap-2 border border-white/10 px-4 text-[13px] font-light text-foreground/80 transition-colors hover:border-white/30 hover:text-foreground"
              >
                {copied ? <Check className="size-4" strokeWidth={1.5} /> : <Copy className="size-4" strokeWidth={1.5} />}
                {t('appCode.copy')}
              </button>
              <ul className="mt-5 space-y-1 text-[13px] font-light text-foreground/60">
                {view.expiresAt && <li>{tf('appCode.validUntil', { date: dateFmt.format(new Date(view.expiresAt)) })}</li>}
                {view.usesLeft !== null && view.usesLeft > 1 && <li>{tf('appCode.usesLeft', { n: view.usesLeft })}</li>}
              </ul>
              <p className="mt-5 text-[13px] font-light leading-relaxed text-foreground/60">{t('appCode.howTo')}</p>
            </>
          ) : (
            <p className="mt-4 text-[14px] font-light text-foreground/70">
              {view.status === 'used' ? t('appCode.used') : t('appCode.expired')}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
