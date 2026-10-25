import type { Metadata } from 'next'

// A personal account: never a search result. The page is a client component,
// which cannot export metadata, so the segment's layout carries it. Renders
// nothing of its own.
export const metadata: Metadata = {
  // English, the default language; the page puts it into the visitor's
  // language once loaded (lib/use-document-title.ts, 'account.title').
  title: 'Your account',
  robots: { index: false, follow: false },
}

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
