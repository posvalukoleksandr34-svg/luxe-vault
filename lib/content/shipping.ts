import type { StorefrontLocale } from '@/lib/types'

/**
 * The Shipping page. Figures are never typed in: {span} is the admin's
 * store-wide delivery estimate, {price} and {amount} the shipping fee and the
 * free-shipping threshold (store_settings), {reply} the support reply target
 * (lib/fulfilment.ts) — so this page cannot quote a number the checkout does
 * not charge.
 */
export type ShippingCopy = {
  title: string
  description: string
  eyebrow: string
  lead: string
  facts: {
    origin: [string, string]
    carrier: [string, string]
    time: [string, string]
    cost: [string, string]
  }
  sections: { id: string; h: string; body: string[] }[]
  questions: string
  contactCta: string
  faqCta: string
}

export const SHIPPING: Record<StorefrontLocale, ShippingCopy> = {
  en: {
    title: 'Shipping',
    description: 'Where Luxe Vault ships from, delivery times, shipping costs, tracking and customs.',
    eyebrow: 'Customer care',
    lead: 'Everything about getting your order to you, with the same figures the checkout uses.',
    facts: {
      origin: ['Ships from', 'Switzerland'],
      carrier: ['Carrier', 'Swiss Post, tracked'],
      time: ['Estimated delivery', '{span}'],
      cost: ['Shipping', '{price} · free from {amount}'],
    },
    sections: [
      {
        id: 'time',
        h: 'Delivery time',
        body: [
          'The estimated delivery time is {span} from your order, depending on the destination. It covers ordering the piece from our supplier, checking it before dispatch, and transit.',
          'Some pieces have their own estimate, shown on the product page. At checkout you see the estimate for your whole order before you pay.',
        ],
      },
      {
        id: 'cost',
        h: 'Shipping costs',
        body: [
          'Standard shipping is {price} per order and free on orders from {amount}. The exact amount is shown in your cart and at checkout before you pay; nothing is added afterwards.',
        ],
      },
      {
        id: 'tracking',
        h: 'Tracking',
        body: [
          'When your parcel is dispatched, we email you the tracking number with a link to Swiss Post. You can also follow it on your order page and, if you have an account, under My orders.',
        ],
      },
      {
        id: 'destinations',
        h: 'Where we ship',
        body: [
          'We ship to every country you can select at checkout. Swiss Post occasionally suspends service to some destinations; if you are unsure about yours, write to us before ordering.',
        ],
      },
      {
        id: 'customs',
        h: 'Customs and import charges',
        body: [
          'Within Switzerland and Liechtenstein there is nothing more to pay.',
          'For other countries, import VAT and customs duties of the destination country are not included in our prices. They are charged by your country when the parcel arrives and collected by the delivering postal service. The checkout reminds you of this when you choose a delivery address outside Switzerland and Liechtenstein.',
        ],
      },
      {
        id: 'problems',
        h: 'Delays, damage and lost parcels',
        body: [
          'If tracking has not moved for a while, or your parcel arrives damaged, contact us with your order number. For a parcel that seems lost we open a search request with Swiss Post and keep you informed.',
          'An item that arrives damaged, faulty or not as ordered is replaced or refunded in full, including postage. Tell us within 14 days and attach photos. See Returns & Refunds for details.',
        ],
      },
    ],
    questions: 'Questions about a delivery? We usually reply within {reply}.',
    contactCta: 'Contact us',
    faqCta: 'Read the FAQ',
  },
  it: {
    title: 'Spedizione',
    description: 'Da dove spedisce Luxe Vault, tempi di consegna, costi, tracciamento e dogana.',
    eyebrow: 'Assistenza',
    lead: 'Tutto su come ti arriva l’ordine, con le stesse cifre usate al checkout.',
    facts: {
      origin: ['Spedito da', 'Svizzera'],
      carrier: ['Corriere', 'Posta Svizzera, tracciato'],
      time: ['Consegna stimata', '{span}'],
      cost: ['Spedizione', '{price} · gratuita da {amount}'],
    },
    sections: [
      {
        id: 'time',
        h: 'Tempi di consegna',
        body: [
          'Il tempo di consegna stimato è di {span} dall’ordine, a seconda della destinazione. Comprende l’ordine dell’articolo al fornitore, il controllo prima della spedizione e il trasporto.',
          'Alcuni articoli hanno una stima propria, indicata nella pagina prodotto. Al checkout vedi la stima per l’intero ordine prima di pagare.',
        ],
      },
      {
        id: 'cost',
        h: 'Costi di spedizione',
        body: [
          'La spedizione standard costa {price} per ordine ed è gratuita per ordini da {amount}. L’importo esatto compare nel carrello e al checkout prima del pagamento; dopo non si aggiunge nulla.',
        ],
      },
      {
        id: 'tracking',
        h: 'Tracciamento',
        body: [
          'Quando il pacco parte ti inviamo via email il numero di tracciamento con il link alla Posta Svizzera. Puoi seguirlo anche nella pagina dell’ordine e, se hai un account, in «I miei ordini».',
        ],
      },
      {
        id: 'destinations',
        h: 'Dove spediamo',
        body: [
          'Spediamo in tutti i paesi selezionabili al checkout. A volte la Posta Svizzera sospende il servizio verso alcune destinazioni: se hai dubbi sulla tua, scrivici prima di ordinare.',
        ],
      },
      {
        id: 'customs',
        h: 'Dogana e tasse d’importazione',
        body: [
          'In Svizzera e nel Liechtenstein non c’è altro da pagare.',
          'Per gli altri paesi, l’IVA all’importazione e i dazi del paese di destinazione non sono inclusi nei nostri prezzi. Li addebita il tuo paese all’arrivo del pacco e li riscuote il servizio postale che consegna. Il checkout te lo ricorda quando scegli un indirizzo fuori da Svizzera e Liechtenstein.',
        ],
      },
      {
        id: 'problems',
        h: 'Ritardi, danni e pacchi smarriti',
        body: [
          'Se il tracciamento è fermo da tempo o il pacco arriva danneggiato, contattaci con il numero d’ordine. Per un pacco che sembra smarrito apriamo una richiesta di ricerca presso la Posta Svizzera e ti teniamo aggiornato.',
          'Un articolo che arriva danneggiato, difettoso o diverso da quanto ordinato viene sostituito o rimborsato per intero, spedizione compresa. Segnalacelo entro 14 giorni allegando delle foto. Dettagli nella Politica di reso.',
        ],
      },
    ],
    questions: 'Domande su una consegna? Di solito rispondiamo entro {reply}.',
    contactCta: 'Contattaci',
    faqCta: 'Leggi le FAQ',
  },
  fr: {
    title: 'Livraison',
    description: 'D’où expédie Luxe Vault, délais, frais de port, suivi et douane.',
    eyebrow: 'Service client',
    lead: 'Tout sur l’acheminement de votre commande, avec les mêmes chiffres que la page de paiement.',
    facts: {
      origin: ['Expédié depuis', 'la Suisse'],
      carrier: ['Transporteur', 'La Poste suisse, avec suivi'],
      time: ['Livraison estimée', '{span}'],
      cost: ['Frais de port', '{price} · offerts dès {amount}'],
    },
    sections: [
      {
        id: 'time',
        h: 'Délai de livraison',
        body: [
          'Le délai de livraison estimé est de {span} à compter de la commande, selon la destination. Il comprend la commande de la pièce auprès de notre fournisseur, son contrôle avant l’envoi et l’acheminement.',
          'Certaines pièces ont leur propre estimation, indiquée sur la fiche produit. Lors du paiement, vous voyez l’estimation pour toute la commande avant de payer.',
        ],
      },
      {
        id: 'cost',
        h: 'Frais de port',
        body: [
          'La livraison standard coûte {price} par commande et est offerte dès {amount}. Le montant exact apparaît dans le panier et lors du paiement, avant de payer ; rien n’est ajouté ensuite.',
        ],
      },
      {
        id: 'tracking',
        h: 'Suivi',
        body: [
          'Dès l’expédition, nous vous envoyons par e-mail le numéro de suivi avec un lien vers La Poste suisse. Vous pouvez aussi le suivre sur la page de votre commande et, si vous avez un compte, dans « Mes commandes ».',
        ],
      },
      {
        id: 'destinations',
        h: 'Où nous livrons',
        body: [
          'Nous livrons dans tous les pays proposés lors du paiement. La Poste suisse suspend parfois le service vers certaines destinations : en cas de doute, écrivez-nous avant de commander.',
        ],
      },
      {
        id: 'customs',
        h: 'Douane et taxes d’importation',
        body: [
          'En Suisse et au Liechtenstein, il n’y a rien d’autre à payer.',
          'Pour les autres pays, la TVA à l’importation et les droits de douane du pays de destination ne sont pas compris dans nos prix. Ils sont facturés par votre pays à l’arrivée du colis et perçus par le service postal qui livre. La page de paiement vous le rappelle si vous choisissez une adresse hors de Suisse et du Liechtenstein.',
        ],
      },
      {
        id: 'problems',
        h: 'Retards, dommages et colis perdus',
        body: [
          'Si le suivi n’évolue plus depuis un moment ou si le colis arrive endommagé, contactez-nous avec votre numéro de commande. Pour un colis qui semble perdu, nous ouvrons une demande de recherche auprès de La Poste suisse et vous tenons informé.',
          'Un article arrivé endommagé, défectueux ou non conforme est remplacé ou remboursé intégralement, frais de port compris. Signalez-le sous 14 jours avec des photos. Détails dans la Politique de retour.',
        ],
      },
    ],
    questions: 'Une question sur une livraison ? Nous répondons en général sous {reply}.',
    contactCta: 'Nous contacter',
    faqCta: 'Lire la FAQ',
  },
  de: {
    title: 'Versand',
    description: 'Woher Luxe Vault versendet, Lieferzeiten, Versandkosten, Sendungsverfolgung und Zoll.',
    eyebrow: 'Kundenservice',
    lead: 'Alles dazu, wie Ihre Bestellung zu Ihnen kommt – mit denselben Zahlen wie an der Kasse.',
    facts: {
      origin: ['Versand aus', 'der Schweiz'],
      carrier: ['Versanddienst', 'Schweizerische Post, mit Sendungsverfolgung'],
      time: ['Geschätzte Lieferzeit', '{span}'],
      cost: ['Versand', '{price} · kostenlos ab {amount}'],
    },
    sections: [
      {
        id: 'time',
        h: 'Lieferzeit',
        body: [
          'Die geschätzte Lieferzeit beträgt je nach Ziel {span} ab Bestellung. Sie umfasst die Bestellung des Stücks bei unserem Lieferanten, die Prüfung vor dem Versand und den Transport.',
          'Manche Stücke haben eine eigene Schätzung, die auf der Produktseite steht. An der Kasse sehen Sie die Schätzung für die ganze Bestellung, bevor Sie bezahlen.',
        ],
      },
      {
        id: 'cost',
        h: 'Versandkosten',
        body: [
          'Der Standardversand kostet {price} pro Bestellung und ist ab {amount} kostenlos. Der genaue Betrag steht im Warenkorb und an der Kasse, bevor Sie bezahlen; danach kommt nichts hinzu.',
        ],
      },
      {
        id: 'tracking',
        h: 'Sendungsverfolgung',
        body: [
          'Sobald Ihr Paket unterwegs ist, senden wir Ihnen die Sendungsnummer mit einem Link zur Schweizerischen Post per E-Mail. Sie können sie auch auf Ihrer Bestellseite und, mit Konto, unter „Meine Bestellungen“ verfolgen.',
        ],
      },
      {
        id: 'destinations',
        h: 'Wohin wir liefern',
        body: [
          'Wir liefern in alle Länder, die an der Kasse wählbar sind. Die Schweizerische Post setzt den Dienst in einzelne Länder gelegentlich aus – sind Sie unsicher, schreiben Sie uns vor der Bestellung.',
        ],
      },
      {
        id: 'customs',
        h: 'Zoll und Einfuhrabgaben',
        body: [
          'In der Schweiz und in Liechtenstein fällt nichts weiter an.',
          'Für andere Länder sind Einfuhrumsatzsteuer und Zölle des Ziellandes nicht in unseren Preisen enthalten. Ihr Land erhebt sie bei Ankunft des Pakets, eingezogen werden sie vom zustellenden Postdienst. Die Kasse weist Sie darauf hin, wenn Sie eine Lieferadresse ausserhalb der Schweiz und Liechtensteins wählen.',
        ],
      },
      {
        id: 'problems',
        h: 'Verzögerungen, Schäden und verlorene Pakete',
        body: [
          'Bewegt sich die Sendungsverfolgung länger nicht oder kommt das Paket beschädigt an, schreiben Sie uns mit Ihrer Bestellnummer. Für ein scheinbar verlorenes Paket stellen wir einen Nachforschungsauftrag bei der Schweizerischen Post und halten Sie auf dem Laufenden.',
          'Ein Artikel, der beschädigt, fehlerhaft oder nicht wie bestellt ankommt, wird ersetzt oder voll erstattet, inklusive Porto. Melden Sie es innerhalb von 14 Tagen mit Fotos. Einzelheiten in der Rückgaberichtlinie.',
        ],
      },
    ],
    questions: 'Fragen zu einer Lieferung? Wir antworten in der Regel innerhalb von {reply}.',
    contactCta: 'Kontakt',
    faqCta: 'Zu den FAQ',
  },
}
