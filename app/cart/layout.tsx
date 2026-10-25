import type { Metadata } from 'next'

// A basket: never a search result. The page is a client component, which
// cannot export metadata, so the segment's layout carries it.
export const metadata: Metadata = {
  title: 'Cart',
  robots: { index: false, follow: false },
}

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
