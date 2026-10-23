import type { Metadata } from 'next'

import { ReviewLinkView, type ReviewLinkState } from '@/components/review-link/review-link-view'
import { viewLink } from '@/lib/server/review-requests/links'

// Read on every visit: a review written a minute ago must show as written.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * The page behind "Leave a review" in a review-request email
 * (lib/server/review-requests). The token in the address is the only key; the
 * page shows the products of that one order and nothing else about it.
 */
export default async function ReviewLinkPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params
  let state: ReviewLinkState
  try {
    const view = await viewLink(token)
    state =
      view.state === 'ok'
        ? { state: 'ok', products: view.products.map((p) => ({ productId: p.productId, name: p.name, image: p.image, reviewed: p.reviewed })) }
        : view
  } catch (e) {
    console.error('[review-link] could not read the link:', (e as Error).message)
    state = { state: 'error' }
  }
  return <ReviewLinkView token={token} initial={state} />
}
