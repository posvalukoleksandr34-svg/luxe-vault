import 'server-only'

import { REFUNDS } from '@/app/legal/_content/refunds'
import { resolveDoc, type LegalDoc } from '@/app/legal/_content/types'
import { formatMoney } from '@/lib/currency'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { fill } from '@/lib/support/copy'
import { FAQ } from '@/lib/support/faq'
import type { ShippingSettings } from '@/config/shipping'
import type { StorefrontLocale } from '@/lib/types'

/**
 * What the assistant is allowed to know about the shop — its whole knowledge
 * base, in the visitor's language.
 *
 * WHY NOT A VECTOR DATABASE (YET). Retrieval exists to pick the few relevant
 * pages out of a corpus too big to send. This one is not: the help-centre
 * answers and the returns policy come to roughly 4–5k tokens per language, so
 * the model reads ALL of it on every question. That is strictly better than
 * retrieval at this size — nothing relevant can be missed by a bad match, and
 * there is no index to keep in step with the text. When the corpus outgrows
 * that (hundreds of pages: care guides, brand stories, per-product notes),
 * `knowledgeFor` is the one function to replace with a pgvector search — see
 * docs/support-assistant.md.
 *
 * SAME SOURCES AS THE PAGES. Every entry comes from what the help centre and
 * /legal/refunds already show, with the same live figures filled in (the
 * admin's delivery window and shipping fees, lib/fulfilment.ts). The bot can
 * therefore never promise a delivery time, a fee or a returns window the shop
 * does not offer — the failure a shop's chat bot must not have.
 */

/** "[text](href)" → "text (href)", "**bold**" → "bold": the prompt is plain text. */
function plain(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/\*\*([^*]+)\*\*/g, '$1')
}

function docText(doc: LegalDoc): string {
  const lines: string[] = []
  for (const section of doc.sections) {
    lines.push(`## ${section.h}`)
    for (const block of section.blocks) {
      if ('p' in block) lines.push(plain(block.p))
      else if ('ul' in block) block.ul.forEach((item) => lines.push(`- ${plain(item)}`))
      else block.ol.forEach((item, i) => lines.push(`${i + 1}. ${plain(item)}`))
    }
  }
  return lines.join('\n')
}

export function knowledgeFor(locale: StorefrontLocale, shipping: ShippingSettings): string {
  const chf = (n: number, exact = false) => formatMoney(n, 'CHF', exact)
  const vars = {
    span: describeBusinessDays(shipping.deliveryTimeframe, locale),
    price: chf(shipping.shippingPrice, true),
    amount: chf(shipping.freeShippingThreshold),
    returnDays: FULFILMENT.returnWindowDays,
    refund: describeBusinessDays(FULFILMENT.refund, locale),
    reply: describeBusinessDays(FULFILMENT.supportReply, locale, { genitive: true }),
  }

  const facts = [
    `Delivery time (store-wide estimate): ${vars.span}.`,
    `Shipping: ${vars.price}; free on orders from ${vars.amount}.`,
    `Items are sourced and quality-checked for each order (${FULFILMENT.supply.min}–${FULFILMENT.supply.max} days) before dispatch; the parcel then travels with Swiss Post.`,
    `Returns: ${FULFILMENT.returnWindowDays} days from delivery to notify us. Refunds reach the bank in ${vars.refund} after they are issued.`,
    `Human support replies within ${vars.reply}, by email.`,
    'Prices are in Swiss francs (CHF); the site can display EUR and USD.',
    'Each product page has a size guide with measurements and a size finder.',
  ]

  const faq = FAQ.map((entry) => `[faq:${entry.id}] Q: ${entry.q[locale]}\nA: ${fill(entry.a[locale], vars)}`)
  const refunds = resolveDoc(REFUNDS, locale).doc

  return [
    '# SHOP FACTS',
    facts.map((f) => `- ${f}`).join('\n'),
    '# HELP CENTRE',
    faq.join('\n\n'),
    `# RETURNS & REFUNDS POLICY (${refunds.title})`,
    docText(refunds),
  ].join('\n\n')
}
