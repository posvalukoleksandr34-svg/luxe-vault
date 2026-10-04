import type { StorefrontLocale } from '@/lib/types'

/**
 * The Imprint / Legal Notice, as copy. The seller's details themselves come
 * from config/business.ts and are rendered only when configured — nothing
 * here names a person or an address.
 */
export type ImprintCopy = {
  title: string
  description: string
  intro: string
  /** Shown while the seller's legal name is not configured. */
  introAnonymous: string
  operatorHeading: string
  seller: string
  tradingAs: string
  address: string
  email: string
  phone: string
  telegram: string
  uid: string
  responsible: string
  contactHeading: string
  contactBody: string
  contactLink: string
  productsHeading: string
  productsBody: string
  policiesHeading: string
  policiesBody: string
}

export const IMPRINT: Record<StorefrontLocale, ImprintCopy> = {
  en: {
    title: 'Imprint',
    description: 'Who operates Luxe Vault and how to contact the seller.',
    intro: 'Luxe Vault is an online shop operated by {name} from Switzerland.',
    introAnonymous: 'Luxe Vault is an online shop operated by a private seller based in Switzerland.',
    operatorHeading: 'Seller',
    seller: 'Name',
    tradingAs: 'Trading as',
    address: 'Address',
    email: 'Email',
    phone: 'Phone',
    telegram: 'Telegram',
    uid: 'UID (business ID)',
    responsible: 'Responsible for content',
    contactHeading: 'Contacting the seller',
    contactBody: 'Email is the most reliable way to reach us, and the contact form sends to the same inbox. We usually reply within {span}. Please include your order number if your message is about an order.',
    contactLink: 'Contact form',
    productsHeading: 'About the products',
    productsBody: 'Luxe Vault sells replicas and designer-inspired items. They are not made, sold or authorised by the brands they reference, and Luxe Vault is not affiliated with any brand owner.',
    policiesHeading: 'Policies',
    policiesBody: 'Every purchase is covered by these documents:',
  },
  it: {
    title: 'Note legali',
    description: 'Chi gestisce Luxe Vault e come contattare il venditore.',
    intro: 'Luxe Vault è un negozio online gestito da {name} dalla Svizzera.',
    introAnonymous: 'Luxe Vault è un negozio online gestito da un venditore privato con sede in Svizzera.',
    operatorHeading: 'Venditore',
    seller: 'Nome',
    tradingAs: 'Nome commerciale',
    address: 'Indirizzo',
    email: 'Email',
    phone: 'Telefono',
    telegram: 'Telegram',
    uid: 'IDI (numero d’impresa)',
    responsible: 'Responsabile dei contenuti',
    contactHeading: 'Contattare il venditore',
    contactBody: 'L’email è il modo più affidabile per raggiungerci; il modulo di contatto arriva nella stessa casella. Di solito rispondiamo entro {span}. Se il messaggio riguarda un ordine, indica il numero d’ordine.',
    contactLink: 'Modulo di contatto',
    productsHeading: 'Sui prodotti',
    productsBody: 'Luxe Vault vende repliche e articoli ispirati a modelli di designer. Non sono prodotti, venduti né autorizzati dai marchi a cui si ispirano, e Luxe Vault non è affiliato ad alcun titolare di marchio.',
    policiesHeading: 'Condizioni',
    policiesBody: 'Ogni acquisto è regolato da questi documenti:',
  },
  fr: {
    title: 'Mentions légales',
    description: 'Qui exploite Luxe Vault et comment contacter le vendeur.',
    intro: 'Luxe Vault est une boutique en ligne exploitée par {name} depuis la Suisse.',
    introAnonymous: 'Luxe Vault est une boutique en ligne exploitée par un vendeur particulier établi en Suisse.',
    operatorHeading: 'Vendeur',
    seller: 'Nom',
    tradingAs: 'Nom commercial',
    address: 'Adresse',
    email: 'E-mail',
    phone: 'Téléphone',
    telegram: 'Telegram',
    uid: 'IDE (numéro d’entreprise)',
    responsible: 'Responsable du contenu',
    contactHeading: 'Contacter le vendeur',
    contactBody: 'L’e-mail est le moyen le plus fiable de nous joindre ; le formulaire de contact arrive dans la même boîte. Nous répondons en général sous {span}. Si votre message concerne une commande, indiquez son numéro.',
    contactLink: 'Formulaire de contact',
    productsHeading: 'À propos des produits',
    productsBody: 'Luxe Vault vend des répliques et des articles inspirés de créateurs. Ils ne sont ni fabriqués, ni vendus, ni autorisés par les marques auxquelles ils font référence, et Luxe Vault n’est affilié à aucun titulaire de marque.',
    policiesHeading: 'Conditions',
    policiesBody: 'Chaque achat est régi par ces documents :',
  },
  de: {
    title: 'Impressum',
    description: 'Wer Luxe Vault betreibt und wie Sie den Verkäufer erreichen.',
    intro: 'Luxe Vault ist ein Onlineshop, betrieben von {name} aus der Schweiz.',
    introAnonymous: 'Luxe Vault ist ein Onlineshop, betrieben von einer Privatperson mit Sitz in der Schweiz.',
    operatorHeading: 'Verkäufer',
    seller: 'Name',
    tradingAs: 'Geschäftsbezeichnung',
    address: 'Adresse',
    email: 'E-Mail',
    phone: 'Telefon',
    telegram: 'Telegram',
    uid: 'UID (Unternehmens-Identifikationsnummer)',
    responsible: 'Verantwortlich für den Inhalt',
    contactHeading: 'Kontakt zum Verkäufer',
    contactBody: 'Am zuverlässigsten erreichen Sie uns per E-Mail; das Kontaktformular landet im selben Postfach. Wir antworten in der Regel innerhalb von {span}. Geht es um eine Bestellung, nennen Sie bitte die Bestellnummer.',
    contactLink: 'Kontaktformular',
    productsHeading: 'Zu den Produkten',
    productsBody: 'Luxe Vault verkauft Replikate und von Designern inspirierte Artikel. Sie werden von den Marken, auf die sie sich beziehen, weder hergestellt noch verkauft oder autorisiert, und Luxe Vault ist mit keinem Markeninhaber verbunden.',
    policiesHeading: 'Bedingungen',
    policiesBody: 'Für jeden Kauf gelten diese Dokumente:',
  },
}
