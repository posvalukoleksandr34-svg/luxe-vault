import 'server-only'

import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import type { SupportTicket } from '@/lib/types'
import type { EmailLang } from './copy'
import { copyFor, metaSection, quoteSection, renderEmail, textEmail, type RenderedEmail } from './layout'

/**
 * The customer's support emails: "we received your request" and "you have a
 * reply". Dark Luxury layout, the customer's language, and a link straight to
 * the conversation — replies belong in the thread, where the attachments and
 * the history are, so the email asks for them there.
 */

const COPY: Record<
  EmailLang,
  {
    number: string
    subjectLabel: string
    received: { subject: (n: string) => string; heading: string; intro: (span: string) => string }
    reply: { subject: (n: string) => string; heading: string; intro: (subject: string) => string }
    view: string
    viewReply: string
    replyThere: string
  }
> = {
  ru: {
    number: 'Номер обращения',
    subjectLabel: 'Тема',
    received: {
      subject: (n) => `Обращение ${n} получено — Luxe Vault`,
      heading: 'Мы получили ваше обращение',
      intro: (span) => `Спасибо — сообщение уже у нашей команды. Обычно мы отвечаем в течение ${span} и сразу пришлём письмо, когда ответим.`,
    },
    reply: {
      subject: (n) => `Новый ответ по обращению ${n}`,
      heading: 'Вам ответила поддержка Luxe Vault',
      intro: (s) => `Мы ответили на ваше обращение «${s}».`,
    },
    view: 'Открыть обращение',
    viewReply: 'Прочитать и ответить',
    replyThere: 'Отвечайте по ссылке — так вся переписка и вложения останутся в одном месте.',
  },
  en: {
    number: 'Request number',
    subjectLabel: 'Subject',
    received: {
      subject: (n) => `Request ${n} received — Luxe Vault`,
      heading: 'We have received your request',
      intro: (span) => `Thank you — your message is with our team. We usually reply within ${span}, and we will email you as soon as we do.`,
    },
    reply: {
      subject: (n) => `New reply to your request ${n}`,
      heading: 'Luxe Vault support has replied',
      intro: (s) => `We have replied to your request “${s}”.`,
    },
    view: 'View your request',
    viewReply: 'Read and reply',
    replyThere: 'Please reply through the link, so the whole conversation and its attachments stay in one place.',
  },
  it: {
    number: 'Numero della richiesta',
    subjectLabel: 'Oggetto',
    received: {
      subject: (n) => `Richiesta ${n} ricevuta — Luxe Vault`,
      heading: 'Abbiamo ricevuto la tua richiesta',
      intro: (span) => `Grazie — il tuo messaggio è arrivato al nostro team. Di solito rispondiamo entro ${span} e ti scriveremo appena lo faremo.`,
    },
    reply: {
      subject: (n) => `Nuova risposta alla richiesta ${n}`,
      heading: 'Il supporto Luxe Vault ti ha risposto',
      intro: (s) => `Abbiamo risposto alla tua richiesta «${s}».`,
    },
    view: 'Apri la richiesta',
    viewReply: 'Leggi e rispondi',
    replyThere: 'Rispondi dal link, così conversazione e allegati restano in un unico posto.',
  },
  fr: {
    number: 'Numéro de la demande',
    subjectLabel: 'Objet',
    received: {
      subject: (n) => `Demande ${n} reçue — Luxe Vault`,
      heading: 'Nous avons bien reçu votre demande',
      intro: (span) => `Merci — votre message est entre les mains de notre équipe. Nous répondons généralement sous ${span} et vous écrirons dès que ce sera fait.`,
    },
    reply: {
      subject: (n) => `Nouvelle réponse à votre demande ${n}`,
      heading: 'Le service client Luxe Vault vous a répondu',
      intro: (s) => `Nous avons répondu à votre demande « ${s} ».`,
    },
    view: 'Voir la demande',
    viewReply: 'Lire et répondre',
    replyThere: 'Répondez via le lien : toute la conversation et les pièces jointes restent au même endroit.',
  },
  de: {
    number: 'Anfragenummer',
    subjectLabel: 'Betreff',
    received: {
      subject: (n) => `Anfrage ${n} erhalten — Luxe Vault`,
      heading: 'Wir haben Ihre Anfrage erhalten',
      intro: (span) => `Danke — Ihre Nachricht liegt bei unserem Team. Wir antworten in der Regel innerhalb von ${span} und schreiben Ihnen, sobald wir geantwortet haben.`,
    },
    reply: {
      subject: (n) => `Neue Antwort auf Ihre Anfrage ${n}`,
      heading: 'Der Luxe Vault Support hat geantwortet',
      intro: (s) => `Wir haben auf Ihre Anfrage „${s}“ geantwortet.`,
    },
    view: 'Anfrage öffnen',
    viewReply: 'Lesen und antworten',
    replyThere: 'Bitte antworten Sie über den Link, damit Verlauf und Anhänge an einem Ort bleiben.',
  },
}

export function ticketReceivedEmail(ticket: SupportTicket, link: string, lang: EmailLang): RenderedEmail {
  const a = COPY[lang]
  const span = describeBusinessDays(FULFILMENT.supportReply, lang)
  const subject = a.received.subject(ticket.number)
  const html = renderEmail({
    lang,
    subject,
    preheader: `${ticket.number} · ${ticket.subject}`,
    heading: a.received.heading,
    intro: a.received.intro(span),
    sections: [metaSection([[a.number, ticket.number], [a.subjectLabel, ticket.subject]])],
    cta: { label: a.view, href: link },
    footerNote: a.replyThere,
  })
  const text = textEmail([
    'LUXE VAULT',
    '',
    a.received.heading,
    a.received.intro(span),
    '',
    `${a.number}: ${ticket.number}`,
    `${a.subjectLabel}: ${ticket.subject}`,
    '',
    `${a.view}: ${link}`,
  ])
  return { subject, html, text }
}

export function supportReplyEmail(ticket: SupportTicket, reply: string, link: string, lang: EmailLang): RenderedEmail {
  const a = COPY[lang]
  const c = copyFor(lang)
  const subject = a.reply.subject(ticket.number)
  const html = renderEmail({
    lang,
    subject,
    preheader: reply.slice(0, 120),
    heading: a.reply.heading,
    intro: a.reply.intro(ticket.subject),
    sections: [quoteSection(reply), metaSection([[a.number, ticket.number]])],
    cta: { label: a.viewReply, href: link },
    footerNote: a.replyThere,
  })
  const text = textEmail([
    'LUXE VAULT',
    '',
    a.reply.heading,
    a.reply.intro(ticket.subject),
    '',
    reply,
    '',
    `${a.number}: ${ticket.number}`,
    `${a.viewReply}: ${link}`,
    '',
    c.help,
  ])
  return { subject, html, text }
}
