import 'server-only'

import PDFDocument from 'pdfkit'

import { MONOGRAM_PATH } from '@/lib/brand/monogram.generated'
import { formatCharged } from '@/lib/currency'
import { SUPPORT_EMAIL } from '@/lib/data'
import { FULFILMENT } from '@/lib/fulfilment'
import type { Order, PaymentStatus } from '@/lib/types'
import * as FONTS from './fonts.generated'

/**
 * An order as a PDF: the invoice, or the packing slip that goes in the box.
 *
 * WHITE PAPER, DARK TYPE, GOLD RULES — not the site's black page. This is a
 * document that gets printed, and a full-bleed black A4 empties a toner
 * cartridge and smears; the brand survives as the Bodoni wordmark, the
 * monogram and the gold hairlines. The gold is a deeper one than the site's
 * #D4AF37, which is legible on black and nearly invisible printed on white.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. The shop trades as a non-VAT-registered
 * private seller (TAX_RATE in lib/fulfilment.ts), so there is no VAT number
 * and no VAT line — only "No VAT charged", which is a statement of fact about
 * this order. The invoice number is the order number: a separate sequential
 * series is what a VAT-registered business must keep, and inventing one here
 * would imply a registration the shop does not have.
 *
 * NAMES IN ANY OF THREE SCRIPTS. The embedded fonts are subsets — the Latin
 * one lacks Ł, the Latin-Extended one lacks the ASCII around it, Cyrillic has
 * neither. So customer-written text is set in RUNS, switching font as the
 * character range changes; "Łukasz" would otherwise print with boxes where
 * letters should be.
 */

export type PdfKind = 'invoice' | 'packing'

// ---------------------------------------------------------------- palette --
const INK = '#141414'
const MUTED = '#6B6B6B'
const HAIRLINE = '#D9D4C7'
const GOLD = '#A8862B'

// ---------------------------------------------------------------- page ----
const PAGE = { width: 595.28, height: 841.89 } // A4 in points
const M = 50
const CONTENT = PAGE.width - M * 2
const FOOTER_TOP = PAGE.height - 110
/** Room the totals need under the last row (the tallest case: discount, tax,
 *  another currency and a refund all present). */
const SUMMARY_HEIGHT = 150

type Weight = '400' | '600'
type Script = 'latin' | 'ext' | 'cyr'

function scriptOf(code: number): Script | null {
  if (code === 0x20) return null // a space belongs to whatever surrounds it
  if ((code >= 0x0400 && code <= 0x052f) || code === 0x2116) return 'cyr'
  if (
    (code >= 0x0100 && code <= 0x024f) ||
    (code >= 0x1e00 && code <= 0x1eff) ||
    (code >= 0x2c60 && code <= 0x2c7f) ||
    (code >= 0xa720 && code <= 0xa7ff)
  ) {
    return 'ext'
  }
  return 'latin'
}

/** Splits text into stretches that one embedded font can draw. */
function runs(text: string): { script: Script; text: string }[] {
  const out: { script: Script; text: string }[] = []
  for (const ch of Array.from(text)) {
    const script = scriptOf(ch.codePointAt(0) ?? 0x20) ?? out[out.length - 1]?.script ?? 'latin'
    const last = out[out.length - 1]
    if (last && last.script === script) last.text += ch
    else out.push({ script, text: ch })
  }
  return out
}

function fontFor(script: Script, weight: Weight): string {
  // Only Latin has a 600 cut. Extended and Cyrillic letters inside a bold
  // label fall back to 400 rather than to a box.
  if (script === 'cyr') return 'inter-cyr-400'
  if (script === 'ext') return 'inter-ext-400'
  return weight === '600' ? 'inter-600' : 'inter-400'
}

type Doc = PDFKit.PDFDocument

/**
 * One line of text that may mix scripts. Never wraps: it is for names,
 * addresses and labels, all short; long product names use `block`.
 */
