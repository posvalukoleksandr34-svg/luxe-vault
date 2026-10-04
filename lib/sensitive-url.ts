/**
 * Addresses that carry a secret, and how to make them safe to hand to anyone
 * else — an analytics vendor, a log line, an operators' chat.
 *
 * Several links the shop sends work as a key on their own:
 *
 *   /support/tickets/LV-T-…?t=<token>     reads and answers a support ticket
 *   /newsletter/unsubscribe?token=<uuid>   unsubscribes / resubscribes
 *   /cart/restore/<uuid>, /cart/unsubscribe/<uuid>   the cart-reminder links
 *   /success?payment_intent_client_secret=…          Stripe's 3-D Secure return
 *
 * A full URL like that in Google Analytics, the Meta Pixel or a server log is
 * a copy of the key held by someone who should not have it. Pure functions,
 * no DOM: used by the browser (analytics) and the server (logs) alike.
 */

/** Query parameters whose value is a credential, or close enough to one. */
const SECRET_PARAMS = new Set([
  't',
  'token',
  'payment_intent',
  'payment_intent_client_secret',
  'setup_intent',
  'setup_intent_client_secret',
  'code',
  'access_token',
  'refresh_token',
])

/** Path segments that are themselves the secret: /cart/restore/<token>. */
const SECRET_PATHS: RegExp[] = [/^(\/cart\/(?:restore|unsubscribe))\/[^/?#]+/]

function parse(raw: string): URL | null {
  try {
    return new URL(raw, 'https://placeholder.invalid')
  } catch {
    return null
  }
}

/** True when the address carries a secret in its query or its path. */
export function isSensitiveUrl(raw: string | null | undefined): boolean {
  if (!raw) return false
  const url = parse(raw)
  if (!url) return false
  if (Array.from(url.searchParams.keys()).some((key) => SECRET_PARAMS.has(key.toLowerCase()))) return true
  return SECRET_PATHS.some((re) => re.test(url.pathname))
}

/**
 * The same address with every secret replaced: secret query values become
 * `redacted`, a secret path segment becomes `:token`, and the fragment (where
 * Supabase puts auth tokens) is dropped. Other query parameters are kept —
 * `?view=sale` is what makes a report useful. Relative input stays relative.
 */
export function scrubSensitiveUrl(raw: string | null | undefined): string {
  if (!raw) return ''
  const url = parse(raw)
  if (!url) return ''
  Array.from(url.searchParams.keys()).forEach((key) => {
    if (SECRET_PARAMS.has(key.toLowerCase())) url.searchParams.set(key, 'redacted')
  })
  for (const re of SECRET_PATHS) url.pathname = url.pathname.replace(re, '$1/:token')
  url.hash = ''
  const relative = url.origin === 'https://placeholder.invalid'
  return relative ? `${url.pathname}${url.search}` : url.toString()
}
