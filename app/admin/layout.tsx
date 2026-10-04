/**
 * The admin console's segment: rendered per request, never prerendered.
 *
 * Every admin page is served with the strict, per-request nonce
 * Content-Security-Policy (middleware.ts, config/csp.js). Next puts the nonce
 * on its scripts only when it renders the page for that request, so a
 * prerendered admin page would be blocked by its own policy.
 */
export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}
