/**
 * Cookie consent state.
 *
 * GDPR/ePrivacy, in the parts that actually bite:
 *
 *  1. Non-essential cookies may not be set BEFORE consent. A banner that
 *     records a preference but does not gate anything is decoration. Read
 *     `hasConsent(category)` before loading any tag, and load it in an effect
 *     that reacts to consent changing — never at module scope.
 *  2. Refusing must be as easy as accepting. Hence three equally weighted
 *     buttons, not "Accept" next to a buried settings link.
 *  3. Consent must be withdrawable at any time, which is why the footer keeps
 *     a permanent "Cookie settings" entry.
 *  4. Consent is not forever. `CONSENT_VERSION` is bumped whenever the
 *     categories or the vendors behind them change, which re-prompts everyone
 *     rather than silently inheriting consent for something new.
 *
 * Stored in localStorage rather than a cookie on purpose: the record of a
 * refusal should not itself be sent to the server on every request.
 */

const STORAGE_KEY = 'lv.cookie-consent.v1'

/** Bump when categories or the vendors inside them change. Re-prompts everyone. */
export const CONSENT_VERSION = 1

export type ConsentCategory = 'necessary' | 'analytics' | 'marketing'

export type ConsentState = {
  version: number
  /** Epoch ms. Proof of when consent was given, which the GDPR expects you to keep. */
  timestamp: number
  necessary: true
  analytics: boolean
  marketing: boolean
}

/** Nothing but strictly necessary. The state to assume until told otherwise. */
export const DENY_ALL: Omit<ConsentState, 'version' | 'timestamp'> = {
  necessary: true,
  analytics: false,
  marketing: false,
}

export const ALLOW_ALL: Omit<ConsentState, 'version' | 'timestamp'> = {
  necessary: true,
  analytics: true,
  marketing: true,
}

function isConsentState(value: unknown): value is ConsentState {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.version === 'number' &&
    typeof v.timestamp === 'number' &&
    typeof v.analytics === 'boolean' &&
    typeof v.marketing === 'boolean'
  )
}

/**
 * Returns the stored consent, or null when there is none to honour — which
 * includes a record written against an older CONSENT_VERSION.
 *
 * Every access is wrapped: localStorage *throws* in Safari private mode and
 * some embedded webviews rather than returning null, and a storage preference
 * must not take the site down.
 */
export function readConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isConsentState(parsed)) return null
    // Stale consent is treated as no consent, not as a partial yes.
    if (parsed.version !== CONSENT_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

export function writeConsent(choice: Omit<ConsentState, 'version' | 'timestamp'>): ConsentState {
  const state: ConsentState = {
    ...choice,
    necessary: true,
    version: CONSENT_VERSION,
    timestamp: Date.now(),
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      // Lets anything already mounted react without a reload — the analytics
      // loader listens for this instead of polling.
      window.dispatchEvent(new CustomEvent<ConsentState>(CONSENT_EVENT, { detail: state }))
    } catch {
      // Storage blocked. The choice applies to this page view; the banner will
      // ask again next visit, which is the safe direction to fail.
    }
  }
  return state
}

export function clearConsent(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing useful to do */
  }
}

/** Fired whenever consent is saved. */
export const CONSENT_EVENT = 'lv:cookie-consent'

/**
 * The gate every non-essential script must pass through.
 *
 * Defaults to false when nothing is stored, so an unanswered banner behaves as
 * a refusal rather than as permission.
 */
export function hasConsent(category: ConsentCategory): boolean {
  if (category === 'necessary') return true
  const state = readConsent()
  if (!state) return false
  return category === 'analytics' ? state.analytics : state.marketing
}