function line(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  opts: { size?: number; weight?: Weight; color?: string; width?: number; align?: 'left' | 'right' | 'center' } = {},
) {
  const parts = runs(text || ' ')
  doc.fillColor(opts.color ?? INK).fontSize(opts.size ?? 9.5)
  // Right-aligned text is numbers and labels — one script — so it is set as a
  // single run, which is what lets pdfkit align it.
  if (opts.align === 'right' || opts.align === 'center' || parts.length === 1) {
    doc.font(fontFor(parts[0].script, opts.weight ?? '400'))
    doc.text(text, x, y, { width: opts.width, align: opts.align, lineBreak: false })
    return
  }
  parts.forEach((part, i) => {
    doc.font(fontFor(part.script, opts.weight ?? '400'))
    const continued = i < parts.length - 1
    if (i === 0) doc.text(part.text, x, y, { continued, lineBreak: false })
    else doc.text(part.text, { continued, lineBreak: false })
  })
}

function rule(doc: Doc, y: number, color = HAIRLINE, from = M, to = PAGE.width - M) {
  doc.moveTo(from, y).lineTo(to, y).lineWidth(0.6).strokeColor(color).stroke()
}

function chf(amount: number): string {
  return formatCharged(amount, 'CHF')
}

function date(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  paid: 'Paid',
  pending_payment: 'Awaiting payment',
  confirming: 'Payment confirming',
  failed: 'Payment failed',
  expired: 'Payment expired',
  refunded: 'Refunded',
  partially_refunded: 'Partially refunded',
}

// ---------------------------------------------------------------- blocks ---

function header(doc: Doc, order: Order, kind: PdfKind) {
  // The monogram: a 512-unit path, drawn at 38 points.
  const size = 38
  doc.save()
  doc.translate(M - 4, M - 6).scale(size / 512)
  doc.path(MONOGRAM_PATH).fill(GOLD)
  doc.restore()

  doc.font('bodoni').fontSize(20).fillColor(INK)
  doc.text('LUXE', M + 42, M + 4, { continued: true, characterSpacing: 3 })
  doc.fillColor(GOLD).text(' VAULT', { characterSpacing: 3 })

  // The document's own identity, top right.
  const right = PAGE.width - M - 200
  line(doc, kind === 'invoice' ? 'INVOICE' : 'PACKING SLIP', right, M, {
    size: 8, weight: '600', color: GOLD, width: 200, align: 'right',
  })
  line(doc, order.id, right, M + 13, { size: 14, weight: '600', width: 200, align: 'right' })
  line(doc, date(order.createdAt), right, M + 32, { size: 9, color: MUTED, width: 200, align: 'right' })
  if (kind === 'invoice') {
    const status = order.paymentStatus ? PAYMENT_LABEL[order.paymentStatus] : 'Awaiting payment'
    line(doc, status, right, M + 45, {
      size: 9, weight: '600', color: order.paymentStatus === 'paid' ? GOLD : MUTED, width: 200, align: 'right',
    })
  }

  rule(doc, M + 66, GOLD)
}

function parties(doc: Doc, order: Order): number {
  const top = M + 86
  const col = CONTENT / 2
  const c = order.customer
  const address = [c.street, [c.postalCode, c.city].filter(Boolean).join(' '), c.country]
    .filter((v): v is string => Boolean(v && v.trim()))
  // Older orders stored the address as one free-text line.
  const shipTo = address.length > 0 ? address : [c.address].filter(Boolean)

  line(doc, 'BILLED TO', M, top, { size: 7.5, weight: '600', color: MUTED })
  let y = top + 14
  for (const value of [c.name, c.email, c.phone].filter(Boolean) as string[]) {
    line(doc, value, M, y, { size: 9.5, color: value === c.name ? INK : MUTED, weight: value === c.name ? '600' : '400' })
    y += 13
  }

  line(doc, 'SHIP TO', M + col, top, { size: 7.5, weight: '600', color: MUTED })
  let y2 = top + 14
  line(doc, c.name, M + col, y2, { size: 9.5, weight: '600' })
  y2 += 13
  for (const value of shipTo) {
    line(doc, value, M + col, y2, { size: 9.5, color: MUTED })
    y2 += 13
  }
  return Math.max(y, y2) + 16
}

