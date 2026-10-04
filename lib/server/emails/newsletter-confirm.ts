import 'server-only'

import { getSiteUrl } from '@/lib/site-url'
import { paragraphSection, renderEmail } from './layout'

/**
 * The newsletter's confirmation email (double opt-in, migration 0051): one
 * button that lands on /newsletter/confirm, where the subscription is
 * confirmed by a click on the page — not by opening the link, which the link
 * scanners of corporate mail servers do on their own.
 */

type Lang = 'ru' | 'en' | 'it' | 'fr' | 'de'

const COPY: Record<Lang, { subject: string; heading: string; intro: string; button: string; ignore: string }> = {
  ru: {
    subject: 'Подтвердите подписку на рассылку — Luxe Vault',
    heading: 'Подтвердите подписку',
    intro: 'Кто-то — надеемся, вы — подписал этот адрес на рассылку Luxe Vault — новинки и предложения. Подписка начнёт действовать, только когда вы её подтвердите.',
    button: 'Подтвердить подписку',
    ignore: 'Если вы не подписывались, просто проигнорируйте это письмо: адрес не будет добавлен в рассылку, а запрос удалится через 30 дней.',
  },
  en: {
    subject: 'Confirm your newsletter subscription — Luxe Vault',
    heading: 'Confirm your subscription',
    intro: 'Someone — we hope you — signed this address up for the Luxe Vault newsletter — new arrivals and offers. Nothing will be sent until you confirm.',
    button: 'Confirm subscription',
    ignore: 'If this was not you, ignore this email: the address will not be added, and the request is deleted after 30 days.',
  },
  it: {
    subject: 'Conferma l’iscrizione alla newsletter — Luxe Vault',
    heading: 'Conferma l’iscrizione',
    intro: 'Qualcuno — speriamo tu — ha iscritto questo indirizzo alla newsletter di Luxe Vault — novità e offerte. Non riceverai nulla finché non confermi.',
    button: 'Conferma iscrizione',
    ignore: 'Se non sei stato tu, ignora questa email: l’indirizzo non verrà aggiunto e la richiesta sarà eliminata dopo 30 giorni.',
  },
  fr: {
    subject: 'Confirmez votre inscription à la newsletter — Luxe Vault',
    heading: 'Confirmez votre inscription',
    intro: 'Quelqu’un — vous, nous l’espérons — a inscrit cette adresse à la newsletter Luxe Vault — nouveautés et offres. Rien ne sera envoyé tant que vous n’aurez pas confirmé.',
    button: 'Confirmer l’inscription',
    ignore: 'Si ce n’était pas vous, ignorez cet e-mail : l’adresse ne sera pas ajoutée et la demande sera supprimée après 30 jours.',
  },
  de: {
    subject: 'Bitte bestätigen Sie Ihr Newsletter-Abo — Luxe Vault',
    heading: 'Abo bestätigen',
    intro: 'Jemand — hoffentlich Sie — hat diese Adresse für den Newsletter von Luxe Vault angemeldet — Neuheiten und Angebote. Sie erhalten nichts, bevor Sie bestätigen.',
    button: 'Abo bestätigen',
    ignore: 'Falls Sie das nicht waren, ignorieren Sie diese E-Mail: Die Adresse wird nicht eingetragen, und die Anfrage wird nach 30 Tagen gelöscht.',
  },
}

function langOf(raw: string): Lang {
  return (['ru', 'en', 'it', 'fr', 'de'] as const).includes(raw as Lang) ? (raw as Lang) : 'en'
}

export function newsletterConfirmEmail(token: string, locale: string): { subject: string; html: string; text: string } {
  const lang = langOf(locale)
  const c = COPY[lang]
  const href = `${getSiteUrl()}/newsletter/confirm?token=${encodeURIComponent(token)}`
  const html = renderEmail({
    lang,
    subject: c.subject,
    preheader: c.heading,
    heading: c.heading,
    intro: c.intro,
    cta: { label: c.button, href },
    sections: [paragraphSection(c.ignore, true)],
  })
  const text = [c.heading, '', c.intro, '', `${c.button}: ${href}`, '', c.ignore].join('\n')
  return { subject: c.subject, html, text }
}
