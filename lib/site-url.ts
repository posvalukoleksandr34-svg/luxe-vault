/**
 * The absolute origin Supabase should send auth emails back to.
 *
 * Order matters:
 *   1. NEXT_PUBLIC_SITE_URL — set this in Vercel to
 *      https://luxe-vault-hlb1.vercel.app so every environment agrees on the
 *      canonical domain.
 *   2. NEXT_PUBLIC_VERCEL_URL — Vercel injects this per deployment, so preview
 *      builds link back to themselves instead of to production.
 *   3. window.location.origin — local development.
 *
 * Why this exists: without an explicit `emailRedirectTo`, Supabase falls back
 * to the project's Site URL for every confirmation link. If that is still
 * http://localhost:3000, production users receive an email whose link points
 * at their own machine — the link looks fine and silently goes nowhere.
 */
export function getSiteUrl(): string {
  // Local development wins over the configured production origin. Without
  // this, clicking "Sign in with Google" on localhost sends the developer to
  // the live site — the OAuth round-trip completes against production and the
  // session never lands in the local browser, which looks like a broken
  // button rather than a misdirected redirect.
  if (typeof window !== 'undefined' && isLocalHost(window.location.hostname)) {
    return stripTrailingSlash(window.location.origin)
  }

  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return stripTrailingSlash(withProtocol(explicit))

  const vercel = process.env.NEXT_PUBLIC_VERCEL_URL
  if (vercel) return stripTrailingSlash(withProtocol(vercel))

  if (typeof window !== 'undefined') return stripTrailingSlash(window.location.origin)

  // Server-side with nothing configured. Returning localhost here would be a
  // silent trap, so callers that need a real origin should check for it.
  return 'http://localhost:3000'
}

/** Absolute URL for a Supabase auth email to return to. */
export function authCallbackUrl(next: string): string {
  return `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}`
}

function withProtocol(value: string): string {
  // Vercel supplies a bare host ("my-app.vercel.app"), not a URL.
  return /^https?:\/\//.test(value) ? value : `https://${value}`
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

/** Hostnames that mean "this developer's machine". */
function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  )
}