/** The items table. Returns where it ended. Breaks onto a new page, with the
 *  column headings repeated, whenever the next row would reach the footer. */
function items(doc: Doc, order: Order, kind: PdfKind, startY: number): number {
  const priced = kind === 'invoice'
  const cols = priced
    ? { item: M, qty: M + 300, unit: M + 345, amount: M + 420 }
    : { item: M, qty: M + 420, unit: 0, amount: 0 }
  const nameWidth = priced ? 280 : 400

  const headings = (y: number) => {
    line(doc, 'ITEM', cols.item, y, { size: 7.5, weight: '600', color: MUTED })
    line(doc, 'QTY', cols.qty, y, { size: 7.5, weight: '600', color: MUTED, width: 30, align: 'right' })
    if (priced) {
      line(doc, 'UNIT PRICE', cols.unit, y, { size: 7.5, weight: '600', color: MUTED, width: 70, align: 'right' })
      line(doc, 'AMOUNT', cols.amount, y, { size: 7.5, weight: '600', color: MUTED, width: CONTENT - 420, align: 'right' })
    } else {
      line(doc, 'PACKED', PAGE.width - M - 50, y, { size: 7.5, weight: '600', color: MUTED, width: 50, align: 'right' })
    }
    rule(doc, y + 14)
    return y + 24
  }

  let y = headings(startY)
  for (const item of order.items ?? []) {
    doc.font('inter-600').fontSize(9.5)
    const nameHeight = doc.heightOfString(item.name, { width: nameWidth })
    const rowHeight = nameHeight + 26

    if (y + rowHeight > FOOTER_TOP - 20) {
      doc.addPage({ size: 'A4', margin: M })
      y = headings(M)
    }

    // Product names are catalogue text and may run long, so this block is
    // allowed to wrap; it is set in the Latin 600 cut, which every current
    // product name fits. The font is set again here because the headings of
    // a fresh page have just changed it.
    doc.font('inter-600').fontSize(9.5).fillColor(INK).text(item.name, cols.item, y, { width: nameWidth })
    line(doc, [item.size, item.color].filter(Boolean).join(' · '), cols.item, y + nameHeight + 3, {
      size: 8.5, color: MUTED,
    })

    line(doc, String(item.qty), cols.qty, y, { size: 9.5, width: 30, align: 'right' })
    if (priced) {
      line(doc, chf(item.price), cols.unit, y, { size: 9.5, width: 70, align: 'right' })
      line(doc, chf(item.price * item.qty), cols.amount, y, {
        size: 9.5, weight: '600', width: CONTENT - 420, align: 'right',
      })
    } else {
      // An empty box to tick while packing.
      doc.rect(PAGE.width - M - 11, y, 11, 11).lineWidth(0.8).strokeColor(INK).stroke()
    }

    y += rowHeight
    rule(doc, y - 8)
  }
  return y
}

