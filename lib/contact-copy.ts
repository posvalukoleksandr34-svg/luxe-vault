// The wording of /contact — the contact cards and the request form — in the
// storefront's five languages. Kept out of lib/i18n.ts because only the
// contact chunk needs it (like lib/support/copy.ts).
import type { Locale } from '@/lib/types'

export type ContactMethod = 'email' | 'phone' | 'telegram'

export type ContactCopy = {
  pageTitle: string
  pageIntro: string
  helpCenter: string
  contactTitle: string

  emailLabel: string
  emailBody: string
  emailOpenForm: string
  phoneLabel: string
  phoneBody: string
  telegramLabel: string
  telegramBody: string


  formTitle: string
  formIntro: string
  close: string
  required: string
  name: string
  email: string
  emailInvalid: string
  emailValid: string
  nameMissing: string
  method: string
  methods: Record<ContactMethod, string>
  handlePhone: string
  handleTelegram: string
  handleMissing: string
  country: string
  countryNone: string
  type: string
  subject: string
  subjectPh: string
  message: string
  messagePh: string
  messageMissing: string
  attach: string
  attachChoose: string
  attachHint: string
  attachTooMany: string
  attachTooBig: string
  attachType: string
  remove: string
  submit: string
  sending: string
  error: string
  metaMethod: string
  metaCountry: string
  doneTitle: string
  doneBody: string
  doneOpen: string
}

