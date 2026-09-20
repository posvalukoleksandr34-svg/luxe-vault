'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useCallback, useEffect, useState } from 'react'
import { CONSENT_EVENT, readConsent } from '@/lib/cookie-consent'
import { useStore } from '@/lib/store'

/**
 * First-launch welcome, shown once to a visitor who has never chosen.
 *
 * It is a gate in front of a shop, so it is deliberately cheap to leave:
 * "Продолжить как гость", the Escape key and a tap outside all dismiss it, and
 * all three record the same choice. What it must never do is ask twice —
 * nothing is more obviously broken than a welcome screen greeting a returning
 * customer.
 *
 * It waits for the cookie banner. Both are first-visit overlays, and stacking
 * a welcome screen on a consent notice gives someone two modal decisions
 * before they have seen a single product; this one appears only once consent
 * has been answered (lib/cookie-consent.ts), and otherwise listens for it.
 *
 * Radix Dialog rather than a hand-rolled overlay: it traps focus, restores it
 * on close, locks the background from scrolling and wires up the accessible
 * name — all of which a modal must do and none of which is worth rewriting.
 */

const STORAGE_KEY = 'luxe_onboarding_dismissed'

function alreadyDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    // Storage blocked: treat as dismissed rather than greet on every page.
    return true
  }
}

function remember(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, 'true')
  } catch {
    // Not persisting is acceptable; it stays closed for this visit.
  }
}

export function WelcomeModal() {
  const { t, currentUser, authLoading, openAuth } = useStore()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // Wait for the session check: a signed-in customer must never see this,
    // and `currentUser` is null for a moment while it resolves.
    if (authLoading || open) return
    if (currentUser) {
      // Signing in is a choice too — the welcome has nothing left to offer.
      remember()
      return
    }
    if (alreadyDismissed()) return

    if (readConsent() !== null) {
      setOpen(true)
      return
    }
    const onConsent = () => {
      if (!alreadyDismissed()) setOpen(true)
    }
    window.addEventListener(CONSENT_EVENT, onConsent)
    return () => window.removeEventListener(CONSENT_EVENT, onConsent)
  }, [authLoading, currentUser, open])

  /** Every exit — guest, Escape, tap outside — settles the question. */
  const dismiss = useCallback(() => {
    remember()
    setOpen(false)
  }, [])

  const signIn = useCallback(() => {
    remember()
    setOpen(false)
    openAuth('login')
  }, [openAuth])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[60] flex flex-col justify-center bg-[#0a0a0a] px-6 py-12 text-center data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,440px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:border sm:border-gold/25 sm:px-10 sm:py-14 sm:shadow-[0_0_80px_-20px_rgba(0,0,0,0.9)]"
          style={{
            paddingBottom: 'max(3rem, env(safe-area-inset-bottom))',
          }}
        >
          {/* The wordmark, set exactly as the header sets it. */}
          <p className="flex items-baseline justify-center gap-0.5 font-serif text-lg font-bold tracking-[0.22em]">
            <span className="text-foreground">LUXE</span>
            <span className="text-gold">VAULT</span>
          </p>
          <span aria-hidden className="mx-auto mt-6 block h-px w-12 bg-gold/60" />

          <DialogPrimitive.Title className="mt-8 font-serif text-[26px] font-normal leading-tight tracking-tight text-foreground sm:text-[30px]">
            {t('welcome.title')}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mx-auto mt-4 max-w-xs text-[13px] font-light leading-relaxed text-muted-foreground">
            {t('welcome.subtitle')}
          </DialogPrimitive.Description>

          <div className="mt-10 flex flex-col gap-3">
            <button
              type="button"
              onClick={signIn}
              className="no-juice inline-flex min-h-[52px] items-center justify-center border border-gold bg-gold px-8 text-[11px] font-medium uppercase tracking-[0.2em] text-gold-foreground transition-colors duration-300 hover:bg-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]"
            >
              {t('welcome.signIn')}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="no-juice inline-flex min-h-[48px] items-center justify-center px-8 text-[11px] uppercase tracking-[0.2em] text-muted-foreground transition-colors duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]"
            >
              {t('welcome.guest')}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
