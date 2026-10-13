import 'server-only'

import { SITE_ORIGIN } from '@/lib/site-origin'
import type { StorefrontLocale } from '@/lib/types'

/**
 * What goes into the model, and what is allowed back out of it.
 *
 * IN: the customer's messages lose card numbers, IBANs, e-mail addresses and
 * phone numbers before they reach the model provider. None of the tools can
 * use them (orders are found by the session and the browser's own tokens),
 * so sending them would only copy personal data to a third party.
 *
 * OUT: the reply is plain text the widget renders as text (React escapes it;
 * only http(s) links are turned into anchors, client side). Here it is
 * checked against what the tools and the knowledge actually returned:
 *
 *  - a link to a product page must name a product that exists; any other
 *    link must be this shop's own page or a URL a tool returned (a tracking
 *    link) — an invented URL is removed rather than shown;
 *  - the products it links become cards built from the catalogue, so a price
 *    or an availability on a card is never the model's;
 *  - CHF amounts that appear nowhere in the evidence are counted, for the
 *    quality log, and caught by the evaluation suite;
 *  - the language is checked against the one the customer wrote in.
 */

// ------------------------------------------------------------- redaction --

function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

const REDACTED = {
  card: '[card number removed]',
  iban: '[IBAN removed]',
  email: '[email removed]',
  phone: '[phone removed]',
}

/** The message with payment and contact details taken out. Order numbers
 *  (LV-XXXXXX), prices and dates are left alone. */
export function redactPersonalData(text: string): string {
  return (
    text
      // Card numbers: 13–19 digits, spaces or dashes allowed, Luhn-valid.
      .replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => (luhn(m.replace(/\D/g, '')) ? REDACTED.card : m))
      // IBAN: two letters, two digits, 11–30 more alphanumerics (spaces allowed).
      .replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{2,4}){3,8}\b/g, REDACTED.iban)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED.email)
      // Phone numbers as written in Europe: starting with + or 0 (+41 79 …,
      // 079 …, 0041 …), at least nine digits in groups. A tracking number
      // (99.00.123456…) or a reference does not start that way and stays.
      .replace(/(?<![\w.+-])(?:\+|\(?0)(?:[\s().-]{0,2}\d){8,15}(?![\w-])/g, (m) =>
        m.replace(/\D/g, '').length >= 9 ? REDACTED.phone : m,
      )
  )
}

// -------------------------------------------------------------- language --

/** Short, frequent, language-specific words. Ambiguous ones (la, le, de, in,
 *  un, a) are left out on purpose. `es` is there to recognise Spanish rather
 *  than mistake it for Italian or French. */
const STOPWORDS: Record<StorefrontLocale | 'es', string[]> = {
  en: ['the', 'and', 'you', 'your', 'is', 'are', 'to', 'of', 'for', 'with', 'this', 'that', 'will', 'can', 'please', 'have', 'it', 'be', 'my', 'what', 'when', 'where', 'how', 'order', 'would', 'which', 'there', 'our', 'we'],
  it: ['il', 'gli', 'di', 'che', 'è', 'per', 'con', 'una', 'sono', 'del', 'della', 'ordine', 'suo', 'sua', 'non', 'può', 'mio', 'mia', 'quando', 'dove', 'come', 'vorrei', 'grazie', 'questo', 'questa', 'ha', 'lei', 'nel', 'alla', 'anche'],
  fr: ['les', 'des', 'du', 'est', 'et', 'vous', 'votre', 'pour', 'avec', 'une', 'commande', 'que', 'dans', 'pas', 'nous', 'sur', 'mon', 'ma', 'quand', 'où', 'comment', 'je', 'merci', 'cette', 'ce', 'sont', 'au', 'aux', 'peut'],
  de: ['der', 'die', 'das', 'und', 'ist', 'sie', 'ihre', 'ihr', 'für', 'mit', 'nicht', 'eine', 'ein', 'bestellung', 'wir', 'zu', 'den', 'dem', 'auf', 'meine', 'mein', 'wann', 'wo', 'wie', 'ich', 'danke', 'bitte', 'diese', 'sind', 'kann', 'wird'],
  es: ['el', 'los', 'las', 'por', 'para', 'usted', 'pedido', 'está', 'cómo', 'cuándo', 'dónde', 'gracias', 'quiero', 'tiene', 'pero', 'muy', 'mi', 'su', 'es', 'del'],
}

/**
 * The language of a text when the evidence is clear; null when it is short,
 * mixed or none of these. Never used to block an answer on its own — only to
 * notice a reply in a language the customer did not write in.
 */
export function detectLanguage(text: string): StorefrontLocale | 'es' | null {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? []
  if (words.length < 4) return null
  const scores = (Object.keys(STOPWORDS) as (StorefrontLocale | 'es')[])
    .map((lang) => ({ lang, n: words.filter((w) => STOPWORDS[lang].indexOf(w) !== -1).length }))
    .sort((a, b) => b.n - a.n)
  const [top, second] = scores
  if (top.n < 3 || top.n < second.n * 2) return null
  return top.lang
}