export const CONTACT_COPY: Record<Locale, ContactCopy> = {
  ru: {
    pageTitle: 'Помощь и контакты',
    pageIntro: 'Вопрос о заказе, оплате, доставке или размере — напишите нам, и ответ придёт от человека, а не от бота.',
    helpCenter: 'Центр поддержки и мои запросы',
    contactTitle: 'Свяжитесь с нами',
    emailLabel: 'Почта',
    emailBody: 'Отправьте запрос через форму обратной связи',
    emailOpenForm: 'Открыть форму обратной связи',
    phoneLabel: 'По телефону',
    phoneBody: 'Позвоните нам в рабочие часы',
    telegramLabel: 'Telegram',
    telegramBody: 'Напишите нам напрямую — отвечаем в течение {span}',
    formTitle: 'Помощь и контакты',
    formIntro: 'Ответим на указанную почту в течение {span}.',
    close: 'Закрыть',
    required: 'обязательно',
    name: 'Имя и фамилия',
    email: 'Электронная почта',
    emailInvalid: 'Введите адрес в формате name@example.com',
    emailValid: 'Адрес указан верно',
    nameMissing: 'Укажите имя',
    method: 'Предпочтительный способ связи',
    methods: { email: 'Электронная почта', phone: 'Телефон', telegram: 'Telegram' },
    handlePhone: 'Номер телефона',
    handleTelegram: 'Имя пользователя в Telegram',
    handleMissing: 'Укажите, как с вами связаться',
    country: 'Страна или регион доставки',
    countryNone: 'Выберите страну',
    type: 'Тип запроса',
    subject: 'Тема',
    subjectPh: 'Коротко о сути вопроса',
    message: 'Сообщение',
    messagePh: 'Опишите вопрос подробно: номер заказа, товар, что произошло',
    messageMissing: 'Напишите сообщение',
    attach: 'Вложения',
    attachChoose: 'Выбрать файл',
    attachHint: 'Фото или PDF · до 4 файлов · до 4 МБ вместе',
    attachTooMany: 'Можно прикрепить не больше 4 файлов',
    attachTooBig: 'Файлы вместе должны быть меньше 4 МБ',
    attachType: 'Можно прикрепить только фото и PDF',
    remove: 'Убрать',
    submit: 'Отправить запрос',
    sending: 'Отправляем…',
    error: 'Не удалось отправить запрос. Попробуйте ещё раз.',
    metaMethod: 'Способ связи',
    metaCountry: 'Страна доставки',
    doneTitle: 'Запрос отправлен',
    doneBody: 'Номер запроса — {number}. Ответим на {email} в течение {span}.',
    doneOpen: 'Открыть запрос',
  },
  en: {
    pageTitle: 'Help & contact',
    pageIntro: 'A question about an order, payment, delivery or sizing — write to us and a person, not a bot, will reply.',
    helpCenter: 'Support center and my requests',
    contactTitle: 'Contact us',
    emailLabel: 'Email',
    emailBody: 'Send us a request through the contact form',
    emailOpenForm: 'Open the contact form',
    phoneLabel: 'By phone',
    phoneBody: 'Call us during opening hours',
    telegramLabel: 'Telegram',
    telegramBody: 'Message us directly — we reply within {span}',
    formTitle: 'Help & contact',
    formIntro: "We'll reply to the address you give within {span}.",
    close: 'Close',
    required: 'required',
    name: 'Full name',
    email: 'Email address',
    emailInvalid: 'Enter an address like name@example.com',
    emailValid: 'Address looks right',
    nameMissing: 'Enter your name',
    method: 'Preferred contact method',
    methods: { email: 'Email', phone: 'Phone', telegram: 'Telegram' },
    handlePhone: 'Phone number',
    handleTelegram: 'Telegram username',
    handleMissing: 'Tell us how to reach you',
    country: 'Shipping country/region',
    countryNone: 'Select a country',
    type: 'Request type',
    subject: 'Subject',
    subjectPh: 'Your question in a few words',
    message: 'Message',
    messagePh: 'Tell us the details: order number, item, what happened',
    messageMissing: 'Write a message',
    attach: 'Attachments',
    attachChoose: 'Choose file',
    attachHint: 'Photos or PDF · up to 4 files · 4 MB in total',
    attachTooMany: 'Up to 4 files can be attached',
    attachTooBig: 'Files must be under 4 MB together',
    attachType: 'Only photos and PDF files can be attached',
    remove: 'Remove',
    submit: 'Send request',
    sending: 'Sending…',
    error: "Your request couldn't be sent. Please try again.",
    metaMethod: 'Contact method',
    metaCountry: 'Shipping country',
    doneTitle: 'Request sent',
    doneBody: 'Your request number is {number}. We\'ll reply to {email} within {span}.',
    doneOpen: 'Open request',
  },
  it: {
    pageTitle: 'Assistenza e contatti',
    pageIntro: "Una domanda su ordine, pagamento, spedizione o taglie: scrivici e ti risponderà una persona, non un bot.",
    helpCenter: 'Centro assistenza e le mie richieste',
    contactTitle: 'Contattaci',
    emailLabel: 'Email',
    emailBody: 'Invia una richiesta tramite il modulo di contatto',
    emailOpenForm: 'Apri il modulo di contatto',
    phoneLabel: 'Per telefono',
    phoneBody: 'Chiamaci negli orari di apertura',
    telegramLabel: 'Telegram',
    telegramBody: 'Scrivici direttamente: rispondiamo entro {span}',
    formTitle: 'Assistenza e contatti',
    formIntro: "Risponderemo all'indirizzo indicato entro {span}.",
    close: 'Chiudi',
    required: 'obbligatorio',
    name: 'Nome e cognome',
    email: 'Indirizzo email',
    emailInvalid: 'Inserisci un indirizzo come nome@esempio.com',
    emailValid: 'Indirizzo corretto',
    nameMissing: 'Inserisci il tuo nome',
    method: 'Metodo di contatto preferito',
    methods: { email: 'Email', phone: 'Telefono', telegram: 'Telegram' },
    handlePhone: 'Numero di telefono',
    handleTelegram: 'Nome utente Telegram',
    handleMissing: 'Indica come contattarti',
    country: 'Paese/area di spedizione',
    countryNone: 'Seleziona un paese',
    type: 'Tipo di richiesta',
    subject: 'Oggetto',
    subjectPh: 'La domanda in poche parole',
    message: 'Messaggio',
    messagePh: "Raccontaci i dettagli: numero d'ordine, articolo, cosa è successo",
    messageMissing: 'Scrivi un messaggio',
    attach: 'Allegati',
    attachChoose: 'Scegli file',
    attachHint: 'Foto o PDF · fino a 4 file · 4 MB in totale',
    attachTooMany: 'Si possono allegare al massimo 4 file',
    attachTooBig: 'I file insieme devono essere sotto i 4 MB',
    attachType: 'Si possono allegare solo foto e PDF',
    remove: 'Rimuovi',
    submit: 'Invia richiesta',
    sending: 'Invio…',
    error: 'Impossibile inviare la richiesta. Riprova.',
    metaMethod: 'Metodo di contatto',
    metaCountry: 'Paese di spedizione',
    doneTitle: 'Richiesta inviata',
    doneBody: 'Il numero della richiesta è {number}. Risponderemo a {email} entro {span}.',
    doneOpen: 'Apri richiesta',
  },
  fr: {
    pageTitle: 'Aide et contact',
    pageIntro: 'Une question sur une commande, un paiement, la livraison ou une taille : écrivez-nous, une personne vous répondra, pas un robot.',
    helpCenter: 'Centre d’aide et mes demandes',
    contactTitle: 'Nous contacter',
    emailLabel: 'E-mail',
    emailBody: 'Envoyez-nous une demande via le formulaire de contact',
    emailOpenForm: 'Ouvrir le formulaire de contact',
    phoneLabel: 'Par téléphone',
    phoneBody: 'Appelez-nous aux heures d’ouverture',
    telegramLabel: 'Telegram',
    telegramBody: 'Écrivez-nous directement : réponse sous {span}',
    formTitle: 'Aide et contact',
    formIntro: 'Nous répondrons à l’adresse indiquée sous {span}.',
    close: 'Fermer',
    required: 'obligatoire',
    name: 'Nom complet',
    email: 'Adresse e-mail',
    emailInvalid: 'Saisissez une adresse du type nom@exemple.com',
    emailValid: 'Adresse valide',
    nameMissing: 'Indiquez votre nom',
    method: 'Moyen de contact préféré',
    methods: { email: 'E-mail', phone: 'Téléphone', telegram: 'Telegram' },
    handlePhone: 'Numéro de téléphone',
    handleTelegram: 'Nom d’utilisateur Telegram',
    handleMissing: 'Indiquez comment vous joindre',
    country: 'Pays/région de livraison',
    countryNone: 'Choisissez un pays',
    type: 'Type de demande',
    subject: 'Objet',
    subjectPh: 'Votre question en quelques mots',
    message: 'Message',
    messagePh: 'Donnez-nous les détails : numéro de commande, article, ce qui s’est passé',
    messageMissing: 'Écrivez un message',
    attach: 'Pièces jointes',
    attachChoose: 'Choisir un fichier',
    attachHint: 'Photos ou PDF · 4 fichiers max · 4 Mo au total',
    attachTooMany: '4 fichiers au maximum',
    attachTooBig: 'Les fichiers doivent faire moins de 4 Mo au total',
    attachType: 'Seuls les photos et les PDF sont acceptés',
    remove: 'Retirer',
    submit: 'Envoyer la demande',
    sending: 'Envoi…',
    error: 'La demande n’a pas pu être envoyée. Réessayez.',
    metaMethod: 'Moyen de contact',
    metaCountry: 'Pays de livraison',
    doneTitle: 'Demande envoyée',
    doneBody: 'Numéro de demande : {number}. Nous répondrons à {email} sous {span}.',
    doneOpen: 'Ouvrir la demande',
  },
  de: {
    pageTitle: 'Hilfe & Kontakt',
    pageIntro: 'Eine Frage zu Bestellung, Zahlung, Versand oder Größe – schreiben Sie uns, und ein Mensch antwortet, kein Bot.',
    helpCenter: 'Hilfe-Center und meine Anfragen',
    contactTitle: 'Kontaktieren Sie uns',
    emailLabel: 'E-Mail',
    emailBody: 'Senden Sie uns eine Anfrage über das Kontaktformular',
    emailOpenForm: 'Kontaktformular öffnen',
    phoneLabel: 'Telefonisch',
    phoneBody: 'Rufen Sie uns während der Geschäftszeiten an',
    telegramLabel: 'Telegram',
    telegramBody: 'Schreiben Sie uns direkt – Antwort innerhalb von {span}',
    formTitle: 'Hilfe & Kontakt',
    formIntro: 'Wir antworten an die angegebene Adresse innerhalb von {span}.',
    close: 'Schließen',
    required: 'Pflichtfeld',
    name: 'Vollständiger Name',
    email: 'E-Mail-Adresse',
    emailInvalid: 'Geben Sie eine Adresse wie name@beispiel.ch ein',
    emailValid: 'Adresse ist gültig',
    nameMissing: 'Geben Sie Ihren Namen an',
    method: 'Bevorzugter Kontaktweg',
    methods: { email: 'E-Mail', phone: 'Telefon', telegram: 'Telegram' },
    handlePhone: 'Telefonnummer',
    handleTelegram: 'Telegram-Benutzername',
    handleMissing: 'Sagen Sie uns, wie wir Sie erreichen',
    country: 'Lieferland/-region',
    countryNone: 'Land auswählen',
    type: 'Art der Anfrage',
    subject: 'Betreff',
    subjectPh: 'Ihre Frage in wenigen Worten',
    message: 'Nachricht',
    messagePh: 'Die Einzelheiten: Bestellnummer, Artikel, was passiert ist',
    messageMissing: 'Schreiben Sie eine Nachricht',
    attach: 'Anhänge',
    attachChoose: 'Datei auswählen',
    attachHint: 'Fotos oder PDF · bis zu 4 Dateien · insgesamt 4 MB',
    attachTooMany: 'Höchstens 4 Dateien',
    attachTooBig: 'Die Dateien müssen zusammen unter 4 MB liegen',
    attachType: 'Nur Fotos und PDF-Dateien sind möglich',
    remove: 'Entfernen',
    submit: 'Anfrage senden',
    sending: 'Wird gesendet…',
    error: 'Die Anfrage konnte nicht gesendet werden. Bitte erneut versuchen.',
    metaMethod: 'Kontaktweg',
    metaCountry: 'Lieferland',
    doneTitle: 'Anfrage gesendet',
    doneBody: 'Ihre Anfragenummer ist {number}. Wir antworten an {email} innerhalb von {span}.',
    doneOpen: 'Anfrage öffnen',
  },
}

/** Fills {placeholders}. */
export function fillCopy(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? vars[key] : m))
}
