'use client'

import { Smartphone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { isStandalone } from '@/lib/pwa'
import { useStore } from '@/lib/store'

/**
 * "Скачайте приложение LUXE VAULT" — the PWA install banner above the footer.
 *
 * There is no App Store build: the shop IS the app (app/manifest.ts +
 * public/sw.js), so this installs the PWA rather than linking to a store.
 * What the visitor sees depends on what their browser actually supports:
 *
 *   Chrome / Edge / Samsung  the browser fires `beforeinstallprompt`, which is
 *                            captured and replayed on the button — the native
 *                            "Add to home screen" sheet.
 *   iOS Safari               never fires that event and has no API for it, so
 *                            the real steps are spelled out instead of a
 *                            button that could not work.
 *   Desktop without a prompt a QR code of this site, to continue on a phone.
 *
 * The banner hides itself once the app is installed (display-mode:standalone,
 * iOS's navigator.standalone, or the `appinstalled` event), so it never asks
 * someone to install what they are already using.
 *
 * Colours: .app-promo in app/globals.css — cream into sand into a matte gold,
 * the storefront's own palette, with near-black type. It was a gradient left
 * over from the dark theme (near-black → white → near-black), which on the
 * light storefront read as brushed steel and put dark text on dark ends.
 */

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Mode = 'prompt' | 'ios' | 'qr'

export function AppPromoBanner() {
  const { t } = useStore()
  const [installed, setInstalled] = useState(false)
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)
  const [mode, setMode] = useState<Mode>('qr')
  /** Where to fall back when the captured prompt is used up: a phone gets the
   *  iOS steps, anything else the QR. */
  const [fallbackMode, setFallbackMode] = useState<Exclude<Mode, 'prompt'>>('qr')
  const [qr, setQr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true)
      return
    }

    const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    setFallbackMode(ios ? 'ios' : 'qr')
    setMode(ios ? 'ios' : 'qr')

    const onBeforeInstall = (event: Event) => {
      // Chrome shows its own mini-infobar unless the event is cancelled; the
      // banner's button replays it at a moment the visitor chose.
      event.preventDefault()
      setPromptEvent(event as InstallPromptEvent)
      setMode('prompt')
    }
    const onInstalled = () => {
      setInstalled(true)
      setPromptEvent(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // The QR is only drawn when it is the thing being shown, and the library
  // (~50 kB) is fetched only then — never for the phones that get a button.
  useEffect(() => {
    if (installed || mode !== 'qr') return
    let cancelled = false
    import('qrcode')
      .then((QRCode) =>
        QRCode.toDataURL(window.location.origin, {
          margin: 1,
          width: 240,
          color: { dark: '#2a2118', light: '#00000000' },
        }),
      )
      .then((url) => {
        if (!cancelled) setQr(url)
      })
      .catch(() => {
        // No QR: the copy still explains what the app is.
      })
    return () => {
      cancelled = true
    }
  }, [installed, mode])

  const install = useCallback(async () => {
    if (!promptEvent) return
    setPending(true)
    try {
      await promptEvent.prompt()
      const { outcome } = await promptEvent.userChoice
      if (outcome === 'accepted') setInstalled(true)
      // Declined: a captured prompt cannot be replayed, so the button would be
      // dead. Show the QR again instead — and if the browser offers another
      // prompt later, `beforeinstallprompt` puts the button back.
      else setMode(fallbackMode)
    } catch {
      // The sheet was dismissed by the browser itself; nothing to report.
      setMode(fallbackMode)
    } finally {
      setPromptEvent(null)
      setPending(false)
    }
  }, [promptEvent, fallbackMode])

  if (installed) return null

  return (
    // The panel alone: it lives in the account's "App" section now (the
    // homepage was reduced to hero, departments, products and the footer).
    <div id="app" className="app-promo relative flex scroll-mt-24 flex-col items-start gap-8 overflow-hidden rounded-xl px-6 py-10 sm:px-10 sm:py-12 md:flex-row md:items-center md:justify-between md:gap-12">
          {/* A gold hairline along the top edge, as on the storefront's other panels. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent"
          />

          <div className="relative max-w-xl">
            <p className="app-promo__eyebrow text-[10px] uppercase tracking-[0.34em]">LUXE VAULT</p>
            <h3
              id="app-promo-title"
              className="mt-4 font-sans text-2xl font-bold uppercase leading-tight tracking-[0.08em] text-[#1c1c1c] sm:text-3xl"
            >
              {t('app.promoTitle')}
            </h3>
            <p className="app-promo__text mt-4 max-w-md text-[13px] font-light leading-relaxed">
              {t('app.promoSubtitle')}
            </p>
          </div>

          <div className="relative flex w-full shrink-0 flex-col items-start gap-3 md:w-auto md:items-end">
            {mode === 'prompt' && (
              <>
                {/* Same gold fill as the newsletter's "Подписаться" directly
                    below, so the two calls to action read as one system. */}
                <button
                  type="button"
                  onClick={install}
                  disabled={!promptEvent || pending}
                  aria-busy={pending}
                  className="rounded-xl no-juice inline-flex w-full items-center justify-center gap-2.5 border border-gold bg-gold-gradient px-8 py-4 text-[11px] font-medium uppercase tracking-[0.2em] text-gold-foreground transition-colors duration-300 enabled:hover:bg-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 md:w-auto shadow-gold"
                >
                  <Smartphone aria-hidden strokeWidth={1.5} className="size-4" />
                  {t('app.install')}
                </button>
                <p className="app-promo__text text-[11px] font-light">{t('app.installHint')}</p>
              </>
            )}

            {mode === 'ios' && (
              <div className="rounded-xl border border-gold/30 bg-white/55 px-5 py-4">
                <p className="text-[10px] uppercase tracking-[0.24em] text-gold">{t('app.install')}</p>
                <p className="app-promo__text mt-2 max-w-xs text-[12px] font-light leading-relaxed">
                  {t('app.iosHint')}
                </p>
              </div>
            )}

            {mode === 'qr' && (
              <div className="flex items-center gap-4">
                {/* A pale ivory tile set into the panel with a gold hairline.
                    The code stays dark on light — what every phone camera is
                    built to read — in a deep brown rather than black, so it
                    belongs to the palette without losing contrast. */}
                <div className="app-promo__qr flex size-[104px] items-center justify-center rounded-xl p-2">
                  {qr ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a data: URI generated in the browser; the optimiser cannot serve it.
                    <img src={qr} alt={t('app.qrAlt')} width={88} height={88} className="size-full object-contain" />
                  ) : (
                    <Smartphone aria-hidden strokeWidth={1} className="size-7 text-[#8A7B5C]" />
                  )}
                </div>
                <p className="app-promo__text max-w-[12rem] text-[11px] font-light leading-relaxed">
                  {t('app.qrHint')}
                </p>
              </div>
            )}
          </div>
    </div>
  )
}
