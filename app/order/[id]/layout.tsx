import type { Metadata } from 'next'

// One customer's order: never a search result. robots.txt already disallows
// /order/, but a disallowed URL can still be indexed from a link to it — this
// says "noindex" on the page itself. The page is a client component, which
// cannot export metadata, so the segment's layout carries it.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function OrderLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
