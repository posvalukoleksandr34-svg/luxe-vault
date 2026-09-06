'use client'

import { Cookie, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  ALLOW_ALL,
  CONSENT_EVENT,
  DENY_ALL,
  readConsent,
  writeConsent,
  type ConsentState,
} from '@/lib/cookie-consent'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * GDPR / ePrivacy cookie banner.
 *
 * Three things here are compliance requirements rather than design choices:
 *
 *  - "Reject all" sits beside "Accept all" with identical weight. A regulator
 *    reads a prominent Accept next to a buried opt-out as consent not freely
 *    given, and several DPAs have fined exactly that pattern.
 *  - Nothing is pre-ticked except the strictly necessary category, which
 *    cannot be switched off because the site does not work without it.
 *  - Closing the banner with X is treated as a REFUSAL, not as consent, and is
 *    persisted so the visitor is not nagged on every page.
 *
 * Rendered only after mount: the server does not know what is in localStorage,
 * so rendering it during SSR would flash the banner at people who already
 * answered.
 */
export function CookieConsent() {
  const { t } = useStore()
  const [state, setState] = useState<ConsentState | null>(null)
  const [decided, setDecided] = useState(true)
  const [customising, setCustomising] = useState(false)
  const [draft, setDraft] = useState({ analytics: false, marketing: false })

  useEffect(() => {
    const stored = readConsent()
    setState(stored)
    setDecided(stored !== null)
    if (stored) setDraft({ analytics: stored.analytics, marketing: stored.marketing })
  }, [])

  // The footer's "Cookie settings" link reopens this by firing the same event.
  useEffect(() => {
    function onReopen() {
      const stored = readConsent()
      setDraft(
        stored
          ? { analytics: stored.analytics, marketing: stored.marketing }
          : { analytics: false, marketing: false },
      )
      setCustomising(true)
      setDecided(false)
    }
    window.addEventListener(REOPEN_EVENT, onReopen)
    return () => window.removeEventListener(REOPEN_EVENT, onReopen)
  }, [])

  const save = useCallback((choice: { analytics: boolean; marketing: boolean }) => {
    const next = writeConsent({ ...DENY_ALL, ...choice })
    setState(next)
    setDecided(true)
    setCustomising(false)
  }, [])

  if (decided) return null

  return (
    <>
      {/* Not a modal: the banner must not block access to the site, and a
          hard paywall-style overlay is itself a dark pattern. */}
      <div
        role="dialog"
        aria-live="polite"
        aria-label={t('cookies.title')}
        className="animate-fade-up fixed inset-x-0 bottom-0 z-[95] border-t border-gold/25 bg-popover/95 backdrop-blur-md"
      >
        <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 lg:px-10">
          <div className="flex items-start gap-3">
            <Cookie className="mt-0.5 size-4 shrink-0 text-gold/70" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground">{t('cookies.title')}</p>
              <p className="mt-1.5 max-w-3xl text-[12px] font-light leading-relaxed text-muted-foreground">
                {t('cookies.body')}{' '}
                <a href="/legal/privacy" className="text-gold underline-offset-2 hover:underline">
                  {t('cookies.privacyLink')}
                </a>
              </p>

              {customising && (
                <div className="mt-4 space-y-3 border border-border/60 p-4">
                  <ConsentRow
                    label={t('cookies.necessary')}
                    hint={t('cookies.necessaryHint')}
                    checked
                    locked
                  />
                  <ConsentRow
                    label={t('cookies.analytics')}
                    hint={t('cookies.analyticsHint')}
                    checked={draft.analytics}
                    onChange={(v) => setDraft((d) => ({ ...d, analytics: v }))}
                  />
                  <ConsentRow
                    label={t('cookies.marketing')}
                    hint={t('cookies.marketingHint')}
                    checked={draft.marketing}
                    onChange={(v) => setDraft((d) => ({ ...d, marketing: v }))}
                  />
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {/* Accept and Reject are deliberately the same size, weight and
                    colour. Making Accept louder is the pattern regulators fine. */}
                <button
                  type="button"
                  onClick={() => save({ analytics: true, marketing: true })}
                  className="border border-gold/40 bg-gold/10 px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
                >
                  {t('cookies.acceptAll')}
                </button>
                <button
                  type="button"
                  onClick={() => save({ analytics: false, marketing: false })}
                  className="border border-gold/40 bg-gold/10 px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
                >
                  {t('cookies.rejectAll')}
                </button>

                {customising ? (
                  <button
                    type="button"
                    onClick={() => save(draft)}
                    className="border border-border px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition-all duration-300 hover:text-foreground"
                  >
                    {t('cookies.savePreferences')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCustomising(true)}
                    className="border border-border px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition-all duration-300 hover:text-foreground"
                  >
                    {t('cookies.customise')}
                  </button>
                )}
              </div>
            </div>

            {/* Dismissing is a refusal, and is persisted — otherwise the banner
                reappears on every page, which pressures people into accepting. */}
            <button
              type="button"
              onClick={() => save({ analytics: false, marketing: false })}
              aria-label={t('cookies.rejectAll')}
              className="flex size-7 shrink-0 items-center justify-center text-muted-foreground/60 transition hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function ConsentRow({
  label,
  hint,
  checked,
  locked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  locked?: boolean
  onChange?: (v: boolean) => void
}) {
  return (
    <label className={cn('flex items-start gap-3', locked ? 'cursor-default' : 'cursor-pointer')}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          checked={checked}
          disabled={locked}
          onChange={(e) => onChange?.(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={cn(
            'flex h-[18px] w-[32px] items-center border p-[2px] transition-all duration-300',
            'peer-focus-visible:ring-1 peer-focus-visible:ring-gold/60',
            checked ? 'border-gold/60 bg-gold/20' : 'border-border bg-transparent',
            locked && 'opacity-60',
          )}
        >
          <span
            className={cn(
              'size-[12px] transition-all duration-300',
              checked ? 'translate-x-[14px] bg-gold' : 'translate-x-0 bg-muted-foreground/40',
            )}
          />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-light text-foreground">{label}</span>
        <span className="mt-0.5 block text-[11px] font-light leading-relaxed text-muted-foreground/70">
          {hint}
        </span>
      </span>
    </label>
  )
}

/** Event the footer link fires to reopen the banner for withdrawal. */
export const REOPEN_EVENT = 'lv:cookie-consent:reopen'

/** Call from anywhere to let a visitor change or withdraw their choice. */
export function openCookieSettings(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(REOPEN_EVENT))
}

/**
 * Reads consent reactively, so a gated script mounts the moment permission is
 * granted rather than on the next page load.
 *
 * Usage:
 *   const analytics = useConsent('analytics')
 *   useEffect(() => { if (analytics) loadTag() }, [analytics])
 */
export function useConsent(category: 'analytics' | 'marketing'): boolean {
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    function sync() {
      const state = readConsent()
      setAllowed(state ? state[category] : false)
    }
    sync()
    window.addEventListener(CONSENT_EVENT, sync)
    // Another tab may have changed the answer.
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CONSENT_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [category])

  return allowed
}
