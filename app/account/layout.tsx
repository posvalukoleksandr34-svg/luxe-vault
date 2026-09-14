import type { Metadata } from 'next'

// A personal account: never a search result. The page is a client component,
// which cannot export metadata, so the segment's layout carries it. Renders
// nothing of its own.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
