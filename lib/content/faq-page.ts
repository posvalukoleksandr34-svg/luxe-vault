import type { SupportTopic } from '@/lib/support/copy'
import type { StorefrontLocale } from '@/lib/types'

/** The FAQ page's own copy; the questions and answers are lib/support/faq.ts. */
export type FaqPageCopy = {
  title: string
  description: string
  eyebrow: string
  lead: string
  groups: Record<SupportTopic, string>
  stillTitle: string
  stillBody: string
  contactCta: string
  helpCta: string
}

/** The order the topics appear in on the page. */
export const FAQ_PAGE_TOPICS: SupportTopic[] = ['where', 'shipping', 'payment', 'returns', 'product', 'sizes', 'account']

export const FAQ_PAGE: Record<StorefrontLocale, FaqPageCopy> = {
  en: {
    title: 'Frequently asked questions',
    description: 'Answers about orders, shipping, payment, returns and our products at Luxe Vault.',
    eyebrow: 'Customer care',
    lead: 'Short, straight answers. The figures — delivery times, shipping costs — are the ones the shop currently uses.',
    groups: { where: 'Orders & tracking', shipping: 'Shipping', payment: 'Payment', returns: 'Returns & refunds', product: 'Products', sizes: 'Sizes', account: 'Account & contact' },
    stillTitle: 'Still have a question?',
    stillBody: 'Write to us. A person reads every message and usually replies within {reply}.',
    contactCta: 'Contact us',
    helpCta: 'Open the help centre',
  },
  it: {
    title: 'Domande frequenti',
    description: 'Risposte su ordini, spedizione, pagamento, resi e prodotti di Luxe Vault.',
    eyebrow: 'Assistenza',
    lead: 'Risposte brevi e chiare. Le cifre — tempi di consegna, costi di spedizione — sono quelle in vigore nel negozio.',
    groups: { where: 'Ordini e tracciamento', shipping: 'Spedizione', payment: 'Pagamento', returns: 'Resi e rimborsi', product: 'Prodotti', sizes: 'Taglie', account: 'Account e contatti' },
    stillTitle: 'Hai ancora una domanda?',
    stillBody: 'Scrivici. Ogni messaggio è letto da una persona; di solito rispondiamo entro {reply}.',
    contactCta: 'Contattaci',
    helpCta: 'Apri il centro assistenza',
  },
  fr: {
    title: 'Questions fréquentes',
    description: 'Réponses sur les commandes, la livraison, le paiement, les retours et nos produits chez Luxe Vault.',
    eyebrow: 'Service client',
    lead: 'Des réponses courtes et directes. Les chiffres — délais, frais de port — sont ceux que la boutique applique actuellement.',
    groups: { where: 'Commandes et suivi', shipping: 'Livraison', payment: 'Paiement', returns: 'Retours et remboursements', product: 'Produits', sizes: 'Tailles', account: 'Compte et contact' },
    stillTitle: 'Une autre question ?',
    stillBody: 'Écrivez-nous. Chaque message est lu par une personne ; nous répondons en général sous {reply}.',
    contactCta: 'Nous contacter',
    helpCta: 'Ouvrir le centre d’aide',
  },
  de: {
    title: 'Häufige Fragen',
    description: 'Antworten zu Bestellungen, Versand, Zahlung, Rückgabe und unseren Produkten bei Luxe Vault.',
    eyebrow: 'Kundenservice',
    lead: 'Kurze, klare Antworten. Die Zahlen – Lieferzeiten, Versandkosten – sind die, die der Shop aktuell verwendet.',
    groups: { where: 'Bestellung & Sendungsverfolgung', shipping: 'Versand', payment: 'Zahlung', returns: 'Rückgabe & Erstattung', product: 'Produkte', sizes: 'Grössen', account: 'Konto & Kontakt' },
    stillTitle: 'Noch eine Frage?',
    stillBody: 'Schreiben Sie uns. Jede Nachricht liest ein Mensch; wir antworten meist innerhalb von {reply}.',
    contactCta: 'Kontakt',
    helpCta: 'Zum Hilfe-Center',
  },
}
