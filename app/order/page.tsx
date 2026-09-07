import { redirect } from 'next/navigation'

/**
 * `/order?id=LV-XXXXXX` — the URL the checkout handler redirects to.
 *
 * The canonical route is `/order/[id]`, which is what the sitemap, the emails
 * and the notification action URLs all point at. Rather than maintain two
 * implementations of the tracking page, this segment normalises the query form
 * onto the path form with a redirect, so both spellings work and there is
 * exactly one page to keep correct.
 *
 * A missing or malformed id goes to the account page, where the customer can
 * find the order in their history — better than a 404 for someone who has just
 * paid.
 */
export default function OrderQueryPage({
  searchParams,
}: {
  searchParams: { id?: string }
}) {
  const id = searchParams.id?.trim()

  // Shape-check before redirecting: `LV-` plus six of the id alphabet. This
  // keeps arbitrary user input out of the path segment.
  if (id && /^LV-[A-Z0-9]{6}$/i.test(id)) {
    redirect(`/order/${encodeURIComponent(id.toUpperCase())}`)
  }

  redirect('/')
}
