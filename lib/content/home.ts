import type { StorefrontLocale } from '@/lib/types'

/**
 * The homepage's own copy. Each claim corresponds to something the shop
 * does: Stripe takes card payments (the card never reaches the shop), every
 * order ships with Swiss Post and its tracking number is emailed on dispatch,
 * prices are in CHF, a person answers support (target in lib/fulfilment.ts),
 * and the returns terms are those of the Refund Policy. {reply} and
 * {returnDays} are filled from lib/fulfilment.ts.
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
  whyEyebrow: string
  whyTitle: string
  why: [Item, Item, Item, Item]
  howEyebrow: string
  howTitle: string
  how: [Item, Item, Item, Item]
  faqEyebrow: string
  faqTitle: string
  faqAll: string
  finalTitle: string
  finalBody: string
  finalPrimary: string
  finalSecondary: string
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
    whyEyebrow: 'Why Luxe Vault',
    whyTitle: 'What you can expect from us',
    why: [
      { title: 'Clear product information', body: 'Every piece is labelled as a replica or designer-inspired item, with sizes, stock and the delivery estimate on its page.' },
      { title: 'No surprises at checkout', body: 'Shipping cost and delivery time are shown before you pay. Nothing is added afterwards.' },
      { title: '{returnDays} days to change your mind', body: 'Withdraw within {returnDays} days of delivery. A damaged or wrong item is replaced or refunded, postage included.' },
      { title: 'Direct support', body: 'Write to the people who handle your order, before or after you buy, by email or Telegram.' },
    ],
    howEyebrow: 'Ordering',
    howTitle: 'How ordering works',
    how: [
      { title: 'Choose your item', body: 'Pick a piece and your size. Each page shows what is in stock and when it should arrive.' },
      { title: 'Secure checkout', body: 'Pay by card through Stripe or another method offered at checkout. Your confirmation email arrives straight away.' },
      { title: 'Order processing', body: 'We order your piece from our supplier, check it, then hand it to Swiss Post in Switzerland.' },
      { title: 'Tracking', body: 'When your parcel leaves, we email you the tracking number so you can follow it to your door.' },
    ],
    faqEyebrow: 'Questions',
    faqTitle: 'Before you order',
    faqAll: 'All questions',
    finalTitle: 'Have a look around',
    finalBody: 'Every piece shows its price in CHF, its stock and its delivery estimate. If anything is unclear, ask us first.',
    finalPrimary: 'Shop the collection',
    finalSecondary: 'Contact us',
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
    whyEyebrow: 'Perché Luxe Vault',
    whyTitle: 'Cosa puoi aspettarti da noi',
    why: [
      { title: 'Informazioni chiare', body: 'Ogni articolo è indicato come replica o ispirato a un designer, con taglie, disponibilità e tempi di consegna nella sua pagina.' },
      { title: 'Nessuna sorpresa al checkout', body: 'Costi e tempi di spedizione sono visibili prima di pagare. Dopo non si aggiunge nulla.' },
      { title: '{returnDays} giorni per ripensarci', body: 'Recedi entro {returnDays} giorni dalla consegna. Un articolo danneggiato o sbagliato viene sostituito o rimborsato, spedizione compresa.' },
      { title: 'Assistenza diretta', body: 'Scrivi a chi gestisce il tuo ordine, prima o dopo l’acquisto, via email o Telegram.' },
    ],
    howEyebrow: 'Ordinare',
    howTitle: 'Come funziona l’ordine',
    how: [
      { title: 'Scegli l’articolo', body: 'Scegli un capo e la tua taglia. Ogni pagina mostra la disponibilità e quando dovrebbe arrivare.' },
      { title: 'Checkout sicuro', body: 'Paga con carta tramite Stripe o con un altro metodo offerto al checkout. L’email di conferma arriva subito.' },
      { title: 'Preparazione', body: 'Ordiniamo il capo al fornitore, lo controlliamo e lo affidiamo alla Posta Svizzera.' },
      { title: 'Tracciamento', body: 'Quando il pacco parte, ti inviamo via email il numero di tracciamento per seguirlo fino a casa.' },
    ],
    faqEyebrow: 'Domande',
    faqTitle: 'Prima di ordinare',
    faqAll: 'Tutte le domande',
    finalTitle: 'Dai un’occhiata',
    finalBody: 'Ogni articolo mostra il prezzo in CHF, la disponibilità e i tempi di consegna stimati. Se qualcosa non è chiaro, chiedici prima.',
    finalPrimary: 'Scopri la collezione',
    finalSecondary: 'Contattaci',
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
    whyEyebrow: 'Pourquoi Luxe Vault',
    whyTitle: 'Ce que vous pouvez attendre de nous',
    why: [
      { title: 'Des informations claires', body: 'Chaque pièce est présentée comme réplique ou inspirée d’un créateur, avec tailles, stock et délai de livraison sur sa page.' },
      { title: 'Pas de surprise au paiement', body: 'Frais et délai de livraison sont affichés avant de payer. Rien n’est ajouté ensuite.' },
      { title: '{returnDays} jours pour changer d’avis', body: 'Rétractez-vous dans les {returnDays} jours suivant la livraison. Un article endommagé ou erroné est remplacé ou remboursé, port compris.' },
      { title: 'Un contact direct', body: 'Écrivez aux personnes qui traitent votre commande, avant ou après l’achat, par e-mail ou Telegram.' },
    ],
    howEyebrow: 'Commander',
    howTitle: 'Comment se passe une commande',
    how: [
      { title: 'Choisissez votre pièce', body: 'Choisissez une pièce et votre taille. Chaque page indique le stock et la date d’arrivée prévue.' },
      { title: 'Paiement sécurisé', body: 'Payez par carte via Stripe ou avec un autre moyen proposé au paiement. L’e-mail de confirmation arrive aussitôt.' },
      { title: 'Préparation', body: 'Nous commandons votre pièce auprès du fournisseur, la contrôlons, puis la confions à La Poste suisse.' },
      { title: 'Suivi', body: 'Au départ du colis, nous vous envoyons le numéro de suivi par e-mail pour le suivre jusqu’à chez vous.' },
    ],
    faqEyebrow: 'Questions',
    faqTitle: 'Avant de commander',
    faqAll: 'Toutes les questions',
    finalTitle: 'Faites un tour',
    finalBody: 'Chaque pièce affiche son prix en CHF, son stock et son délai de livraison estimé. Si quelque chose n’est pas clair, demandez-nous d’abord.',
    finalPrimary: 'Voir la collection',
    finalSecondary: 'Nous contacter',
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
    whyEyebrow: 'Warum Luxe Vault',
    whyTitle: 'Was Sie von uns erwarten können',
    why: [
      { title: 'Klare Produktangaben', body: 'Jedes Stück ist als Replikat oder Designer-inspiriert gekennzeichnet, mit Grössen, Bestand und Lieferzeit auf seiner Seite.' },
      { title: 'Keine Überraschungen an der Kasse', body: 'Versandkosten und Lieferzeit sehen Sie vor dem Bezahlen. Danach kommt nichts hinzu.' },
      { title: '{returnDays} Tage Bedenkzeit', body: 'Treten Sie innerhalb von {returnDays} Tagen nach Lieferung zurück. Ein beschädigter oder falscher Artikel wird ersetzt oder erstattet, inklusive Porto.' },
      { title: 'Direkter Kontakt', body: 'Schreiben Sie den Menschen, die Ihre Bestellung bearbeiten – vor oder nach dem Kauf, per E-Mail oder Telegram.' },
    ],
    howEyebrow: 'Bestellen',
    howTitle: 'So funktioniert die Bestellung',
    how: [
      { title: 'Artikel wählen', body: 'Wählen Sie ein Stück und Ihre Grösse. Jede Seite zeigt den Bestand und wann es ankommen sollte.' },
      { title: 'Sicher bezahlen', body: 'Bezahlen Sie per Karte über Stripe oder mit einer anderen an der Kasse angebotenen Methode. Die Bestätigung kommt sofort per E-Mail.' },
      { title: 'Bearbeitung', body: 'Wir bestellen Ihr Stück beim Lieferanten, prüfen es und übergeben es der Schweizerischen Post.' },
      { title: 'Sendungsverfolgung', body: 'Sobald Ihr Paket unterwegs ist, senden wir Ihnen die Sendungsnummer, damit Sie es bis zur Haustür verfolgen können.' },
    ],
    faqEyebrow: 'Fragen',
    faqTitle: 'Vor der Bestellung',
    faqAll: 'Alle Fragen',
    finalTitle: 'Schauen Sie sich um',
    finalBody: 'Jedes Stück zeigt seinen Preis in CHF, den Bestand und die geschätzte Lieferzeit. Ist etwas unklar, fragen Sie uns vorher.',
    finalPrimary: 'Zur Kollektion',
    finalSecondary: 'Kontakt',
  },
}

/** The FAQ entries the homepage shows, by id (lib/support/faq.ts). */
export const HOME_FAQ_IDS = ['authentic', 'time', 'ship-from', 'methods', 'return-window', 'lost'] as const