function summary(doc: Doc, order: Order, startY: number): number {
  const labelX = PAGE.width - M - 230
  const valueX = PAGE.width - M - 110
  let y = startY + 6
  // The totals are never split from each other: if they do not fit above the
  // footer, they start the next page.
  if (y + SUMMARY_HEIGHT > FOOTER_TOP - 20) {
    doc.addPage({ size: 'A4', margin: M })
    y = M
  }

  const row = (label: string, value: string, strong = false) => {
    // The larger total figure sits on the label's baseline, not its top.
    line(doc, label, labelX, strong ? y + 2.5 : y, { size: 9.5, color: strong ? INK : MUTED, weight: strong ? '600' : '400', width: 110 })
    line(doc, value, valueX, y, { size: strong ? 12 : 9.5, weight: strong ? '600' : '400', width: 110, align: 'right' })
    y += strong ? 20 : 15
  }

  row('Subtotal', chf(order.subtotal))
  if (order.discount > 0) row(order.promo ? `Discount (${order.promo})` : 'Discount', `– ${chf(order.discount)}`)
  row('Shipping', order.shippingCost ? chf(order.shippingCost) : 'Free')
  if (order.tax && order.tax > 0) row('Tax', chf(order.tax))

  y += 2
  rule(doc, y, GOLD, labelX, PAGE.width - M)
  y += 10
  row(order.paymentStatus === 'paid' ? 'Total paid' : 'Total', chf(order.total), true)

  // A card charged in another currency: what actually left the customer's
  // account, which is what they will match against their statement.
  if (order.paymentCurrency && order.paymentCurrency.toUpperCase() !== 'CHF' && order.paymentAmount) {
    line(doc, `Charged as ${formatCharged(order.paymentAmount, order.paymentCurrency)}`, labelX, y, {
      size: 8.5, color: MUTED, width: 230, align: 'right',
    })
    y += 13
  }
  if (order.refundedAmount && order.refundedAmount > 0) {
    line(doc, `Refunded ${chf(order.refundedAmount)}`, labelX, y, { size: 8.5, color: GOLD, width: 230, align: 'right' })
    y += 13
  }
  if (!order.tax) {
    line(doc, 'No VAT charged.', labelX, y, { size: 8, color: MUTED, width: 230, align: 'right' })
    y += 12
  }
  return y
}

function footer(doc: Doc) {
  const y = FOOTER_TOP
  // The footer sits inside the bottom margin on purpose. Left at 50 points,
  // pdfkit would decide its last line does not fit and start a page for it.
  doc.page.margins.bottom = 0
  rule(doc, y, GOLD)
  doc.font('bodoni').fontSize(12).fillColor(INK)
  doc.text('Thank you for shopping with Luxe Vault', M, y + 16, { width: CONTENT, align: 'center' })
  line(
    doc,
    `Returns are accepted within ${FULFILMENT.returnWindowDays} days of delivery, unworn and with original tags — request one from your account.`,
    M, y + 40, { size: 8, color: MUTED, width: CONTENT, align: 'center' },
  )
  line(doc, `Questions: ${SUPPORT_EMAIL}  ·  luxe-vault.store`, M, y + 54, {
    size: 8, color: MUTED, width: CONTENT, align: 'center',
  })
}

// ----------------------------------------------------------------- render --

export function renderOrderPdf(order: Order, kind: PdfKind): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: M,
      // Without a font here pdfkit opens with Helvetica, which it loads from a
      // data file through a require that Vercel's file tracer cannot follow —
      // the file is not in the deployed function and every download fails.
      // Starting on an embedded font means that file is never asked for.
      font: Buffer.from(FONTS.interLatin400, 'base64') as unknown as string,
      // Metadata the PDF viewer shows; the order number, never the customer.
      info: {
        Title: `${kind === 'invoice' ? 'Invoice' : 'Packing slip'} ${order.id}`,
        Author: 'Luxe Vault',
        Creator: 'Luxe Vault',
      },
    })

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    try {
      doc.registerFont('inter-400', Buffer.from(FONTS.interLatin400, 'base64'))
      doc.registerFont('inter-600', Buffer.from(FONTS.interLatin600, 'base64'))
      doc.registerFont('inter-ext-400', Buffer.from(FONTS.interLatinExt400, 'base64'))
      doc.registerFont('inter-cyr-400', Buffer.from(FONTS.interCyrillic400, 'base64'))
      doc.registerFont('bodoni', Buffer.from(FONTS.bodoniLatin500, 'base64'))

      header(doc, order, kind)
      const afterParties = parties(doc, order)
      const afterItems = items(doc, order, kind, afterParties)
      if (kind === 'invoice') summary(doc, order, afterItems)
      footer(doc)
      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}
