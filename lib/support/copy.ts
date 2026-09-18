// The support center's wording, in the storefront's five languages. Kept out
// of lib/i18n.ts because only the support chunk needs it.
import type { Locale, SupportCategory, SupportTicketStatus } from '@/lib/types'

export type SupportTopic = 'where' | 'payment' | 'shipping' | 'returns' | 'sizes' | 'product' | 'account'
export const SUPPORT_TOPICS: SupportTopic[] = ['where', 'payment', 'shipping', 'returns', 'sizes', 'product', 'account']
/** The request category a topic files under. */
export const TOPIC_CATEGORY: Record<SupportTopic, SupportCategory> = {
  where: 'order',
  payment: 'payment',
  shipping: 'shipping',
  returns: 'returns',
  sizes: 'sizes',
  product: 'product',
  account: 'account',
}

export type SupportCopy = {
  title: string
  heading: string
  honest: string
  replyWithin: string
  searchPlaceholder: string
  searchEmpty: string
  searchEmptyHint: string
  topicsTitle: string
  topics: Record<SupportTopic, string>
  contact: string
  contactHint: string
  myTickets: string
  viewAll: string
  myOrders: string
  ordersHint: string
  signIn: string
  track: string
  orderDetails: string
  back: string
  close: string
  newTitle: string
  category: string
  categories: Record<SupportCategory, string>
  order: string
  orderNone: string
  /** A request about a cancelled or refunded order: refused. */
  orderClosed: string
  subject: string
  subjectPh: string
  message: string
  messagePh: string
  attach: string
  attachHint: string
  attachTooMany: string
  attachTooBig: string
  attachType: string
  remove: string
  email: string
  name: string
  optional: string
  submit: string
  sending: string
  error: string
  required: string
  createdTitle: string
  createdNumber: string
  createdBody: string
  openConversation: string
  statuses: Record<SupportTicketStatus, string>
  statusHints: Record<SupportTicketStatus, string>
  you: string
  team: string
  replyPh: string
  send: string
  closedNote: string
  newRequest: string
  notFound: string
  loadError: string
  retry: string
  newReply: string
  opened: string
  orderRef: string
  stillNeedHelp: string
  orWrite: string
  loading: string
  noTickets: string
}

