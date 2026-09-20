// A newsletter campaign: its fields, their validation, and the email they
// render to. Shared by the admin composer (live preview, in the browser) and
// the send route (the real thing, on the server), so what the admin previews
// is byte-for-byte what subscribers receive — apart from each recipient's own
// unsubscribe link and footer language.
//
// Deliberately free of server-only imports. The palette mirrors
// lib/server/emails/layout.ts (the transactional emails), so a campaign sits
// beside an order confirmation in the same inbox as the same brand.

import { DEFAULT_LOCALE } from '@/lib/i18n'

export type CampaignContent = {
  subject: string
  preheader: string
  title: string
  body: string
  imageUrl: string
  ctaLabel: string
  ctaUrl: string
}

export type NewsletterLang = 'ru' | 'en' | 'it' | 'fr' | 'de'

export const CAMPAIGN_LIMITS = {
  subject: 150,
  preheader: 200,
  title: 160,
  body: 8000,
  url: 800,
  ctaLabel: 40,
} as const

export type CampaignFieldError = Partial<Record<keyof CampaignContent, string>>

function isHttpUrl(value: string, allowRelative: boolean): boolean {
  if (allowRelative && value.startsWith('/') && !value.startsWith('//')) return true
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/** Trims every field and reports what is wrong, in the admin's language. */
export function validateCampaign(input: Partial<Record<keyof CampaignContent, unknown>>): {
  content: CampaignContent
  errors: CampaignFieldError
} {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const content: CampaignContent = {
    subject: str(input.subject),
    preheader: str(input.preheader),
    title: str(input.title),
    body: typeof input.body === 'string' ? input.body.replace(/\r\n/g, '\n').trim() : '',
    imageUrl: str(input.imageUrl),
    ctaLabel: str(input.ctaLabel),
    ctaUrl: str(input.ctaUrl),
  }

  const errors: CampaignFieldError = {}
  if (!content.subject) errors.subject = 'Укажите тему письма'
  else if (content.subject.length > CAMPAIGN_LIMITS.subject) errors.subject = `Не длиннее ${CAMPAIGN_LIMITS.subject} символов`
  if (content.preheader.length > CAMPAIGN_LIMITS.preheader) errors.preheader = `Не длиннее ${CAMPAIGN_LIMITS.preheader} символов`
  if (!content.title) errors.title = 'Укажите заголовок'
  else if (content.title.length > CAMPAIGN_LIMITS.title) errors.title = `Не длиннее ${CAMPAIGN_LIMITS.title} символов`
  if (!content.body) errors.body = 'Напишите текст письма'
  else if (content.body.length > CAMPAIGN_LIMITS.body) errors.body = `Не длиннее ${CAMPAIGN_LIMITS.body} символов`
  if (content.imageUrl && (content.imageUrl.length > CAMPAIGN_LIMITS.url || !content.imageUrl.startsWith('https://') || !isHttpUrl(content.imageUrl, false))) {
    errors.imageUrl = 'Нужна ссылка на изображение, начинающаяся с https://'
  }
  if (content.ctaLabel || content.ctaUrl) {
    if (!content.ctaLabel) errors.ctaLabel = 'Укажите текст кнопки или очистите ссылку'
    else if (content.ctaLabel.length > CAMPAIGN_LIMITS.ctaLabel) errors.ctaLabel = `Не длиннее ${CAMPAIGN_LIMITS.ctaLabel} символов`
    if (!content.ctaUrl) errors.ctaUrl = 'Укажите ссылку кнопки или очистите текст'
    else if (content.ctaUrl.length > CAMPAIGN_LIMITS.url || !isHttpUrl(content.ctaUrl, true)) {
      errors.ctaUrl = 'Ссылка должна начинаться с https:// или с / (страница магазина)'
    }
  }
  return { content, errors }
}

const P = {
  ground: '#000000',
  card: '#0D0D0D',
  border: '#222222',
  heading: '#D4AF37',
  strong: '#E5E5E5',
  body: '#CCCCCC',
  muted: '#8c8c8c',
  gold: '#D4AF37',
  buttonText: '#000000',
}
const SANS = 'Helvetica,Arial,sans-serif'
const SERIF = "Georgia,'Times New Roman',serif"

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const FOOTER: Record<NewsletterLang, { why: string; unsubscribe: string }> = {
  ru: { why: 'Вы получили это письмо, потому что подписались на рассылку LUXE VAULT.', unsubscribe: 'Отписаться от рассылки' },
  en: { why: 'You are receiving this because you subscribed to the LUXE VAULT newsletter.', unsubscribe: 'Unsubscribe' },
  it: { why: 'Ricevi questa email perché sei iscritto alla newsletter LUXE VAULT.', unsubscribe: "Annulla l'iscrizione" },
  fr: { why: 'Vous recevez cet e-mail car vous êtes abonné à la newsletter LUXE VAULT.', unsubscribe: 'Se désabonner' },
  de: { why: 'Sie erhalten diese E-Mail, weil Sie den LUXE VAULT Newsletter abonniert haben.', unsubscribe: 'Abmelden' },
}

/**
 * A campaign language from a stored subscriber locale.
 *
 * Falls back to the storefront's default rather than to Russian, and turns a
 * stored 'ru' into that default too: a subscriber who signed up when the shop
 * still offered Russian now reads it in the language the shop actually
 * publishes in. The Russian FOOTER entry above stays for the archive's sake —
 * `NewsletterLang` still admits it — but nothing reaches it any more.
 */
export function newsletterLang(value: unknown): NewsletterLang {
  return value === 'en' || value === 'it' || value === 'fr' || value === 'de' ? value : DEFAULT_LOCALE
}

/** A relative CTA link ("/category/clothing") made absolute to the shop. */
export function absoluteUrl(url: string, siteUrl: string): string {
  return url.startsWith('/') ? `${siteUrl.replace(/\/$/, '')}${url}` : url
}

/** Paragraphs at blank lines, line breaks within them. Plain text only — the
 *  body is escaped, never interpreted as HTML. */
function bodyHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map(
      (para, i) =>
        `<p style="margin:${i === 0 ? '0' : '16px'} 0 0 0; font-family:${SANS}; font-size:15px; line-height:25px; color:${P.body};">${esc(para).replace(/\n/g, '<br />')}</p>`,
    )
    .join('')
}

