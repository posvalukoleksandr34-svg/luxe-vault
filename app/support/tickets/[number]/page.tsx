import type { Metadata } from 'next'
import { SupportPage } from '@/components/support/support-page'

// A private conversation: never indexed, and the address — which can carry
// the access token on first open — is never sent on as a referrer.
export const metadata: Metadata = {
  title: 'Support request',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function Page({
  params,
  searchParams,
}: {
  params: { number: string }
  searchParams: { t?: string | string[] }
}) {
  const token = typeof searchParams.t === 'string' ? searchParams.t : undefined
  return <SupportPage entry={{ view: 'ticket', number: decodeURIComponent(params.number), token }} />
}
