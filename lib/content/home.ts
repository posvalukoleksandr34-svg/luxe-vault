import type { StorefrontLocale } from '@/lib/types'

/**
 * The homepage's own copy: the hero line and buttons, the four facts under
 * the hero, and the product row's heading. Each fact corresponds to something
 * the shop does: Stripe takes card payments (the card never reaches the
 * shop), every order ships with Swiss Post and its tracking number is emailed
 * on dispatch, prices are in CHF, and a person answers support (target in
 * lib/fulfilment.ts, filled in as {reply}).
 */
type Item = { title: string; body: string }

export type HomeCopy = {
  heroEyebrow: string
  heroLine: string
  heroPrimary: string
  heroSecondary: string
  trustLabel: string
  trust: [Item, Item, Item, Item]
  featuredEyebrow: string
  featuredTitle: string
  featuredAll: string
}

export const HOME: Record<StorefrontLocale, HomeCopy> = {
  en: {
    heroEyebrow: 'Based in Switzerland',
    heroLine: 'Designer-inspired clothing, shoes and accessories, clearly labelled as replicas and shipped from Switzerland.',
    heroPrimary: 'Shop the collection',
    heroSecondary: 'About Luxe Vault',
    trustLabel: 'Why you can order with confidence',
    trust: [
      { title: 'Secure payment', body: 'Cards are processed by Stripe. Your card details never reach us.' },
      { title: 'Tracked delivery', body: 'Shipped with Swiss Post. Tracking number by email on dispatch.' },
      { title: 'Based in Switzerland', body: 'Operated and shipped from Switzerland. Prices in Swiss francs.' },
      { title: 'Human support', body: 'A person answers every message, usually within {reply}.' },
    ],
    featuredEyebrow: 'From the collection',
    featuredTitle: 'Selected pieces',
    featuredAll: 'View all',
  },
  it: {
    heroEyebrow: 'Con sede in Svizzera',
    heroLine: 'Abbigliamento, scarpe e accessori ispirati a modelli di designer, dichiarati come repliche e spediti dalla Svizzera.',
    heroPrimary: 'Scopri la collezione',
    heroSecondary: 'Chi siamo',
    trustLabel: 'Perché puoi ordinare con fiducia',
    trust: [
      { title: 'Pagamento sicuro', body: 'Le carte sono elaborate da Stripe. I dati della carta non arrivano mai a noi.' },
      { title: 'Consegna tracciata', body: 'Spedito con la Posta Svizzera. Numero di tracciamento via email alla partenza.' },
      { title: 'Con sede in Svizzera', body: 'Gestito e spedito dalla Svizzera. Prezzi in franchi svizzeri.' },
      { title: 'Assistenza umana', body: 'Ogni messaggio riceve risposta da una persona, di solito entro {reply}.' },
    ],
    featuredEyebrow: 'Dalla collezione',
    featuredTitle: 'Una selezione',
    featuredAll: 'Vedi tutto',
  },
  fr: {
    heroEyebrow: 'Basé en Suisse',
    heroLine: 'Vêtements, chaussures et accessoires inspirés de créateurs, clairement présentés comme des répliques et expédiés depuis la Suisse.',
    heroPrimary: 'Voir la collection',
    heroSecondary: 'À propos de Luxe Vault',
    trustLabel: 'Pourquoi commander en confiance',
    trust: [
      { title: 'Paiement sécurisé', body: 'Les cartes sont traitées par Stripe. Vos données de carte ne nous parviennent jamais.' },
      { title: 'Livraison suivie', body: 'Expédié avec La Poste suisse. Numéro de suivi par e-mail à l’envoi.' },
      { title: 'Basé en Suisse', body: 'Géré et expédié depuis la Suisse. Prix en francs suisses.' },
      { title: 'Un vrai service client', body: 'Une personne répond à chaque message, en général sous {reply}.' },
    ],
    featuredEyebrow: 'Dans la collection',
    featuredTitle: 'Une sélection',
    featuredAll: 'Tout voir',
  },
  de: {
    heroEyebrow: 'Mit Sitz in der Schweiz',
    heroLine: 'Von Designern inspirierte Kleidung, Schuhe und Accessoires – klar als Replikate gekennzeichnet und aus der Schweiz versandt.',
    heroPrimary: 'Zur Kollektion',
    heroSecondary: 'Über Luxe Vault',
    trustLabel: 'Warum Sie mit gutem Gefühl bestellen können',
    trust: [
      { title: 'Sichere Zahlung', body: 'Karten werden von Stripe verarbeitet. Ihre Kartendaten erreichen uns nie.' },
      { title: 'Verfolgbare Lieferung', body: 'Versand mit der Schweizerischen Post. Sendungsnummer per E-Mail beim Versand.' },
      { title: 'Sitz in der Schweiz', body: 'Betrieben und versandt aus der Schweiz. Preise in Schweizer Franken.' },
      { title: 'Persönlicher Support', body: 'Jede Nachricht beantwortet ein Mensch, meist innerhalb von {reply}.' },
    ],
    featuredEyebrow: 'Aus der Kollektion',
    featuredTitle: 'Eine Auswahl',
    featuredAll: 'Alle ansehen',
  },
}

