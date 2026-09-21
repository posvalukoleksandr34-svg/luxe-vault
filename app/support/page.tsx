import type { Metadata } from 'next'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { supportMetadata } from '@/lib/page-seo'
import { SupportPage } from '@/components/support/support-page'

export const metadata: Metadata = supportMetadata(DEFAULT_LOCALE)

/** Order numbers are LV- plus characters; anything else is ignored rather than
 *  carried into the form. Mirrors orderNumber() in lib/server/support-input.ts. */
const ORDER_NUMBER = /^[A-Z0-9-]{4,40}$/

export default function Page({ searchParams }: { searchParams: { order?: string } }) {
  // /support?order=LV-XXXX opens the request form on that order — the link an
  // order page or an email can hand out. A cancelled or refunded order is
  // refused by the form itself (components/support/support-center.tsx).
  const order = (searchParams.order ?? '').trim().toUpperCase()
  const entry = ORDER_NUMBER.test(order) ? ({ view: 'new' as const, category: 'order' as const, orderNumber: order }) : undefined

  return <SupportPage entry={entry} />
}