export const SUPPORT_COPY: Record<Locale, SupportCopy> = {
  en: {
    title: 'Support Messages',
    heading: 'How can we help you?',
    honest: 'The Luxe Vault personal concierge service. We handle every request by hand and will reply to your email within {span}.',
    replyWithin: 'Reply within {span}',
    searchPlaceholder: 'Search help: delivery, returns, sizes…',
    searchEmpty: 'Nothing found for “{q}”.',
    searchEmptyHint: 'Write to us and a person will answer.',
    topicsTitle: 'Topics',
    topics: { where: 'Where is my order?', payment: 'Payment', shipping: 'Shipping', returns: 'Returns', sizes: 'Sizes', product: 'Product', account: 'Account' },
    contact: 'Contact the concierge',
    contactHint: 'Write to our team — attach photos if they help',
    myTickets: 'My Tickets',
    viewAll: 'View all',
    myOrders: 'My Orders',
    ordersHint: 'Sign in to see your orders and their tracking here.',
    signIn: 'Sign in',
    track: 'Track parcel',
    orderDetails: 'Order details',
    back: 'Back',
    close: 'Close',
    newTitle: 'New request',
    category: 'Topic',
    categories: { order: 'Order', payment: 'Payment', shipping: 'Shipping', returns: 'Returns', sizes: 'Sizes', product: 'Product', account: 'Account', other: 'Other' },
    order: 'Order',
    orderNone: 'Not about a specific order',
    orderClosed: 'Requests about cancelled orders are not available.',
    subject: 'Subject',
    subjectPh: 'In a few words',
    message: 'Message',
    messagePh: 'Tell us what happened. The more detail you give, the faster we can help.',
    attach: 'Attach photos or PDF',
    attachHint: 'Up to 4 files, 4 MB in total',
    attachTooMany: 'Up to 4 files can be attached.',
    attachTooBig: 'Attachments together must be under 4 MB.',
    attachType: 'Only photos (JPEG, PNG, WebP, HEIC) and PDF files can be attached.',
    remove: 'Remove',
    email: 'Email for our reply',
    name: 'Your name',
    optional: 'optional',
    submit: 'Submit Ticket',
    sending: 'Sending…',
    error: 'Your request could not be sent. Please try again.',
    required: 'Please fill in the subject and the message.',
    createdTitle: 'Request received',
    createdNumber: 'Your request number',
    createdBody: 'A confirmation is on its way to {email}. Expect our reply within {span}.',
    openConversation: 'Open the conversation',
    statuses: { open: 'Open', in_progress: 'In Progress', waiting_user: 'Waiting for You', resolved: 'Resolved', closed: 'Closed' },
    statusHints: {
      open: 'Received — our team will reply within {span}.',
      in_progress: 'Our team is working on your request.',
      waiting_user: 'We have replied and are waiting for your answer.',
      resolved: 'Marked as resolved. Reply if anything is still open.',
      closed: 'This request is closed.',
    },
    you: 'You',
    team: 'Luxe Vault Support',
    replyPh: 'Write a reply…',
    send: 'Send',
    closedNote: 'This request is closed. If you need anything else, please open a new one.',
    newRequest: 'New request',
    notFound: 'This request could not be opened. Use the link from our email, or sign in with the account that filed it.',
    loadError: 'Could not load. Check your connection and try again.',
    retry: 'Try again',
    newReply: 'New reply',
    opened: 'Opened {date}',
    orderRef: 'Order {id}',
    stillNeedHelp: 'Still need help?',
    orWrite: 'Or write to {email}',
    loading: 'Loading…',
    noTickets: 'No requests yet.',
  },
  ru: {
    title: 'Сообщения поддержки',
    heading: 'Чем мы можем помочь?',
    honest: 'Персональная консьерж-служба Luxe Vault. Мы обрабатываем каждое обращение вручную и ответим на вашу почту в течение {span}.',
    replyWithin: 'Ответ в течение {span}',
    searchPlaceholder: 'Поиск по помощи: доставка, возврат, размеры…',
    searchEmpty: 'По запросу «{q}» ничего не найдено.',
    searchEmptyHint: 'Напишите нам — ответит человек.',
    topicsTitle: 'Темы',
    topics: { where: 'Где мой заказ?', payment: 'Оплата', shipping: 'Доставка', returns: 'Возврат', sizes: 'Размеры', product: 'Товар', account: 'Аккаунт' },
    contact: 'Связаться с консьержем',
    contactHint: 'Опишите вопрос — при необходимости приложите фото',
    myTickets: 'Мои обращения',
    viewAll: 'Все',
    myOrders: 'Мои заказы',
    ordersHint: 'Войдите, чтобы видеть здесь свои заказы и их отслеживание.',
    signIn: 'Войти',
    track: 'Отследить посылку',
    orderDetails: 'Детали заказа',
    back: 'Назад',
    close: 'Закрыть',
    newTitle: 'Новое обращение',
    category: 'Тема',
    categories: { order: 'Заказ', payment: 'Оплата', shipping: 'Доставка', returns: 'Возврат', sizes: 'Размеры', product: 'Товар', account: 'Аккаунт', other: 'Другое' },
    order: 'Заказ',
    orderNone: 'Не по конкретному заказу',
    orderClosed: 'Обращения по отменённым заказам недоступны.',
    subject: 'Тема обращения',
    subjectPh: 'Коротко о главном',
    message: 'Сообщение',
    messagePh: 'Расскажите, что произошло. Чем подробнее, тем быстрее мы поможем.',
    attach: 'Приложить фото или PDF',
    attachHint: 'До 4 файлов, всего до 4 МБ',
    attachTooMany: 'Можно приложить не более 4 файлов.',
    attachTooBig: 'Вложения вместе должны быть меньше 4 МБ.',
    attachType: 'Можно приложить только фото (JPEG, PNG, WebP, HEIC) и PDF.',
    remove: 'Убрать',
    email: 'Email для ответа',
    name: 'Ваше имя',
    optional: 'необязательно',
    submit: 'Отправить обращение',
    sending: 'Отправляем…',
    error: 'Не удалось отправить обращение. Попробуйте ещё раз.',
    required: 'Заполните тему и сообщение.',
    createdTitle: 'Обращение принято',
    createdNumber: 'Номер обращения',
    createdBody: 'Подтверждение отправлено на {email}. Ответим в течение {span}.',
    openConversation: 'Открыть переписку',
    statuses: { open: 'Открыто', in_progress: 'В работе', waiting_user: 'Ждём вашего ответа', resolved: 'Решено', closed: 'Закрыто' },
    statusHints: {
      open: 'Получено — ответим в течение {span}.',
      in_progress: 'Команда работает над вашим обращением.',
      waiting_user: 'Мы ответили и ждём вашего ответа.',
      resolved: 'Отмечено как решённое. Напишите, если вопрос остался.',
      closed: 'Обращение закрыто.',
    },
    you: 'Вы',
    team: 'Поддержка Luxe Vault',
    replyPh: 'Напишите ответ…',
    send: 'Отправить',
    closedNote: 'Обращение закрыто. Если нужно что-то ещё, создайте новое.',
    newRequest: 'Новое обращение',
    notFound: 'Не удалось открыть обращение. Воспользуйтесь ссылкой из письма или войдите в аккаунт, с которого оно отправлено.',
    loadError: 'Не удалось загрузить. Проверьте соединение и попробуйте снова.',
    retry: 'Повторить',
    newReply: 'Новый ответ',
    opened: 'Создано {date}',
    orderRef: 'Заказ {id}',
    stillNeedHelp: 'Остались вопросы?',
    orWrite: 'Или напишите на {email}',
    loading: 'Загрузка…',
    noTickets: 'Обращений пока нет.',
  },
  it: {
    title: 'Messaggi di assistenza',
    heading: 'Come possiamo aiutarti?',
    honest: 'Il servizio di concierge personale Luxe Vault. Gestiamo ogni richiesta personalmente e risponderemo alla tua email entro {span}.',
    replyWithin: 'Risposta entro {span}',
    searchPlaceholder: 'Cerca: spedizione, resi, taglie…',
    searchEmpty: 'Nessun risultato per «{q}».',
    searchEmptyHint: 'Scrivici: ti risponderà una persona.',
    topicsTitle: 'Argomenti',
    topics: { where: 'Dov’è il mio ordine?', payment: 'Pagamento', shipping: 'Spedizione', returns: 'Resi', sizes: 'Taglie', product: 'Prodotto', account: 'Account' },
    contact: 'Contatta il concierge',
    contactHint: 'Scrivi al nostro team, anche con foto',
    myTickets: 'Le mie richieste',
    viewAll: 'Tutte',
    myOrders: 'I miei ordini',
    ordersHint: 'Accedi per vedere qui i tuoi ordini e il tracciamento.',
    signIn: 'Accedi',
    track: 'Traccia il pacco',
    orderDetails: 'Dettagli ordine',
    back: 'Indietro',
    close: 'Chiudi',
    newTitle: 'Nuova richiesta',
    category: 'Argomento',
    categories: { order: 'Ordine', payment: 'Pagamento', shipping: 'Spedizione', returns: 'Resi', sizes: 'Taglie', product: 'Prodotto', account: 'Account', other: 'Altro' },
    order: 'Ordine',
    orderNone: 'Non riguarda un ordine',
    orderClosed: 'Non è possibile inviare richieste per ordini annullati.',
    subject: 'Oggetto',
    subjectPh: 'In poche parole',
    message: 'Messaggio',
    messagePh: 'Raccontaci cosa è successo. Più dettagli ci dai, prima possiamo aiutarti.',
    attach: 'Allega foto o PDF',
    attachHint: 'Fino a 4 file, 4 MB in totale',
    attachTooMany: 'Puoi allegare al massimo 4 file.',
    attachTooBig: 'Gli allegati insieme devono essere sotto i 4 MB.',
    attachType: 'Puoi allegare solo foto (JPEG, PNG, WebP, HEIC) e PDF.',
    remove: 'Rimuovi',
    email: 'Email per la risposta',
    name: 'Il tuo nome',
    optional: 'facoltativo',
    submit: 'Invia richiesta',
    sending: 'Invio…',
    error: 'Impossibile inviare la richiesta. Riprova.',
    required: 'Compila oggetto e messaggio.',
    createdTitle: 'Richiesta ricevuta',
    createdNumber: 'Numero della richiesta',
    createdBody: 'Una conferma è in arrivo a {email}. Risponderemo entro {span}.',
    openConversation: 'Apri la conversazione',
    statuses: { open: 'Aperta', in_progress: 'In lavorazione', waiting_user: 'In attesa di te', resolved: 'Risolta', closed: 'Chiusa' },
    statusHints: {
      open: 'Ricevuta: risponderemo entro {span}.',
      in_progress: 'Il nostro team sta lavorando alla tua richiesta.',
      waiting_user: 'Abbiamo risposto e attendiamo un tuo riscontro.',
      resolved: 'Segnata come risolta. Rispondi se serve altro.',
      closed: 'La richiesta è chiusa.',
    },
    you: 'Tu',
    team: 'Assistenza Luxe Vault',
    replyPh: 'Scrivi una risposta…',
    send: 'Invia',
    closedNote: 'La richiesta è chiusa. Se ti serve altro, aprine una nuova.',
    newRequest: 'Nuova richiesta',
    notFound: 'Impossibile aprire la richiesta. Usa il link della nostra email o accedi con l’account che l’ha inviata.',
    loadError: 'Caricamento non riuscito. Controlla la connessione e riprova.',
    retry: 'Riprova',
    newReply: 'Nuova risposta',
    opened: 'Aperta il {date}',
    orderRef: 'Ordine {id}',
    stillNeedHelp: 'Serve ancora aiuto?',
    orWrite: 'Oppure scrivi a {email}',
    loading: 'Caricamento…',
    noTickets: 'Nessuna richiesta.',
  },
  fr: {
    title: 'Messages au service client',
    heading: 'Comment pouvons-nous vous aider ?',
    honest: 'Le service de conciergerie personnelle Luxe Vault. Nous traitons chaque demande à la main et répondrons à votre e-mail sous {span}.',
    replyWithin: 'Réponse sous {span}',
    searchPlaceholder: 'Rechercher : livraison, retours, tailles…',
    searchEmpty: 'Aucun résultat pour « {q} ».',
    searchEmptyHint: 'Écrivez-nous : une personne vous répondra.',
    topicsTitle: 'Sujets',
    topics: { where: 'Où est ma commande ?', payment: 'Paiement', shipping: 'Livraison', returns: 'Retours', sizes: 'Tailles', product: 'Produit', account: 'Compte' },
    contact: 'Contacter le concierge',
    contactHint: 'Écrivez à notre équipe, photos à l’appui si besoin',
    myTickets: 'Mes demandes',
    viewAll: 'Toutes',
    myOrders: 'Mes commandes',
    ordersHint: 'Connectez-vous pour voir ici vos commandes et leur suivi.',
    signIn: 'Se connecter',
    track: 'Suivre le colis',
    orderDetails: 'Détails de la commande',
    back: 'Retour',
    close: 'Fermer',
    newTitle: 'Nouvelle demande',
    category: 'Sujet',
    categories: { order: 'Commande', payment: 'Paiement', shipping: 'Livraison', returns: 'Retours', sizes: 'Tailles', product: 'Produit', account: 'Compte', other: 'Autre' },
    order: 'Commande',
    orderNone: 'Sans lien avec une commande',
    orderClosed: 'Les demandes concernant des commandes annulées ne sont pas disponibles.',
    subject: 'Objet',
    subjectPh: 'En quelques mots',
    message: 'Message',
    messagePh: 'Expliquez-nous ce qui s’est passé. Plus vous donnez de détails, plus vite nous pourrons vous aider.',
    attach: 'Joindre des photos ou un PDF',
    attachHint: 'Jusqu’à 4 fichiers, 4 Mo au total',
    attachTooMany: 'Vous pouvez joindre 4 fichiers au maximum.',
    attachTooBig: 'Les pièces jointes doivent faire moins de 4 Mo au total.',
    attachType: 'Seules les photos (JPEG, PNG, WebP, HEIC) et les PDF peuvent être joints.',
    remove: 'Retirer',
    email: 'E-mail pour notre réponse',
    name: 'Votre nom',
    optional: 'facultatif',
    submit: 'Envoyer la demande',
    sending: 'Envoi…',
    error: 'Votre demande n’a pas pu être envoyée. Veuillez réessayer.',
    required: 'Veuillez renseigner l’objet et le message.',
    createdTitle: 'Demande reçue',
    createdNumber: 'Numéro de votre demande',
    createdBody: 'Une confirmation arrive à {email}. Nous répondrons sous {span}.',
    openConversation: 'Ouvrir la conversation',
    statuses: { open: 'Ouverte', in_progress: 'En cours', waiting_user: 'En attente de vous', resolved: 'Résolue', closed: 'Fermée' },
    statusHints: {
      open: 'Reçue : nous répondrons sous {span}.',
      in_progress: 'Notre équipe traite votre demande.',
      waiting_user: 'Nous avons répondu et attendons votre retour.',
      resolved: 'Marquée comme résolue. Répondez si quelque chose reste en suspens.',
      closed: 'Cette demande est fermée.',
    },
    you: 'Vous',
    team: 'Service client Luxe Vault',
    replyPh: 'Écrire une réponse…',
    send: 'Envoyer',
    closedNote: 'Cette demande est fermée. Pour toute autre question, ouvrez-en une nouvelle.',
    newRequest: 'Nouvelle demande',
    notFound: 'Impossible d’ouvrir cette demande. Utilisez le lien de notre e-mail ou connectez-vous avec le compte qui l’a envoyée.',
    loadError: 'Chargement impossible. Vérifiez votre connexion et réessayez.',
    retry: 'Réessayer',
    newReply: 'Nouvelle réponse',
    opened: 'Ouverte le {date}',
    orderRef: 'Commande {id}',
    stillNeedHelp: 'Besoin d’aide supplémentaire ?',
    orWrite: 'Ou écrivez à {email}',
    loading: 'Chargement…',
    noTickets: 'Aucune demande.',
  },
  de: {
    title: 'Support-Nachrichten',
    heading: 'Wie können wir Ihnen helfen?',
    honest: 'Der persönliche Concierge-Service von Luxe Vault. Wir bearbeiten jede Anfrage persönlich und antworten Ihnen innerhalb von {span} per E-Mail.',
    replyWithin: 'Antwort innerhalb von {span}',
    searchPlaceholder: 'Hilfe durchsuchen: Versand, Rückgabe, Größen…',
    searchEmpty: 'Keine Ergebnisse für „{q}“.',
    searchEmptyHint: 'Schreiben Sie uns – ein Mensch antwortet.',
    topicsTitle: 'Themen',
    topics: { where: 'Wo ist meine Bestellung?', payment: 'Zahlung', shipping: 'Versand', returns: 'Rückgabe', sizes: 'Größen', product: 'Produkt', account: 'Konto' },
    contact: 'Concierge kontaktieren',
    contactHint: 'Schreiben Sie unserem Team – gern mit Fotos',
    myTickets: 'Meine Anfragen',
    viewAll: 'Alle',
    myOrders: 'Meine Bestellungen',
    ordersHint: 'Melden Sie sich an, um hier Ihre Bestellungen und die Sendungsverfolgung zu sehen.',
    signIn: 'Anmelden',
    track: 'Sendung verfolgen',
    orderDetails: 'Bestelldetails',
    back: 'Zurück',
    close: 'Schließen',
    newTitle: 'Neue Anfrage',
    category: 'Thema',
    categories: { order: 'Bestellung', payment: 'Zahlung', shipping: 'Versand', returns: 'Rückgabe', sizes: 'Größen', product: 'Produkt', account: 'Konto', other: 'Sonstiges' },
    order: 'Bestellung',
    orderNone: 'Keine bestimmte Bestellung',
    orderClosed: 'Anfragen zu stornierten Bestellungen sind nicht möglich.',
    subject: 'Betreff',
    subjectPh: 'In wenigen Worten',
    message: 'Nachricht',
    messagePh: 'Beschreiben Sie, was passiert ist. Je mehr Details, desto schneller können wir helfen.',
    attach: 'Fotos oder PDF anhängen',
    attachHint: 'Bis zu 4 Dateien, insgesamt 4 MB',
    attachTooMany: 'Es können höchstens 4 Dateien angehängt werden.',
    attachTooBig: 'Anhänge dürfen zusammen höchstens 4 MB groß sein.',
    attachType: 'Nur Fotos (JPEG, PNG, WebP, HEIC) und PDF-Dateien können angehängt werden.',
    remove: 'Entfernen',
    email: 'E-Mail für unsere Antwort',
    name: 'Ihr Name',
    optional: 'optional',
    submit: 'Anfrage senden',
    sending: 'Wird gesendet…',
    error: 'Ihre Anfrage konnte nicht gesendet werden. Bitte versuchen Sie es erneut.',
    required: 'Bitte füllen Sie Betreff und Nachricht aus.',
    createdTitle: 'Anfrage erhalten',
    createdNumber: 'Ihre Anfragenummer',
    createdBody: 'Eine Bestätigung ist unterwegs an {email}. Wir antworten innerhalb von {span}.',
    openConversation: 'Unterhaltung öffnen',
    statuses: { open: 'Offen', in_progress: 'In Bearbeitung', waiting_user: 'Wartet auf Sie', resolved: 'Gelöst', closed: 'Geschlossen' },
    statusHints: {
      open: 'Eingegangen – wir antworten innerhalb von {span}.',
      in_progress: 'Unser Team bearbeitet Ihre Anfrage.',
      waiting_user: 'Wir haben geantwortet und warten auf Ihre Rückmeldung.',
      resolved: 'Als gelöst markiert. Antworten Sie, falls noch etwas offen ist.',
      closed: 'Diese Anfrage ist geschlossen.',
    },
    you: 'Sie',
    team: 'Luxe Vault Support',
    replyPh: 'Antwort schreiben…',
    send: 'Senden',
    closedNote: 'Diese Anfrage ist geschlossen. Für weitere Anliegen eröffnen Sie bitte eine neue.',
    newRequest: 'Neue Anfrage',
    notFound: 'Diese Anfrage konnte nicht geöffnet werden. Nutzen Sie den Link aus unserer E-Mail oder melden Sie sich mit dem Konto an, von dem sie gesendet wurde.',
    loadError: 'Laden fehlgeschlagen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    retry: 'Erneut versuchen',
    newReply: 'Neue Antwort',
    opened: 'Eröffnet am {date}',
    orderRef: 'Bestellung {id}',
    stillNeedHelp: 'Noch Fragen?',
    orWrite: 'Oder schreiben Sie an {email}',
    loading: 'Wird geladen…',
    noTickets: 'Noch keine Anfragen.',
  },
}

/** Fills {placeholders}. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m))
}
