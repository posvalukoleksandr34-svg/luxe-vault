import 'server-only'

import { SUPPORT_EMAIL } from '@/lib/data'
import { escapeHtml } from '@/lib/server/resend'
import { getSiteUrl } from '@/lib/site-url'
import type { Order } from '@/lib/types'
import { EMAIL_COPY, type EmailCopy, type EmailLang } from './copy'

/**
 * The emails' one layout — every transactional message, and the palette the
 * prompted and support emails share (campaigns.ts, mailer.ts).
 *
 * DARK LUXURY: a pure #000000 ground; a #0D0D0D card with a #222222 border
 * and a gold #D4AF37 accent line across its top; headings, section labels and
 * accents in gold; body text #CCCCCC; the primary button solid gold with bold
 * black text. Built so mail clients keep it dark instead of inverting it:
 * color-scheme is declared `dark`, and every background is set twice — as a
 * bgcolor attribute, which Outlook's Word engine reads, and as inline CSS for
 * everyone else. All text clears WCAG AA contrast on the card.
 *
 * Table layout with inline styles only — Outlook renders with Word's engine
 * and supports neither flexbox nor external stylesheets.
 *
 * Nothing sensitive goes in: no card data (this server never has any), no
 * passwords, and only the name and delivery address an order needs — no
 * phone number.
 */

/** The email palette. */
export const L = {
  ground: '#000000',
  card: '#0D0D0D',
  inset: '#141414',
  border: '#222222',
  /** Headings and accents — the brand gold. */
  heading: '#D4AF37',
  /** Values that should stand out of the body text: names, amounts, numbers. */
  strong: '#E5E5E5',
  body: '#CCCCCC',
  // 6:1 on the card — quiet, still readable.
  muted: '#8c8c8c',
  rule: '#D4AF37',
  goldText: '#D4AF37',
  button: '#D4AF37',
  buttonText: '#000000',
}

export const SANS = 'Helvetica,Arial,sans-serif'
export const SERIF = "Georgia,'Times New Roman',serif"

export type RenderedEmail = { subject: string; html: string; text: string }

export const esc = escapeHtml

/** Money as the storefront writes it in text: code, then the amount. */
export function money(amount: number, currency = 'CHF'): string {
  return `${currency.toUpperCase()} ${amount.toFixed(2)}`
}

export function formatDate(ms: number, lang: EmailLang): string {
  try {
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString().slice(0, 10)
  }
}

/** "18 – 19 September" in the reader's language; one date when both ends match. */
export function formatDateRange(fromMs: number, toMs: number, lang: EmailLang): string {
  try {
    const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long' })
    const a = fmt.format(new Date(fromMs))
    const b = fmt.format(new Date(toMs))
    return a === b ? a : `${a} – ${b}`
  } catch {
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
    return `${iso(fromMs)} – ${iso(toMs)}`
  }
}

export function orderHref(order: Pick<Order, 'id'>): string {
  return `${getSiteUrl()}/order/${encodeURIComponent(order.id)}`
}

export function copyFor(lang: EmailLang): EmailCopy {
  return EMAIL_COPY[lang]
}

// ---------------------------------------------------------------- sections --

/** Section labels: small gold capitals — the layout's accents. */
const LABEL = `font-family:${SANS}; font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:${L.heading};`

/** Label/value pairs in a quiet box — order number, status. */
export function metaSection(pairs: [string, string][]): string {
  const cells = pairs
    .map(
      ([label, value]) => `
        <td valign="top" style="padding:14px 18px;">
          <span style="${LABEL}">${esc(label)}</span><br />
          <span style="font-family:${SANS}; font-size:15px; line-height:22px; color:${L.strong};">${esc(value)}</span>
        </td>`,
    )
    .join('')
  return `
    <tr>
      <td class="lv-pad" style="padding:24px 36px 0 36px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${L.inset}" style="background:${L.inset}; border:1px solid ${L.border};">
          <tr>${cells}</tr>
        </table>
      </td>
    </tr>`
}

