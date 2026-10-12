import type { Metadata } from 'next'

// The console's sign-in form: never a search result (robots.txt disallows
// /admin too). The page is a client component, so the layout carries it.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AdminLoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
