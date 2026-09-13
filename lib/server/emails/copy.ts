import 'server-only'

import type { Locale } from '@/lib/types'

/**
 * Every word in the transactional emails, in the storefront's five languages.
 *
 * One dictionary rather than strings inside each template, so a language can
 * be read — and corrected — in one place, and so adding a template cannot
 * quietly ship it in English only. Values that carry data are functions.
 */

export type EmailLang = Locale

export const EMAIL_LANGS: EmailLang[] = ['ru', 'en', 'it', 'fr', 'de']

/** A usable language from anything (a stored locale, user metadata, a request
 *  field). English when there is nothing to go on. */
export function emailLang(raw: unknown): EmailLang {
  const v = String(raw ?? '').toLowerCase().slice(0, 2)
  return (EMAIL_LANGS as string[]).indexOf(v) !== -1 ? (v as EmailLang) : 'en'
}

type Status = { subject: (id: string) => string; heading: string; body: string }

export type EmailCopy = {
  orderNumber: string
  orderDate: string
  items: string
  subtotal: string
  discount: string
  shipping: string
  free: string
  tax: string
  total: string
  shippingTo: string
  status: string
  trackOrder: string
  viewOrder: string
  shopNow: string
  help: string
  automatic: string
  confirm: { subject: (id: string) => string; heading: (name: string) => string; intro: string }
  receipt: {
    subject: (id: string) => string
    heading: string
    intro: string
    paid: string
    convertedFrom: (amount: string, rate: string, currency: string) => string
    reference: string
  }
  failed: { subject: (id: string) => string; heading: string; intro: string; nothingCharged: string }
  processing: Status
  shipped: Status & { tracking: string }
  delivered: Status
  cancelled: Status
  refunded: { subject: (id: string) => string; heading: string; body: (min: number, max: number) => string; amount: string }
  welcome: { subject: string; heading: (name: string) => string; body: string }
}

const withName = (sep: string, name: string) => (name ? `${sep}${name}` : '')