/** A highlighted figure in gold — the amount paid or refunded, a tracking number. */
export function highlightSection(label: string, valueHtml: string, note?: string): string {
  return `
    <tr>
      <td class="lv-pad" style="padding:24px 36px 0 36px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${L.inset}" style="border-top:2px solid ${L.rule}; background:${L.inset};">
          <tr>
            <td align="center" style="padding:20px 16px;">
              <span style="${LABEL}">${esc(label)}</span>
              <div style="margin-top:8px; font-family:${SERIF}; font-size:26px; line-height:32px; color:${L.heading};">${valueHtml}</div>
              ${note ? `<p style="margin:8px 0 0 0; font-family:${SANS}; font-size:12px; line-height:18px; color:${L.muted};">${esc(note)}</p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>`
}

export function itemsSection(order: Pick<Order, 'items'>, c: EmailCopy): string {
  const rows = order.items
    .map(
      (item) => `
        <tr>
          <td style="padding:12px 0; border-bottom:1px solid ${L.border}; font-family:${SANS}; font-size:14px; line-height:20px; color:${L.body};">
            <span style="color:${L.strong};">${esc(item.name)}</span><br />
            <span style="font-size:12px; color:${L.muted};">${esc(item.size)} &middot; ${esc(item.color)} &middot; &times;${item.qty}</span>
          </td>
          <td align="right" valign="top" style="padding:12px 0; border-bottom:1px solid ${L.border}; font-family:${SANS}; font-size:14px; color:${L.strong}; white-space:nowrap;">
            ${esc(money(item.price * item.qty))}
          </td>
        </tr>`,
    )
    .join('')
  return `
    <tr>
      <td class="lv-pad" style="padding:26px 36px 0 36px;">
        <p style="margin:0 0 4px 0; ${LABEL}">${esc(c.items)}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
      </td>
    </tr>`
}

export function totalsSection(order: Order, c: EmailCopy): string {
  const row = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding:${strong ? '14px' : '6px'} 0 0 0; font-family:${SANS}; font-size:${strong ? '14px' : '13px'}; color:${strong ? L.strong : L.muted};">${esc(label)}</td>
      <td align="right" style="padding:${strong ? '14px' : '6px'} 0 0 0; font-family:${strong ? SERIF : SANS}; font-size:${strong ? '20px' : '13px'}; color:${strong ? L.heading : L.body}; white-space:nowrap;">${esc(value)}</td>
    </tr>`
  return `
    <tr>
      <td class="lv-pad" style="padding:8px 36px 0 36px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${row(c.subtotal, money(order.subtotal))}
          ${order.discount > 0 ? row(c.discount, `-${money(order.discount)}`) : ''}
          ${row(c.shipping, order.shippingCost ? money(order.shippingCost) : c.free)}
          ${(order.tax ?? 0) > 0 ? row(c.tax, money(order.tax ?? 0)) : ''}
          ${row(c.total, money(order.total), true)}
        </table>
      </td>
    </tr>`
}

export function addressSection(order: Order, c: EmailCopy): string {
  return `
    <tr>
      <td class="lv-pad" style="padding:26px 36px 0 36px;">
        <p style="margin:0 0 6px 0; ${LABEL}">${esc(c.shippingTo)}</p>
        <p style="margin:0; font-family:${SANS}; font-size:14px; line-height:22px; color:${L.body};">
          <span style="color:${L.strong};">${esc(order.customer.name)}</span><br />
          ${esc(order.customer.address)}
        </p>
      </td>
    </tr>`
}

export function paragraphSection(text: string, muted = false): string {
  return `
    <tr>
      <td class="lv-pad" style="padding:18px 36px 0 36px;">
        <p style="margin:0; font-family:${SANS}; font-size:${muted ? '13px' : '14px'}; line-height:22px; color:${muted ? L.muted : L.body};">${esc(text)}</p>
      </td>
    </tr>`
}

/** Someone's own words, quoted: a gold rule on the left, line breaks kept. */
export function quoteSection(text: string): string {
  return `
    <tr>
      <td class="lv-pad" style="padding:22px 36px 0 36px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${L.inset}" style="background:${L.inset}; border-left:2px solid ${L.rule};">
          <tr>
            <td style="padding:14px 18px; font-family:${SANS}; font-size:14px; line-height:22px; color:${L.body};">${esc(text).replace(/\r?\n/g, '<br />')}</td>
          </tr>
        </table>
      </td>
    </tr>`
}

