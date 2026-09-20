/**
 * The public half of the Turnstile configuration, safe in the browser bundle.
 *
 * Referenced as a full literal (`process.env.NEXT_PUBLIC_…`) because that is
 * what Next inlines at build time — reading it through a variable leaves
 * `undefined` in the client bundle.
 */
export const TURNSTILE_SITE_KEY = (process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY ?? '').trim()

/** True when the widget should be rendered at all. With no site key the
 *  forms behave exactly as they did before Turnstile was added. */
export function isTurnstileEnabled(): boolean {
  return TURNSTILE_SITE_KEY.length > 0
}
