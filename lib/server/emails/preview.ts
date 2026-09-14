import 'server-only'

import type { Order } from '@/lib/types'
import { EMAIL_LANGS, emailLang, type EmailLang } from './copy'
import { abandonedCartEmail } from './abandoned-cart'
import { lifecycleEmail, welcomeEmail } from './lifecycle'
import { orderConfirmationEmail } from './order-confirmation'
import { passwordRecoveryHtml, passwordRecoverySubject } from './password-recovery'
import { paymentFailedEmail } from './payment-failed'
import { paymentReceiptEmail } from './payment-receipt'

/**
 * Every transactional email, rendered with an obviously fake sample order —
 * for reviewing the templates in each language without sending anything.
 * Served to admins only (/api/admin/email-preview).
 */

export const PREVIEW_TEMPLATES = [
  'welcome',
  'password_reset',
  'order_confirmation',
  'payment_success',
  'payment_failed',
  'status_processing',
  'status_shipped',
  'status_delivered',
  'status_cancelled',
  'refund',
  'abandoned_cart',
] as const

export type PreviewTemplate = (typeof PREVIEW_TEMPLATES)[number]

function sampleOrder(): Order {
  const createdAt = Date.now()
  return {
    id: 'LV-SAMPLE',
    createdAt,
    // Shipped today, so the shipping email shows its arrival window.
    shippedAt: createdAt,
    customer: {
      name: 'Alex Sample',
      phone: '',
      address: 'Bahnhofstrasse 1, 8001 Zürich, CH',
      email: 'customer@example.com',
    },
    items: [
      { key: 'a', productId: 'p-sample-1', name: 'Sample Heavyweight Hoodie', image: '', price: 189, size: 'M', color: 'Onyx', qty: 1 },
      { key: 'b', productId: 'p-sample-2', name: 'Sample Leather Cap', image: '', price: 69, size: 'One Size', color: 'Onyx', qty: 2 },
    ],
    subtotal: 327,
    discount: 0,
    shippingCost: 0,
    total: 327,
    payment: 'Карта онлайн',
    status: 'shipped',
    trackingNumber: '99.00.123456.78901234',
    courierName: 'Swiss Post',
    paymentProvider: 'stripe',
    paymentId: 'pi_sample_0000',
    paymentCurrency: 'EUR',
    paymentAmount: 349.89,
    refundedAmount: 327,
  }
}

export function renderPreview(template: PreviewTemplate, rawLang: unknown): { subject: string; html: string } {
  const lang: EmailLang = emailLang(rawLang)
  const order = sampleOrder()
  switch (template) {
    case 'welcome':
      return welcomeEmail('Alex Sample', lang)
    case 'password_reset':
      return { subject: passwordRecoverySubject(lang), html: passwordRecoveryHtml('482913', lang) }
    case 'order_confirmation':
      return orderConfirmationEmail(
        { ...order, status: 'pending', shippedAt: undefined, paymentCurrency: undefined, paymentAmount: undefined },
        lang,
      )
    case 'payment_success':
      return paymentReceiptEmail(order, lang)
    case 'payment_failed':
      return paymentFailedEmail(order, lang)
    case 'status_processing':
      return lifecycleEmail(order, 'processing', lang)!
    case 'status_shipped':
      return lifecycleEmail(order, 'shipped', lang)!
    case 'status_delivered':
      return lifecycleEmail(order, 'delivered', lang)!
    case 'status_cancelled':
      return lifecycleEmail(order, 'cancelled', lang)!
    case 'refund':
      return lifecycleEmail(order, 'refunded', lang)!
    case 'abandoned_cart':
      return abandonedCartEmail({ token: '00000000-0000-4000-8000-000000000000', items: order.items }, lang)
  }
}

/** A plain index: every template in every language, one link each. */
export function previewIndexHtml(basePath: string): string {
  const rows = PREVIEW_TEMPLATES.map(
    (t) =>
      `<tr><td style="padding:6px 16px 6px 0;font-family:monospace">${t}</td>${EMAIL_LANGS.map(
        (l) => `<td style="padding:6px 8px"><a href="${basePath}?template=${t}&lang=${l}">${l.toUpperCase()}</a></td>`,
      ).join('')}</tr>`,
  ).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Email previews</title></head>
<body style="font-family:Helvetica,Arial,sans-serif;padding:32px;background:#f6f4ef;color:#1c1a17">
<h1 style="font-family:Georgia,serif;font-weight:normal">Transactional emails — previews</h1>
<p style="color:#8a847a">Sample data only. Nothing is sent from this page.</p>
<table>${rows}</table></body></html>`
}
