import 'server-only'

import { caseCopy, type CustomerEvent } from '@/lib/refunds/customer-copy'
import { formatMinor } from '@/lib/refunds/money'
import { getSiteUrl } from '@/lib/site-url'
import type { EmailLang } from './copy'
import {
  formatDate,
  highlightSection,
  metaSection,
  paragraphSection,
  quoteSection,
  renderEmail,
  textEmail,
  type RenderedEmail,
} from './layout'

/**
 * One email for every customer-facing step of a refund case
 * (lib/refunds/customer-copy.ts holds the words). What it may contain: the
 * case and order numbers, an amount, the decision note staff wrote FOR the
 * customer, a deadline, return instructions. What it never contains: risk
 * scores, internal notes, staff names.
 */
export function refundCaseEmail(input: {
  lang: EmailLang
  event: CustomerEvent
  caseNumber: string
  orderNumber: string
  amountMinor?: number
  note?: string
  deadline?: number
  instructions?: string
}): RenderedEmail {
  const copy = caseCopy(input.lang)
  const line = copy.events[input.event]
  const subject = `${line.title(input.caseNumber)} — Luxe Vault`
  const href = `${getSiteUrl()}/account?section=returns&case=${encodeURIComponent(input.caseNumber)}`

  const sections = [
    metaSection([
      [copy.caseLabel, input.caseNumber],
      [copy.orderLabel, input.orderNumber],
    ]),
  ]
  if (input.amountMinor !== undefined && input.amountMinor > 0) {
    sections.push(highlightSection(copy.amountLabel, formatMinor(input.amountMinor)))
  }
  if (input.note?.trim()) {
    sections.push(paragraphSection(copy.noteLabel, true), quoteSection(input.note.trim().slice(0, 2000)))
  }
  if (input.instructions?.trim()) sections.push(quoteSection(input.instructions.trim().slice(0, 2000)))
  if (input.deadline) sections.push(paragraphSection(`${copy.deadlineLabel}: ${formatDate(input.deadline, input.lang)}`, true))

  const html = renderEmail({
    lang: input.lang,
    subject,
    preheader: line.body,
    heading: line.title(input.caseNumber),
    intro: line.body,
    sections,
    cta: { label: copy.cta, href },
  })
  const text = textEmail([
    'LUXE VAULT',
    '',
    line.title(input.caseNumber),
    line.body,
    '',
    `${copy.caseLabel}: ${input.caseNumber}`,
    `${copy.orderLabel}: ${input.orderNumber}`,
    input.amountMinor ? `${copy.amountLabel}: ${formatMinor(input.amountMinor)}` : null,
    input.note?.trim() ? `${copy.noteLabel}: ${input.note.trim()}` : null,
    input.instructions?.trim() || null,
    input.deadline ? `${copy.deadlineLabel}: ${formatDate(input.deadline, input.lang)}` : null,
    '',
    `${copy.cta}: ${href}`,
  ])
  return { subject, html, text }
}
