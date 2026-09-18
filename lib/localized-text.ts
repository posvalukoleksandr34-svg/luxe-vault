/**
 * The single-language form of a localised catalogue string, for places that
 * render outside the visitor's locale: SEO metadata, JSON-LD, Open Graph
 * images, admin-facing emails, cron jobs.
 *
 * Russian first (the shop's source language), then English, then whatever
 * language has text, then `fallback`. Pure and dependency-free, so it is safe
 * in server components, route handlers and the Edge runtime alike.
 */
export function primaryText(
  text: Partial<Record<string, string>> | null | undefined,
  fallback = '',
): string {
  if (!text) return fallback
  return text.ru || text.en || Object.values(text).find((v): v is string => Boolean(v)) || fallback
}
