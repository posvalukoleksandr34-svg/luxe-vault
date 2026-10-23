import { AdminShell } from '@/components/admin/admin-shell'

/**
 * The admin console's segment: rendered per request, never prerendered.
 *
 * Every admin page is served with the strict, per-request nonce
 * Content-Security-Policy (middleware.ts, config/csp.js). Next puts the nonce
 * on its scripts only when it renders the page for that request, so a
 * prerendered admin page would be blocked by its own policy.
 *
 * Every page shares one frame (components/admin/admin-shell.tsx): the grouped
 * navigation and the counts of what is waiting. The login page gets none.
 */
export const dynamic = 'force-dynamic'

// No <Suspense> around it: the segment is dynamic, so useSearchParams needs
// none, and a boundary here streamed every admin page inside a hidden block
// that React revealed a beat later.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
