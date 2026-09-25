/**
 * True when the site runs as the INSTALLED app (added to the home screen),
 * not in a browser tab. Browser-only; false on the server.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari's own flag, which predates the display-mode query.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}
