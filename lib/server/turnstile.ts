import 'server-only'

/**
 * Cloudflare Turnstile verification.
 *
 * A token from the widget proves nothing until Cloudflare confirms it: the
 * value in the form field is attacker-controlled like any other. This calls
 * siteverify, which also CONSUMES the token — each one is valid once, so a
 * replayed token fails here even though it looked fine in the browser.
 *
 * Configuration:
 *   NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY   rendered by the widget
 *   CLOUDFLARE_TURNSTILE_SECRET_KEY             used here, never sent to the browser
 *
 * With the secret unset, verification is SKIPPED and every caller behaves as
 * it did before Turnstile existed. That is deliberate — a shop must not lock
 * its own customers out because a key is missing — and it is why the widget
 * is likewise only rendered when the public key is present. Both keys set:
 * the check is mandatory and a missing or bad token is refused.
 */

const ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TIMEOUT_MS = 5000

export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY?.trim())
}

export type TurnstileResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; reason: 'missing_token' | 'rejected' | 'unavailable' }

/**
 * Verifies one token. `remoteIp` is optional but sharpens Cloudflare's own
 * scoring, so the caller passes the address it already has.
 */
export async function verifyTurnstileToken(
  token: unknown,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY?.trim()
  if (!secret) return { ok: true, skipped: true }

  if (typeof token !== 'string' || !token.trim() || token.length > 2048) {
    return { ok: false, reason: 'missing_token' }
  }

  const body = new URLSearchParams({ secret, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (data.success) return { ok: true }
    // The codes name the cause ("timeout-or-duplicate", "invalid-input-response")
    // and belong in the logs, never in the response: they would tell a script
    // exactly which part of its forgery to fix.
    console.warn('[turnstile] rejected:', (data['error-codes'] ?? []).join(', ') || 'no reason given')
    return { ok: false, reason: 'rejected' }
  } catch (e) {
    // Cloudflare unreachable. Refuse rather than wave the request through: the
    // endpoints behind this send email, and an outage is not a reason to open
    // them. Callers surface a retryable error.
    console.error('[turnstile] siteverify unavailable:', (e as Error).message)
    return { ok: false, reason: 'unavailable' }
  }
}
