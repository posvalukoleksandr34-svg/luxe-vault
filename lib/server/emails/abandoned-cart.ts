import 'server-only'

import { SUPPORT_EMAIL } from '@/lib/data'
import { isMailConfigured, sendEmail } from '@/lib/server/resend'
import { getSiteUrl } from '@/lib/site-url'
import type { CartItem } from '@/lib/types'
import type { EmailLang } from './copy'
import {
  copyFor,
  esc,
  highlightSection,
  itemsSection,
  money,
  renderEmail,
  textEmail,
  type RenderedEmail,
} from './layout'

/**
 * "You left something behind in your Vault" — the one reminder about a cart
 * that reached the checkout's email field and was never ordered.
 *
 * In the transactional Dark Luxury layout. The same restraint as the other
 * prompted emails (campaigns.ts): sent once, no invented urgency, no discount
 * — and it says why it was sent and how to stop it, with a List-Unsubscribe
 * header so mail clients show their own one-click opt-out too.
 */

const COPY: Record<
  EmailLang,
  {
    subject: string
    heading: string
    intro: string
    cta: string
    prices: string
    why: string
    unsubscribe: string
  }
> = {
  ru: {
    subject: 'Вы кое-что оставили в своём Vault',
    heading: 'Вы кое-что оставили в своём Vault…',
    intro: 'Ваша подборка сохранена в точности такой, какой вы её оставили, — она ждёт вас, когда будете готовы.',
    cta: 'Вернуться в Vault',
    prices: 'Цены — на сегодня; наличие подтверждается при оформлении.',
    why: 'Это единственное напоминание: вы указали этот адрес при оформлении заказа.',
    unsubscribe: 'Больше не напоминать',
  },
  en: {
    subject: 'You left something behind in your Vault',
    heading: 'You left something behind in your Vault…',
    intro: 'Your pieces are saved exactly as you left them, ready whenever you are.',
    cta: 'Return to your Vault',
    prices: "Prices shown are today's; availability is confirmed at checkout.",
    why: "This is a one-time reminder: you entered this address at checkout.",
    unsubscribe: "Don't remind me again",
  },
  it: {
    subject: 'Hai lasciato qualcosa nel tuo Vault',
    heading: 'Hai lasciato qualcosa nel tuo Vault…',
    intro: 'I tuoi capi sono salvati esattamente come li hai lasciati, pronti quando lo sei tu.',
    cta: 'Torna al tuo Vault',
    prices: 'Prezzi aggiornati a oggi; la disponibilità è confermata al checkout.',
    why: 'È un promemoria unico: hai inserito questo indirizzo al checkout.',
    unsubscribe: 'Non ricordarmelo più',
  },
  fr: {
    subject: 'Vous avez laissé quelque chose dans votre Vault',
    heading: 'Vous avez laissé quelque chose dans votre Vault…',
    intro: 'Vos pièces sont enregistrées telles que vous les avez laissées, prêtes quand vous le serez.',
    cta: 'Retourner à votre Vault',
    prices: 'Prix du jour ; la disponibilité est confirmée au paiement.',
    why: 'Ceci est un rappel unique : vous avez saisi cette adresse lors du paiement.',
    unsubscribe: 'Ne plus me le rappeler',
  },
  de: {
    subject: 'Sie haben etwas in Ihrem Vault vergessen',
    heading: 'Sie haben etwas in Ihrem Vault vergessen…',
    intro: 'Ihre Auswahl ist genau so gespeichert, wie Sie sie verlassen haben — bereit, wann immer Sie es sind.',
    cta: 'Zurück zu Ihrem Vault',
    prices: 'Preise von heute; die Verfügbarkeit wird an der Kasse bestätigt.',
    why: 'Dies ist eine einmalige Erinnerung: Sie haben diese Adresse an der Kasse eingegeben.',
    unsubscribe: 'Nicht mehr erinnern',
  },
}

/** Restores the cart in the browser and goes to checkout (app/cart/restore). */
export function restoreCartUrl(token: string): string {
  return `${getSiteUrl()}/cart/restore/${encodeURIComponent(token)}`
}

/** A confirmation page, not a GET that unsubscribes: link scanners follow GETs. */
function unsubscribePageUrl(token: string): string {
  return `${getSiteUrl()}/cart/unsubscribe/${encodeURIComponent(token)}`
}

/** RFC 8058 one-click target: mail clients POST to it. */
function oneClickUnsubscribeUrl(token: string): string {
  return `${getSiteUrl()}/api/abandoned-carts/unsubscribe?token=${encodeURIComponent(token)}`
}

export function abandonedCartEmail(
  input: { token: string; items: CartItem[] },
  lang: EmailLang,
): RenderedEmail {
  const c = copyFor(lang)
  const a = COPY[lang]
  const subtotal = Math.round(input.items.reduce((sum, i) => sum + i.price * i.qty, 0) * 100) / 100
  const restore = restoreCartUrl(input.token)

  const html = renderEmail({
    lang,
    subject: a.subject,
    preheader: a.intro,
    heading: a.heading,
    intro: a.intro,
    sections: [
      itemsSection({ items: input.items }, c),
      highlightSection(c.subtotal, esc(money(subtotal)), a.prices),
    ],
    cta: { label: a.cta, href: restore },
    footerNote: a.why,
    unsubscribe: { label: a.unsubscribe, href: unsubscribePageUrl(input.token) },
  })

  const text = textEmail([
    'LUXE VAULT',
    '',
    a.heading,
    a.intro,
    '',
    ...input.items.map((i) => `- ${i.name} (${i.size}, ${i.color}) x${i.qty}  ${money(i.price * i.qty)}`),
    '',
    `${c.subtotal}: ${money(subtotal)}`,
    a.prices,
    '',
    `${a.cta}: ${restore}`,
    '',
    a.why,
    `${a.unsubscribe}: ${unsubscribePageUrl(input.token)}`,
  ])

  return { subject: a.subject, html, text }
}

/** Sends the reminder. Never throws; false when it was not sent. */
export async function sendAbandonedCartEmail(
  cart: { email: string; token: string },
  items: CartItem[],
  lang: EmailLang,
): Promise<boolean> {
  if (!isMailConfigured) return false
  try {
    const message = abandonedCartEmail({ token: cart.token, items }, lang)
    const { ok } = await sendEmail({
      to: cart.email,
      replyTo: process.env.SUPPORT_INBOX_EMAIL ?? SUPPORT_EMAIL,
      ...message,
      headers: {
        'List-Unsubscribe': `<${oneClickUnsubscribeUrl(cart.token)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })
    return ok
  } catch (e) {
    console.warn('[emails] abandoned-cart reminder threw:', e)
    return false
  }
}
