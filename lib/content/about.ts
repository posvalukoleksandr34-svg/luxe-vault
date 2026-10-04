import type { StorefrontLocale } from '@/lib/types'

/**
 * The About page. Every statement here is something the shop actually does —
 * checked against the code (payments, carrier, returns, support) or stated in
 * its own policies. Where a fact belongs to the owner (their name), the page
 * reads it from config/business.ts and leaves it out when it is not set.
 */
export type AboutCopy = {
  title: string
  description: string
  eyebrow: string
  lead: string
  whoTitle: string
  /** With the seller's name configured. */
  whoNamed: string
  whoAnonymous: string
  sections: { h: string; body: string[] }[]
  contactTitle: string
  contactBody: string
  contactCta: string
  shopCta: string
}

export const ABOUT: Record<StorefrontLocale, AboutCopy> = {
  en: {
    title: 'About Luxe Vault',
    description: 'Who runs Luxe Vault, what we sell, how orders are handled and how to reach us.',
    eyebrow: 'About',
    lead: 'Luxe Vault is a small online shop in Switzerland selling designer-inspired clothing, shoes and accessories. We say clearly what our pieces are, what they cost and how long they take to reach you.',
    whoTitle: 'Who runs Luxe Vault',
    whoNamed: 'Luxe Vault is run by {name} from Switzerland. Orders, packing and customer messages are handled personally, not by an agency or a marketplace.',
    whoAnonymous: 'Luxe Vault is run by a private seller in Switzerland. Orders, packing and customer messages are handled personally, not by an agency or a marketplace. The seller’s details are in the Imprint.',
    sections: [
      {
        h: 'What we sell',
        body: [
          'Replicas and designer-inspired pieces: clothing, shoes and accessories. They are not authentic branded goods. They are not made, sold or authorised by the brands they reference, and we are not affiliated with any brand owner.',
          'Every product page says this, so you know exactly what you are buying before you pay.',
        ],
      },
      {
        h: 'How pieces are chosen',
        body: [
          'We list a piece only when we can describe it properly: photos, sizes with measurements where we have them, materials and specifications when they are known, and stock per size. If something is not available in your size, the page says so.',
        ],
      },
      {
        h: 'How your order is handled',
        body: [
          'Payment is taken when you order: by card through Stripe or, when it is offered at checkout, in cryptocurrency through NOWPayments. Your order is confirmed by email straight away.',
          'Pieces are ordered from our suppliers for your order and checked before dispatch. Your parcel then ships from Switzerland with Swiss Post, and we email you the tracking number when it leaves.',
          'Every product page and the checkout show the estimated delivery time before you pay.',
        ],
      },
      {
        h: 'If something goes wrong',
        body: [
          'You can withdraw from a purchase within 14 days of receiving it. If an item arrives damaged, faulty or not as ordered, we replace it or refund it in full, including postage. The details are in our Returns & Refunds policy.',
        ],
      },
    ],
    contactTitle: 'Talk to us',
    contactBody: 'Questions before or after you buy go to a person. Email is the most reliable way to reach us; we usually reply within {span}.',
    contactCta: 'Contact us',
    shopCta: 'Shop the collection',
  },
  it: {
    title: 'Chi siamo',
    description: 'Chi gestisce Luxe Vault, cosa vendiamo, come gestiamo gli ordini e come contattarci.',
    eyebrow: 'Chi siamo',
    lead: 'Luxe Vault è un piccolo negozio online in Svizzera che vende abbigliamento, scarpe e accessori ispirati a modelli di designer. Diciamo chiaramente cosa sono i nostri articoli, quanto costano e quanto tempo impiegano ad arrivare.',
    whoTitle: 'Chi gestisce Luxe Vault',
    whoNamed: 'Luxe Vault è gestito da {name} dalla Svizzera. Ordini, imballaggio e messaggi dei clienti sono seguiti personalmente, non da un’agenzia o da un marketplace.',
    whoAnonymous: 'Luxe Vault è gestito da un venditore privato in Svizzera. Ordini, imballaggio e messaggi dei clienti sono seguiti personalmente, non da un’agenzia o da un marketplace. I dati del venditore sono nelle Note legali.',
    sections: [
      {
        h: 'Cosa vendiamo',
        body: [
          'Repliche e articoli ispirati a modelli di designer: abbigliamento, scarpe e accessori. Non sono prodotti di marca originali. Non sono prodotti, venduti né autorizzati dai marchi a cui si ispirano, e non siamo affiliati ad alcun titolare di marchio.',
          'Ogni pagina prodotto lo dice, così sai esattamente cosa acquisti prima di pagare.',
        ],
      },
      {
        h: 'Come scegliamo gli articoli',
        body: [
          'Mettiamo in vendita un articolo solo se possiamo descriverlo bene: foto, taglie con le misure quando le abbiamo, materiali e caratteristiche quando sono noti, e disponibilità per taglia. Se un articolo non c’è nella tua taglia, la pagina lo indica.',
        ],
      },
      {
        h: 'Come gestiamo il tuo ordine',
        body: [
          'Il pagamento avviene al momento dell’ordine: con carta tramite Stripe oppure, quando è disponibile al checkout, in criptovaluta tramite NOWPayments. Ricevi subito una conferma via email.',
          'Gli articoli vengono ordinati ai nostri fornitori per il tuo ordine e controllati prima della spedizione. Il pacco parte poi dalla Svizzera con la Posta Svizzera e ti inviamo via email il numero di tracciamento alla partenza.',
          'Ogni pagina prodotto e il checkout mostrano i tempi di consegna stimati prima del pagamento.',
        ],
      },
      {
        h: 'Se qualcosa va storto',
        body: [
          'Puoi recedere da un acquisto entro 14 giorni dal ricevimento. Se un articolo arriva danneggiato, difettoso o diverso da quanto ordinato, lo sostituiamo o lo rimborsiamo per intero, spedizione compresa. I dettagli sono nella Politica di reso.',
        ],
      },
    ],
    contactTitle: 'Scrivici',
    contactBody: 'Prima o dopo l’acquisto ti risponde una persona. L’email è il modo più affidabile per raggiungerci; di solito rispondiamo entro {span}.',
    contactCta: 'Contattaci',
    shopCta: 'Scopri la collezione',
  },
  fr: {
    title: 'À propos de Luxe Vault',
    description: 'Qui gère Luxe Vault, ce que nous vendons, comment les commandes sont traitées et comment nous joindre.',
    eyebrow: 'À propos',
    lead: 'Luxe Vault est une petite boutique en ligne en Suisse qui vend des vêtements, chaussures et accessoires inspirés de créateurs. Nous disons clairement ce que sont nos pièces, ce qu’elles coûtent et combien de temps elles mettent à arriver.',
    whoTitle: 'Qui gère Luxe Vault',
    whoNamed: 'Luxe Vault est géré par {name} depuis la Suisse. Les commandes, l’emballage et les messages des clients sont traités personnellement, pas par une agence ni une place de marché.',
    whoAnonymous: 'Luxe Vault est géré par un vendeur particulier en Suisse. Les commandes, l’emballage et les messages des clients sont traités personnellement, pas par une agence ni une place de marché. Les coordonnées du vendeur figurent dans les Mentions légales.',
    sections: [
      {
        h: 'Ce que nous vendons',
        body: [
          'Des répliques et des pièces inspirées de créateurs : vêtements, chaussures et accessoires. Ce ne sont pas des articles de marque authentiques. Ils ne sont ni fabriqués, ni vendus, ni autorisés par les marques auxquelles ils font référence, et nous ne sommes affiliés à aucun titulaire de marque.',
          'Chaque fiche produit l’indique, pour que vous sachiez exactement ce que vous achetez avant de payer.',
        ],
      },
      {
        h: 'Comment nous choisissons les pièces',
        body: [
          'Nous ne proposons une pièce que si nous pouvons bien la décrire : photos, tailles avec mesures quand nous les avons, matières et caractéristiques quand elles sont connues, et stock par taille. Si une pièce n’existe pas dans votre taille, la page le dit.',
        ],
      },
      {
        h: 'Comment votre commande est traitée',
        body: [
          'Le paiement est effectué à la commande : par carte via Stripe ou, lorsque c’est proposé au paiement, en cryptomonnaie via NOWPayments. Vous recevez aussitôt une confirmation par e-mail.',
          'Les pièces sont commandées auprès de nos fournisseurs pour votre commande et contrôlées avant l’envoi. Votre colis part ensuite de Suisse avec La Poste suisse, et nous vous envoyons le numéro de suivi par e-mail à son départ.',
          'Chaque fiche produit et la page de paiement indiquent le délai de livraison estimé avant que vous payiez.',
        ],
      },
      {
        h: 'En cas de problème',
        body: [
          'Vous pouvez vous rétracter dans les 14 jours suivant la réception. Si un article arrive endommagé, défectueux ou non conforme, nous le remplaçons ou le remboursons intégralement, frais de port compris. Les détails figurent dans notre Politique de retour.',
        ],
      },
    ],
    contactTitle: 'Nous écrire',
    contactBody: 'Avant ou après l’achat, c’est une personne qui vous répond. L’e-mail est le moyen le plus fiable de nous joindre ; nous répondons en général sous {span}.',
    contactCta: 'Nous contacter',
    shopCta: 'Voir la collection',
  },
  de: {
    title: 'Über Luxe Vault',
    description: 'Wer Luxe Vault betreibt, was wir verkaufen, wie Bestellungen ablaufen und wie Sie uns erreichen.',
    eyebrow: 'Über uns',
    lead: 'Luxe Vault ist ein kleiner Onlineshop in der Schweiz für von Designern inspirierte Kleidung, Schuhe und Accessoires. Wir sagen klar, was unsere Stücke sind, was sie kosten und wie lange sie zu Ihnen unterwegs sind.',
    whoTitle: 'Wer Luxe Vault betreibt',
    whoNamed: 'Luxe Vault wird von {name} aus der Schweiz betrieben. Bestellungen, Verpackung und Kundennachrichten werden persönlich bearbeitet, nicht von einer Agentur oder einem Marktplatz.',
    whoAnonymous: 'Luxe Vault wird von einer Privatperson in der Schweiz betrieben. Bestellungen, Verpackung und Kundennachrichten werden persönlich bearbeitet, nicht von einer Agentur oder einem Marktplatz. Die Angaben zum Verkäufer stehen im Impressum.',
    sections: [
      {
        h: 'Was wir verkaufen',
        body: [
          'Replikate und von Designern inspirierte Stücke: Kleidung, Schuhe und Accessoires. Es sind keine echten Markenartikel. Sie werden von den Marken, auf die sie sich beziehen, weder hergestellt noch verkauft oder autorisiert, und wir sind mit keinem Markeninhaber verbunden.',
          'Das steht auf jeder Produktseite – Sie wissen also genau, was Sie kaufen, bevor Sie bezahlen.',
        ],
      },
      {
        h: 'Wie wir Stücke auswählen',
        body: [
          'Wir bieten ein Stück nur an, wenn wir es richtig beschreiben können: Fotos, Grössen mit Massen, soweit vorhanden, Materialien und Eigenschaften, soweit bekannt, und den Bestand je Grösse. Gibt es ein Stück nicht in Ihrer Grösse, steht das auf der Seite.',
        ],
      },
      {
        h: 'So wird Ihre Bestellung bearbeitet',
        body: [
          'Bezahlt wird bei der Bestellung: per Karte über Stripe oder, wenn an der Kasse angeboten, in Kryptowährung über NOWPayments. Die Bestätigung kommt sofort per E-Mail.',
          'Die Stücke werden für Ihre Bestellung bei unseren Lieferanten bestellt und vor dem Versand geprüft. Ihr Paket geht dann aus der Schweiz mit der Schweizerischen Post auf den Weg, und wir senden Ihnen die Sendungsnummer per E-Mail, sobald es unterwegs ist.',
          'Jede Produktseite und die Kasse zeigen die geschätzte Lieferzeit, bevor Sie bezahlen.',
        ],
      },
      {
        h: 'Wenn etwas schiefgeht',
        body: [
          'Sie können innerhalb von 14 Tagen nach Erhalt vom Kauf zurücktreten. Kommt ein Artikel beschädigt, fehlerhaft oder nicht wie bestellt an, ersetzen wir ihn oder erstatten den vollen Betrag inklusive Porto. Die Einzelheiten stehen in unserer Rückgabe- und Erstattungsrichtlinie.',
        ],
      },
    ],
    contactTitle: 'Schreiben Sie uns',
    contactBody: 'Vor und nach dem Kauf antwortet Ihnen ein Mensch. Am zuverlässigsten erreichen Sie uns per E-Mail; wir antworten in der Regel innerhalb von {span}.',
    contactCta: 'Kontakt',
    shopCta: 'Zur Kollektion',
  },
}