export const EMAIL_COPY: Record<EmailLang, EmailCopy> = {
  ru: {
    orderNumber: 'Номер заказа',
    orderDate: 'Дата',
    items: 'Состав заказа',
    subtotal: 'Сумма',
    discount: 'Скидка',
    shipping: 'Доставка',
    free: 'Бесплатно',
    tax: 'Налог',
    total: 'Итого',
    shippingTo: 'Адрес доставки',
    status: 'Статус',
    trackOrder: 'Отследить заказ',
    viewOrder: 'Открыть заказ',
    shopNow: 'Перейти в магазин',
    help: 'Вопросы? Ответьте на это письмо или напишите на',
    automatic: 'Это письмо отправлено автоматически.',
    confirm: {
      subject: (id) => `Заказ ${id} оформлен — Luxe Vault`,
      heading: (name) => `Спасибо за заказ${withName(', ', name)}`,
      intro: 'Мы получили ваш заказ. Напишем снова, когда оплата будет подтверждена и посылка отправится.',
    },
    receipt: {
      subject: (id) => `Оплата заказа ${id} получена — Luxe Vault`,
      heading: 'Оплата получена',
      intro: 'Спасибо! Платёж прошёл, и мы уже готовим ваш заказ к отправке.',
      paid: 'Оплачено',
      convertedFrom: (amount, rate, currency) => `Пересчитано из ${amount} по курсу 1 CHF = ${rate} ${currency}`,
      reference: 'Номер платежа',
    },
    failed: {
      subject: (id) => `Оплата заказа ${id} не завершена`,
      heading: 'Оплата не завершена',
      intro: 'Платёж по вашему заказу не прошёл — банк отклонил операцию или она была прервана. Заказ сохранён: оплатить его можно в разделе «Мои заказы».',
      nothingCharged: 'Деньги с карты не списаны.',
    },
    processing: {
      subject: (id) => `Заказ ${id} готовится к отправке`,
      heading: 'Готовим ваш заказ',
      body: 'Оплата подтверждена, заказ передан нашей команде. Мы сообщим, как только посылка отправится.',
    },
    shipped: {
      subject: (id) => `Заказ ${id} отправлен`,
      heading: 'Заказ в пути',
      body: 'Посылка передана перевозчику. Первые данные отслеживания могут появиться в течение суток.',
      tracking: 'Трек-номер',
    },
    delivered: {
      subject: (id) => `Заказ ${id} доставлен`,
      heading: 'Заказ доставлен',
      body: 'Заказ отмечен как доставленный. Если что-то не так, ответьте на это письмо в течение 14 дней — мы всё исправим.',
    },
    cancelled: {
      subject: (id) => `Заказ ${id} отменён`,
      heading: 'Заказ отменён',
      body: 'Ваш заказ отменён. Если оплата была списана, деньги вернутся на карту.',
    },
    refunded: {
      subject: (id) => `Возврат по заказу ${id}`,
      heading: 'Возврат оформлен',
      body: (min, max) => `Мы оформили возврат. Обычно банку требуется ${min}–${max} рабочих дней, чтобы деньги появились на карте.`,
      amount: 'Сумма возврата',
    },
    welcome: {
      subject: 'Добро пожаловать в Luxe Vault',
      heading: (name) => `Добро пожаловать${withName(', ', name)}`,
      body: 'Ваш аккаунт готов. Заказы, статусы доставки и сохранённые данные теперь в одном месте.',
    },
  },

  en: {
    orderNumber: 'Order number',
    orderDate: 'Date',
    items: 'Items',
    subtotal: 'Subtotal',
    discount: 'Discount',
    shipping: 'Shipping',
    free: 'Free',
    tax: 'Tax',
    total: 'Total',
    shippingTo: 'Shipping to',
    status: 'Status',
    trackOrder: 'Track order',
    viewOrder: 'View order',
    shopNow: 'Visit the shop',
    help: 'Questions? Reply to this email or write to',
    automatic: 'This email was sent automatically.',
    confirm: {
      subject: (id) => `Order ${id} placed — Luxe Vault`,
      heading: (name) => `Thank you for your order${withName(', ', name)}`,
      intro: 'We have received your order. We will write again when the payment is confirmed and when the parcel ships.',
    },
    receipt: {
      subject: (id) => `Payment received for ${id} — Luxe Vault`,
      heading: 'Payment received',
      intro: 'Thank you — your payment has gone through and we are preparing your order for dispatch.',
      paid: 'Amount paid',
      convertedFrom: (amount, rate, currency) => `Converted from ${amount} at 1 CHF = ${rate} ${currency}`,
      reference: 'Payment reference',
    },
    failed: {
      subject: (id) => `Payment for order ${id} not completed`,
      heading: 'Payment not completed',
      intro: 'The payment for your order did not go through — the bank declined it or it was interrupted. Your order is saved; you can pay for it from "My orders" in your account.',
      nothingCharged: 'Nothing has been charged to your card.',
    },
    processing: {
      subject: (id) => `Your order ${id} is being prepared`,
      heading: 'We are preparing your order',
      body: 'Your payment is confirmed and your order is with our team. We will write the moment it ships.',
    },
    shipped: {
      subject: (id) => `Your order ${id} has shipped`,
      heading: 'Your order is on its way',
      body: 'Your parcel has been handed to the carrier. Tracking can take a day to show its first scan.',
      tracking: 'Tracking number',
    },
    delivered: {
      subject: (id) => `Your order ${id} has been delivered`,
      heading: 'Delivered',
      body: 'Your order has been marked as delivered. If anything is not as expected, reply to this email within 14 days and we will put it right.',
    },
    cancelled: {
      subject: (id) => `Your order ${id} has been cancelled`,
      heading: 'Your order was cancelled',
      body: 'Your order has been cancelled. If you were charged, the money is returned to your card.',
    },
    refunded: {
      subject: (id) => `Your refund for order ${id}`,
      heading: 'Your refund is on its way',
      body: (min, max) => `We have issued your refund. Banks usually take ${min}–${max} working days to show it on your card.`,
      amount: 'Refunded',
    },
    welcome: {
      subject: 'Welcome to Luxe Vault',
      heading: (name) => `Welcome${withName(', ', name)}`,
      body: 'Your account is ready. Your orders, delivery status and saved details now live in one place.',
    },
  },

  it: {
    orderNumber: 'Numero d’ordine',
    orderDate: 'Data',
    items: 'Articoli',
    subtotal: 'Subtotale',
    discount: 'Sconto',
    shipping: 'Spedizione',
    free: 'Gratuita',
    tax: 'Imposte',
    total: 'Totale',
    shippingTo: 'Indirizzo di consegna',
    status: 'Stato',
    trackOrder: 'Segui l’ordine',
    viewOrder: 'Vedi l’ordine',
    shopNow: 'Vai al negozio',
    help: 'Domande? Rispondi a questa email o scrivi a',
    automatic: 'Questa email è stata inviata automaticamente.',
    confirm: {
      subject: (id) => `Ordine ${id} ricevuto — Luxe Vault`,
      heading: (name) => `Grazie per il tuo ordine${withName(', ', name)}`,
      intro: 'Abbiamo ricevuto il tuo ordine. Ti scriveremo quando il pagamento sarà confermato e quando il pacco partirà.',
    },
    receipt: {
      subject: (id) => `Pagamento ricevuto per ${id} — Luxe Vault`,
      heading: 'Pagamento ricevuto',
      intro: 'Grazie: il pagamento è andato a buon fine e stiamo preparando il tuo ordine per la spedizione.',
      paid: 'Importo pagato',
      convertedFrom: (amount, rate, currency) => `Convertito da ${amount} al tasso 1 CHF = ${rate} ${currency}`,
      reference: 'Riferimento del pagamento',
    },
    failed: {
      subject: (id) => `Pagamento dell’ordine ${id} non completato`,
      heading: 'Pagamento non completato',
      intro: 'Il pagamento del tuo ordine non è andato a buon fine: la banca l’ha rifiutato o è stato interrotto. L’ordine è salvato e puoi pagarlo da «I miei ordini» nel tuo account.',
      nothingCharged: 'Non è stato addebitato nulla sulla tua carta.',
    },
    processing: {
      subject: (id) => `Il tuo ordine ${id} è in preparazione`,
      heading: 'Stiamo preparando il tuo ordine',
      body: 'Il pagamento è confermato e il tuo ordine è nelle mani del nostro team. Ti scriveremo appena partirà.',
    },
    shipped: {
      subject: (id) => `Il tuo ordine ${id} è stato spedito`,
      heading: 'Il tuo ordine è in viaggio',
      body: 'Il pacco è stato affidato al corriere. Il tracciamento può impiegare un giorno a mostrare la prima scansione.',
      tracking: 'Numero di tracciamento',
    },
    delivered: {
      subject: (id) => `Il tuo ordine ${id} è stato consegnato`,
      heading: 'Consegnato',
      body: 'Il tuo ordine risulta consegnato. Se qualcosa non va, rispondi a questa email entro 14 giorni e sistemeremo tutto.',
    },
    cancelled: {
      subject: (id) => `Il tuo ordine ${id} è stato annullato`,
      heading: 'Ordine annullato',
      body: 'Il tuo ordine è stato annullato. Se è stato effettuato un addebito, l’importo tornerà sulla tua carta.',
    },
    refunded: {
      subject: (id) => `Il rimborso del tuo ordine ${id}`,
      heading: 'Il rimborso è in arrivo',
      body: (min, max) => `Abbiamo emesso il rimborso. Di solito la banca impiega ${min}–${max} giorni lavorativi per mostrarlo sulla carta.`,
      amount: 'Rimborsato',
    },
    welcome: {
      subject: 'Benvenuto in Luxe Vault',
      heading: (name) => `Benvenuto${withName(', ', name)}`,
      body: 'Il tuo account è pronto. Ordini, stato delle consegne e dati salvati ora sono in un unico posto.',
    },
  },

  fr: {
    orderNumber: 'Numéro de commande',
    orderDate: 'Date',
    items: 'Articles',
    subtotal: 'Sous-total',
    discount: 'Remise',
    shipping: 'Livraison',
    free: 'Offerte',
    tax: 'Taxes',
    total: 'Total',
    shippingTo: 'Adresse de livraison',
    status: 'Statut',
    trackOrder: 'Suivre la commande',
    viewOrder: 'Voir la commande',
    shopNow: 'Visiter la boutique',
    help: 'Des questions ? Répondez à cet e-mail ou écrivez à',
    automatic: 'Cet e-mail a été envoyé automatiquement.',
    confirm: {
      subject: (id) => `Commande ${id} enregistrée — Luxe Vault`,
      heading: (name) => `Merci pour votre commande${withName(', ', name)}`,
      intro: 'Nous avons bien reçu votre commande. Nous vous écrirons lorsque le paiement sera confirmé et lorsque le colis partira.',
    },
    receipt: {
      subject: (id) => `Paiement reçu pour ${id} — Luxe Vault`,
      heading: 'Paiement reçu',
      intro: 'Merci : votre paiement a été accepté et nous préparons votre commande pour l’expédition.',
      paid: 'Montant payé',
      convertedFrom: (amount, rate, currency) => `Converti depuis ${amount} au taux de 1 CHF = ${rate} ${currency}`,
      reference: 'Référence du paiement',
    },
    failed: {
      subject: (id) => `Paiement de la commande ${id} non finalisé`,
      heading: 'Paiement non finalisé',
      intro: 'Le paiement de votre commande n’a pas abouti : la banque l’a refusé ou il a été interrompu. Votre commande est enregistrée ; vous pouvez la régler depuis « Mes commandes » dans votre compte.',
      nothingCharged: 'Rien n’a été débité sur votre carte.',
    },
    processing: {
      subject: (id) => `Votre commande ${id} est en préparation`,
      heading: 'Nous préparons votre commande',
      body: 'Votre paiement est confirmé et votre commande est entre les mains de notre équipe. Nous vous écrirons dès son expédition.',
    },
    shipped: {
      subject: (id) => `Votre commande ${id} a été expédiée`,
      heading: 'Votre commande est en route',
      body: 'Votre colis a été remis au transporteur. Le suivi peut mettre une journée à afficher le premier scan.',
      tracking: 'Numéro de suivi',
    },
    delivered: {
      subject: (id) => `Votre commande ${id} a été livrée`,
      heading: 'Livrée',
      body: 'Votre commande est indiquée comme livrée. Si quelque chose ne va pas, répondez à cet e-mail sous 14 jours et nous arrangerons cela.',
    },
    cancelled: {
      subject: (id) => `Votre commande ${id} a été annulée`,
      heading: 'Commande annulée',
      body: 'Votre commande a été annulée. Si vous avez été débité, le montant sera remboursé sur votre carte.',
    },
    refunded: {
      subject: (id) => `Votre remboursement pour la commande ${id}`,
      heading: 'Votre remboursement est en route',
      body: (min, max) => `Nous avons effectué votre remboursement. Les banques mettent généralement ${min} à ${max} jours ouvrés pour l’afficher sur votre carte.`,
      amount: 'Remboursé',
    },
    welcome: {
      subject: 'Bienvenue chez Luxe Vault',
      heading: (name) => `Bienvenue${withName(', ', name)}`,
      body: 'Votre compte est prêt. Vos commandes, le suivi des livraisons et vos informations enregistrées sont désormais réunis au même endroit.',
    },
  },

  de: {
    orderNumber: 'Bestellnummer',
    orderDate: 'Datum',
    items: 'Artikel',
    subtotal: 'Zwischensumme',
    discount: 'Rabatt',
    shipping: 'Versand',
    free: 'Kostenlos',
    tax: 'Steuer',
    total: 'Gesamt',
    shippingTo: 'Lieferadresse',
    status: 'Status',
    trackOrder: 'Bestellung verfolgen',
    viewOrder: 'Bestellung ansehen',
    shopNow: 'Zum Shop',
    help: 'Fragen? Antworten Sie auf diese E-Mail oder schreiben Sie an',
    automatic: 'Diese E-Mail wurde automatisch versendet.',
    confirm: {
      subject: (id) => `Bestellung ${id} eingegangen — Luxe Vault`,
      heading: (name) => `Danke für Ihre Bestellung${withName(', ', name)}`,
      intro: 'Wir haben Ihre Bestellung erhalten. Wir melden uns, sobald die Zahlung bestätigt ist und das Paket versendet wird.',
    },
    receipt: {
      subject: (id) => `Zahlung für ${id} erhalten — Luxe Vault`,
      heading: 'Zahlung erhalten',
      intro: 'Danke – Ihre Zahlung ist eingegangen und wir bereiten Ihre Bestellung für den Versand vor.',
      paid: 'Bezahlter Betrag',
      convertedFrom: (amount, rate, currency) => `Umgerechnet aus ${amount} zum Kurs 1 CHF = ${rate} ${currency}`,
      reference: 'Zahlungsreferenz',
    },
    failed: {
      subject: (id) => `Zahlung für Bestellung ${id} nicht abgeschlossen`,
      heading: 'Zahlung nicht abgeschlossen',
      intro: 'Die Zahlung für Ihre Bestellung ist nicht durchgegangen – die Bank hat sie abgelehnt oder sie wurde unterbrochen. Ihre Bestellung bleibt gespeichert; Sie können sie unter „Meine Bestellungen“ in Ihrem Konto bezahlen.',
      nothingCharged: 'Ihre Karte wurde nicht belastet.',
    },
    processing: {
      subject: (id) => `Ihre Bestellung ${id} wird vorbereitet`,
      heading: 'Wir bereiten Ihre Bestellung vor',
      body: 'Ihre Zahlung ist bestätigt und Ihre Bestellung ist bei unserem Team. Wir melden uns, sobald sie versendet wird.',
    },
    shipped: {
      subject: (id) => `Ihre Bestellung ${id} wurde versendet`,
      heading: 'Ihre Bestellung ist unterwegs',
      body: 'Ihr Paket wurde dem Versanddienst übergeben. Bis zum ersten Scan kann es einen Tag dauern.',
      tracking: 'Sendungsnummer',
    },
    delivered: {
      subject: (id) => `Ihre Bestellung ${id} wurde zugestellt`,
      heading: 'Zugestellt',
      body: 'Ihre Bestellung wurde als zugestellt markiert. Falls etwas nicht stimmt, antworten Sie innerhalb von 14 Tagen auf diese E-Mail – wir kümmern uns darum.',
    },
    cancelled: {
      subject: (id) => `Ihre Bestellung ${id} wurde storniert`,
      heading: 'Bestellung storniert',
      body: 'Ihre Bestellung wurde storniert. Falls belastet wurde, erhalten Sie das Geld auf Ihre Karte zurück.',
    },
    refunded: {
      subject: (id) => `Ihre Rückerstattung für Bestellung ${id}`,
      heading: 'Ihre Rückerstattung ist unterwegs',
      body: (min, max) => `Wir haben Ihre Rückerstattung veranlasst. Banken benötigen meist ${min}–${max} Werktage, bis sie auf Ihrer Karte erscheint.`,
      amount: 'Erstattet',
    },
    welcome: {
      subject: 'Willkommen bei Luxe Vault',
      heading: (name) => `Willkommen${withName(', ', name)}`,
      body: 'Ihr Konto ist bereit. Bestellungen, Lieferstatus und gespeicherte Daten finden Sie jetzt an einem Ort.',
    },
  },
}
