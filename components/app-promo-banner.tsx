'use client'

import { Smartphone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Reveal } from '@/components/reveal'
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
 * Light on purpose: a warm beige panel against the storefront's black is the
 * one place on the page that reads as an advertisement rather than the shop.
 */

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Mode = 'prompt' | 'ios' | 'qr'

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari's own flag, which predates the display-mode query.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

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
          color: { dark: '#0c0b09', light: '#00000000' },
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
    <section aria-labelledby="app-promo-title" className="border-t border-border px-4 py-14 sm:px-6 lg:px-10">
      <Reveal>
        {/* The panel is the page's own warm near-black (--background, hsl(36
            8% 7%)) lifted a few points to --card and back down — a shade that
            separates it from the page without becoming a black box. Built from
            the tokens rather than hex, so it tracks the theme; deliberately
            never #000000, which is colder than anything else on the page. */}
        <div className="relative mx-auto flex max-w-[1400px] flex-col items-start gap-8 overflow-hidden border border-border/70 bg-[linear-gradient(135deg,hsl(36_8%_11%)_0%,hsl(var(--card))_45%,hsl(36_8%_8.5%)_100%)] px-6 py-10 text-foreground sm:px-10 sm:py-12 md:flex-row md:items-center md:justify-between md:gap-12">
          {/* A single gold pool behind the artwork, and a hairline along the
              top edge — the same two devices the rest of the storefront uses
              to lift a dark panel off a dark page. */}
          <span
            aria-hidden
            className="pointer-events-none absolute -right-32 -top-32 size-80 bg-[radial-gradient(circle,hsl(var(--gold)/0.14),transparent_70%)]"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent"
          />

          <div className="relative max-w-xl">
            <p className="text-[10px] uppercase tracking-[0.34em] text-gold/80">LUXE VAULT</p>
            <h2
              id="app-promo-title"
              className="mt-4 font-sans text-2xl font-bold uppercase leading-tight tracking-[0.08em] text-foreground sm:text-3xl"
            >
              {t('app.promoTitle')}
            </h2>
            <p className="mt-4 max-w-md text-[13px] font-light leading-relaxed text-muted-foreground">
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
                  className="no-juice inline-flex w-full items-center justify-center gap-2.5 border border-gold bg-gold px-8 py-4 text-[11px] font-medium uppercase tracking-[0.2em] text-gold-foreground transition-colors duration-300 enabled:hover:bg-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
                >
                  <Smartphone aria-hidden strokeWidth={1.5} className="size-4" />
                  {t('app.install')}
                </button>
                <p className="text-[11px] font-light text-muted-foreground/90">{t('app.installHint')}</p>
              </>
            )}

            {mode === 'ios' && (
              <div className="border border-gold/25 bg-white/[0.04] px-5 py-4">
                <p className="text-[10px] uppercase tracking-[0.24em] text-gold/80">{t('app.install')}</p>
                <p className="mt-2 max-w-xs text-[12px] font-light leading-relaxed text-muted-foreground">
                  {t('app.iosHint')}
                </p>
              </div>
            )}

            {mode === 'qr' && (
              <div className="flex items-center gap-4">
                {/* An inlaid ivory tile. The code itself stays dark-on-light:
                    that is what every phone camera is built to read, and an
                    inverted one is a coin flip on older scanners. The gold
                    hairline is what ties it to the panel. */}
                <div className="flex size-[104px] items-center justify-center border border-gold/30 bg-[#F2EDE3] p-2 shadow-[0_0_24px_-12px_hsl(var(--gold)/0.6)]">
                  {qr ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a data: URI generated in the browser; the optimiser cannot serve it.
                    <img src={qr} alt={t('app.qrAlt')} width={88} height={88} className="size-full object-contain" />
                  ) : (
                    <Smartphone aria-hidden strokeWidth={1} className="size-7 text-[#8A7B5C]" />
                  )}
                </div>
                <p className="max-w-[12rem] text-[11px] font-light leading-relaxed text-muted-foreground/90">
                  {t('app.qrHint')}
                </p>
              </div>
            )}
          </div>
        </div>
      </Reveal>
    </section>
  )
}