/** The language a reply should be in: the customer's, when it is one of the
 *  four and recognisable; otherwise the page's. */
export function expectedLanguage(lastUserMessage: string, pageLocale: StorefrontLocale): StorefrontLocale {
  const lang = detectLanguage(lastUserMessage)
  return lang && lang !== 'es' ? lang : pageLocale
}

// ------------------------------------------------------------- the reply --

const SITE_HOST = new URL(SITE_ORIGIN).host
/** Pages of this shop a reply may point to by a bare path. */
const SITE_PATH = /(^|[\s(])(\/(?:(?:it|fr|de)\/)?(?:product|legal|support|faq|shipping|returns|account|catalog|category|contact|about|order)(?:\/[^\s),.;!?]*)?)/g
const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi

export type Evidence = {
  /** Product ids the catalogue holds. */
  catalogIds: Set<string>
  /** URLs a tool returned this turn (tracking links), exactly. */
  toolUrls: Set<string>
  /** Every CHF amount the tools and the knowledge stated, rounded to cents. */
  amounts: Set<string>
}

export type CheckedReply = {
  text: string
  /** Product ids linked in the reply, in order, existing in the catalogue. */
  linkedProducts: string[]
  removedLinks: number
  unverifiedAmounts: number
}

export const REPLY_MAX_CHARS = 1500

/** "**x**" → "x", "[t](u)" → "t (u)", "## Title" → "Title": the widget shows
 *  plain text, and stray Markdown reads as noise. */
function plainText(text: string): string {
  return text
    .replace(/\[([^\]]{1,200})\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '$1 ($2)')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*•]\s+/gm, '- ')
}

/** Cut at the last sentence end before `max`, so nothing ends mid-word. */
function bounded(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return (end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`).trim()
}

const money = (n: number) => n.toFixed(2)

/** A number as prices are written: thousands in groups of three (1’290,
 *  1,290, 1.290, 1 290), then at most two decimals. A following number ("CHF
 *  14.90 2 days") is not part of it. */
const NUMBER = String.raw`\d{1,3}(?:[   '’.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
const AMOUNT_RE = new RegExp(String.raw`CHF\s?(${NUMBER})(?!\d)|(?<![\d'’.,])(${NUMBER})\s?CHF`, 'gi')

/** CHF amounts in a text, as "1290.00". Swiss (1'290.–), English (1,290.00)
 *  and continental (1.290,00) spellings. */
export function amountsIn(text: string): string[] {
  const out: string[] = []
  const re = new RegExp(AMOUNT_RE.source, AMOUNT_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[1] ?? m[2] ?? ''
    // A separator followed by one or two final digits is the decimal point;
    // every other separator groups thousands.
    const decimals = /[.,](\d{1,2})$/.exec(raw)
    const whole = (decimals ? raw.slice(0, decimals.index) : raw).replace(/\D/g, '')
    const n = Number(`${whole}.${decimals ? decimals[1].padEnd(2, '0') : '00'}`)
    if (Number.isFinite(n)) out.push(money(n))
  }
  return out
}

export function checkReply(raw: string, evidence: Evidence): CheckedReply | null {
  let text = plainText(raw.trim())
  if (!text) return null

  // Bare paths of this shop become full URLs, so they can be checked and
  // linked like any other.
  text = text.replace(SITE_PATH, (_m, lead: string, path: string) => `${lead}${SITE_ORIGIN}${path}`)

  let removedLinks = 0
  const linkedProducts: string[] = []
  text = text.replace(URL_RE, (found) => {
    const url = found.replace(/[.,;:!?]+$/, '')
    const trailing = found.slice(url.length)
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      removedLinks++
      return trailing
    }
    if (parsed.host === SITE_HOST) {
      const product = /^\/(?:(?:it|fr|de)\/)?product\/([a-z0-9][a-z0-9-]{0,99})\/?$/i.exec(parsed.pathname)
      if (product) {
        const id = product[1].toLowerCase()
        if (!evidence.catalogIds.has(id)) {
          removedLinks++
          return trailing
        }
        if (linkedProducts.indexOf(id) === -1) linkedProducts.push(id)
      }
      return found
    }
    if (evidence.toolUrls.has(url)) return found
    removedLinks++
    return trailing
  })
  // A removed link can leave "( )" or a doubled space behind.
  text = text.replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:!?])/g, '$1').trim()
  if (!text) return null

  const unverifiedAmounts = amountsIn(text).filter((a) => !evidence.amounts.has(a)).length
  return { text: bounded(text, REPLY_MAX_CHARS), linkedProducts, removedLinks, unverifiedAmounts }
}

/** Every CHF amount and URL in a tool result, for the evidence. */
export function collectEvidence(value: unknown, into: Pick<Evidence, 'amounts' | 'toolUrls'>): void {
  if (typeof value === 'string') {
    for (const a of amountsIn(value)) into.amounts.add(a)
    if (/^https?:\/\//.test(value)) into.toolUrls.add(value)
    return
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) into.amounts.add(money(value))
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectEvidence(v, into)
    return
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectEvidence(v, into)
  }
}
