import type { Metadata } from 'next'

// A basket and a payment form: nothing here belongs in a search index. The
// page is a client component, which cannot export metadata, so the segment's
// layout carries it. Renders nothing of its own.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