export function renderCampaignEmail(
  content: CampaignContent,
  options: { siteUrl: string; unsubscribeUrl: string; lang?: NewsletterLang },
): { html: string; text: string } {
  const lang = options.lang ?? DEFAULT_LOCALE
  const f = FOOTER[lang]
  const site = options.siteUrl.replace(/\/$/, '')
  const ctaHref = content.ctaLabel && content.ctaUrl ? absoluteUrl(content.ctaUrl, site) : ''

  const image = content.imageUrl
    ? `
            <tr>
              <td style="padding:0;">
                <img src="${esc(content.imageUrl)}" width="580" alt="${esc(content.title)}" style="display:block; width:100%; max-width:580px; height:auto; border:0; outline:none; text-decoration:none;" />
              </td>
            </tr>`
    : ''

  const cta = ctaHref
    ? `
            <tr>
              <td class="lv-pad" align="left" style="padding:30px 40px 0 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td bgcolor="${P.gold}" style="background:${P.gold};">
                      <a href="${esc(ctaHref)}" style="display:inline-block; padding:15px 32px; font-family:${SANS}; font-size:12px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${P.buttonText}; text-decoration:none;">${esc(content.ctaLabel)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
    : ''

  const html = `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>${esc(content.subject)}</title>
    <style>
      @media only screen and (max-width: 600px) {
        .lv-shell { padding: 16px 8px !important; }
        .lv-pad { padding-left: 24px !important; padding-right: 24px !important; }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background:${P.ground}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
    <div style="display:none; font-size:1px; color:${P.ground}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
      ${esc(content.preheader || content.title)}
      &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${P.ground}" style="background:${P.ground};">
      <tr>
        <td align="center" class="lv-shell" style="padding:36px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${P.card}" style="max-width:580px; width:100%; background:${P.card}; border:1px solid ${P.border};">
            <tr><td height="3" bgcolor="${P.gold}" style="height:3px; line-height:3px; font-size:0; background:${P.gold};">&nbsp;</td></tr>
            <tr>
              <td class="lv-pad" align="center" style="padding:26px 40px 24px 40px; border-bottom:1px solid ${P.border};">
                <a href="${esc(site)}" style="text-decoration:none;">
                  <span style="font-family:${SERIF}; font-size:18px; letter-spacing:5px; color:${P.strong};">LUXE</span><span style="font-family:${SERIF}; font-size:18px; letter-spacing:5px; color:${P.gold};">VAULT</span>
                </a>
              </td>
            </tr>${image}
            <tr>
              <td class="lv-pad" style="padding:36px 40px 0 40px;">
                <h1 style="margin:0; font-family:${SERIF}; font-size:28px; line-height:36px; font-weight:normal; color:${P.strong};">${esc(content.title)}</h1>
              </td>
            </tr>
            <tr>
              <td class="lv-pad" style="padding:18px 40px 0 40px;">${bodyHtml(content.body)}
              </td>
            </tr>${cta}
            <tr>
              <td class="lv-pad" style="padding:40px 40px 28px 40px;">
                <p style="margin:0; padding-top:18px; border-top:1px solid ${P.border}; font-family:${SANS}; font-size:11px; line-height:18px; color:${P.muted};">
                  Luxe Vault &middot; Zurich, Switzerland &middot; <a href="${esc(site)}" style="color:${P.muted};">${esc(site.replace(/^https?:\/\//, ''))}</a><br />
                  ${esc(f.why)}<br />
                  <a href="${esc(options.unsubscribeUrl)}" style="color:${P.muted}; text-decoration:underline;">${esc(f.unsubscribe)}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const text = [
    content.title,
    '',
    content.body,
    ctaHref ? `\n${content.ctaLabel}: ${ctaHref}` : null,
    '',
    '—',
    `Luxe Vault · ${site.replace(/^https?:\/\//, '')}`,
    f.why,
    `${f.unsubscribe}: ${options.unsubscribeUrl}`,
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n')

  return { html, text }
}
