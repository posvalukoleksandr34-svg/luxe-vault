import 'server-only'

import type { Order } from '@/lib/types'
import type { EmailLang } from './copy'
import {
  copyFor,
  metaSection,
  money,
  orderHref,
  paragraphSection,
  renderEmail,
  textEmail,
  type RenderedEmail,
} from './layout'

/**
 * "Payment not completed" — sent once per order when the bank declines or the
 * payment is abandoned mid-way (see the Stripe webhook, which claims it once
 * so three retried cards do not mean three emails).
 *
 * Says plainly that nothing was charged and that the order is safe, and where
 * to pay again. No card details: the decline reason Stripe gives is not
 * repeated here, because it can describe the card.
 */
export function paymentFailedEmail(order: Order, lang: EmailLang): RenderedEmail {
  const c = copyFor(lang)
  const subject = c.failed.subject(order.id)

  const html = renderEmail({
    lang,
    subject,
    preheader: c.failed.nothingCharged,
    heading: c.failed.heading,
    intro: c.failed.intro,
    sections: [
      metaSection([
        [c.orderNumber, order.id],
        [c.total, money(order.total)],
      ]),
      paragraphSection(c.failed.nothingCharged, true),
    ],
    cta: { label: c.viewOrder, href: orderHref(order) },
  })

  const text = textEmail([
    'LUXE VAULT',
    '',
    c.failed.heading,
    c.failed.intro,
    c.failed.nothingCharged,
    '',
    `${c.orderNumber}: ${order.id}`,
    `${c.total}: ${money(order.total)}`,
    '',
    `${c.viewOrder}: ${orderHref(order)}`,
  ])

  return { subject, html, text }
}