/** A date window set off by a gold rule, with a line on what it means. */
export function deliverySection(label: string, value: string, note?: string): string {
  return `
    <tr>
      <td class="lv-pad" style="padding:24px 36px 0 36px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${L.inset}" style="background:${L.inset}; border-left:2px solid ${L.rule};">
          <tr>
            <td style="padding:14px 18px;">
              <span style="${LABEL}">${esc(label)}</span><br />
              <span style="font-family:${SERIF}; font-size:17px; line-height:26px; color:${L.strong};">${esc(value)}</span>
              ${note ? `<br /><span style="font-family:${SANS}; font-size:12px; line-height:18px; color:${L.muted};">${esc(note)}</span>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>`
}

// ------------------------------------------------------------------ layout --

/**
 * The gold accent line across the top of the card. A row of its own with a
 * bgcolor rather than a border-top: Outlook draws that reliably, and it sits
 * inside the card's #222222 border instead of fighting it.
 */
export const ACCENT_LINE = `<tr><td height="3" bgcolor="${L.rule}" style="height:3px; line-height:3px; font-size:0; background:${L.rule};">&nbsp;</td></tr>`

/** The primary button: solid gold, bold black capitals. A table cell with a
 *  bgcolor so Outlook paints the gold too. */
export function buttonHtml(label: string, href: string): string {
  return `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td bgcolor="${L.button}" style="background:${L.button};">
                <a href="${esc(href)}" style="display:inline-block; padding:14px 30px; font-family:${SANS}; font-size:12px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${L.buttonText}; text-decoration:none;">
                  ${esc(label)}
                </a>
              </td>
            </tr>
          </table>`
}

export function renderEmail(o: {
  lang: EmailLang
  subject: string
  /** The grey preview line beside the subject in an inbox. */
  preheader: string
  heading: string
  intro?: string
  sections?: string[]
  cta?: { label: string; href: string } | null
  /** A quieter gold text link under the button — e.g. "View order" when the
   *  button goes to the carrier. */
  secondaryLink?: { label: string; href: string }
  /** A line in the footer saying why this email was sent (prompted mail). */
  footerNote?: string
  /** An opt-out link in the footer (prompted mail; order emails have none). */
  unsubscribe?: { label: string; href: string }
}): string {
  const c = copyFor(o.lang)
  const site = getSiteUrl()
  const cta = o.cta
    ? `
      <tr>
        <td class="lv-pad" align="left" style="padding:30px 36px 0 36px;">${buttonHtml(o.cta.label, o.cta.href)}
        </td>
      </tr>`
    : ''
  const secondary = o.secondaryLink
    ? `
      <tr>
        <td class="lv-pad" align="left" style="padding:16px 36px 0 36px;">
          <a href="${esc(o.secondaryLink.href)}" style="font-family:${SANS}; font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:${L.goldText}; text-decoration:none;">${esc(o.secondaryLink.label)} &rarr;</a>
        </td>
      </tr>`
    : ''

  return `<!doctype html>
<html lang="${o.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>${esc(o.subject)}</title>
    <style>
      @media only screen and (max-width: 600px) {
        .lv-shell { padding: 16px 8px !important; }
        .lv-pad { padding-left: 22px !important; padding-right: 22px !important; }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background:${L.ground}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
    <div style="display:none; font-size:1px; color:${L.ground}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
      ${esc(o.preheader)}
      &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${L.ground}" style="background:${L.ground};">
      <tr>
        <td align="center" class="lv-shell" style="padding:36px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${L.card}" style="max-width:580px; width:100%; background:${L.card}; border:1px solid ${L.border};">
            ${ACCENT_LINE}
            <tr>
              <td class="lv-pad" style="padding:24px 36px 22px 36px; border-bottom:1px solid ${L.border};">
                <a href="${esc(site)}" style="text-decoration:none;">
                  <span style="font-family:${SERIF}; font-size:18px; letter-spacing:4px; color:${L.strong};">LUXE</span><span style="font-family:${SERIF}; font-size:18px; letter-spacing:4px; color:${L.goldText};">VAULT</span>
                </a>
              </td>
            </tr>
            <tr>
              <td class="lv-pad" style="padding:32px 36px 0 36px;">
                <h1 style="margin:0; font-family:${SERIF}; font-size:25px; line-height:32px; font-weight:normal; color:${L.heading};">${esc(o.heading)}</h1>
                ${o.intro ? `<p style="margin:14px 0 0 0; font-family:${SANS}; font-size:14px; line-height:23px; color:${L.body};">${esc(o.intro)}</p>` : ''}
              </td>
            </tr>
            ${(o.sections ?? []).join('')}
            ${cta}
            ${secondary}
            <tr>
              <td class="lv-pad" style="padding:32px 36px 0 36px;">
                <p style="margin:0; font-family:${SANS}; font-size:13px; line-height:21px; color:${L.muted};">
                  ${esc(c.help)} <a href="mailto:${SUPPORT_EMAIL}" style="color:${L.goldText}; text-decoration:none;">${SUPPORT_EMAIL}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td class="lv-pad" style="padding:22px 36px 26px 36px;">
                <p style="margin:0; padding-top:16px; border-top:1px solid ${L.border}; font-family:${SANS}; font-size:11px; line-height:18px; color:${L.muted};">
                  Luxe Vault &middot; Zurich, Switzerland &middot; <a href="${esc(site)}" style="color:${L.muted};">${esc(site.replace(/^https?:\/\//, ''))}</a><br />
                  ${esc(c.automatic)}
                  ${o.footerNote ? `<br />${esc(o.footerNote)}` : ''}
                  ${o.unsubscribe ? `<br /><a href="${esc(o.unsubscribe.href)}" style="color:${L.muted}; text-decoration:underline;">${esc(o.unsubscribe.label)}</a>` : ''}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/** Plain-text alternative: `null` drops a line, '' keeps a blank separator. */
export function textEmail(lines: (string | null | undefined)[]): string {
  return lines.filter((l): l is string => typeof l === 'string').join('\n')
}
