import type { Metadata } from 'next'

// A basket and a payment form: nothing here belongs in a search index. The
// page is a client component, which cannot export metadata, so the segment's
// layout carries it. Renders nothing of its own.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

// Rendered per request, never prerendered: the payment page is served with a
// strict, per-request nonce Content-Security-Policy (middleware.ts), and Next
// can only put the nonce on its scripts when it renders the page for that
// request. A prerendered page would carry no nonce and none of its scripts
// would run.
export const dynamic = 'force-dynamic'

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
