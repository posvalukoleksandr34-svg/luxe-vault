import type { Metadata } from 'next'

import { ReviewRequestOptOut } from '@/components/review-link/review-request-optout'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function ReviewRequestOptOutPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params
  return <ReviewRequestOptOut token={token} />
}
