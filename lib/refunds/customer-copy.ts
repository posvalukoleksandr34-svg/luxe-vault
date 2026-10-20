import type { Locale } from '@/lib/types'

/**
 * What a customer is told when their request moves — the email and the
 * in-app notification say the same thing, in the customer's language.
 *
 * Never a risk level, an internal note or a staff member's name. A rejection
 * or partial approval carries the decision note staff wrote FOR the customer
 * (decision_note), and only that.
 */

export const CUSTOMER_EVENTS = [
  'created',
  'info_requested',
  'return_authorized',
  'return_received',
  'approved',
  'rejected',
  'refund_sent',
  'refunded',
  'partially_refunded',
  'resolved',
  'cancelled',
  'expired',
  'message',
  'appeal_received',
  'reopened',
] as const
export type CustomerEvent = (typeof CUSTOMER_EVENTS)[number]

type Line = { title: (n: string) => string; body: string }

export type CaseCopy = {
  events: Record<CustomerEvent, Line>
  caseLabel: string
  orderLabel: string
  amountLabel: string
  noteLabel: string
  deadlineLabel: string
  cta: string
}

export const CASE_COPY: Record<Locale, CaseCopy> = {
  en: {
    events: {
      created: { title: (n) => `We received your request ${n}`, body: 'A member of our team will review it — usually within two business days. You can follow it in your account.' },
      info_requested: { title: (n) => `We need a little more information — ${n}`, body: 'Please answer from your account so we can continue.' },
      return_authorized: { title: (n) => `Please send the item back — ${n}`, body: 'Your return is authorised. The instructions are below and in your account; add the tracking number once the parcel is on its way.' },
      return_received: { title: (n) => `Your return has arrived — ${n}`, body: 'We have received the parcel and are inspecting it.' },
      approved: { title: (n) => `Your request ${n} is approved`, body: 'We will process it shortly and let you know when the money is on its way.' },
      rejected: { title: (n) => `We could not accept request ${n}`, body: 'Our team reviewed it carefully. The reason is below. You may ask for a review once, from your account.' },
      refund_sent: { title: (n) => `Your refund is being processed — ${n}`, body: 'The refund has been sent to your original payment method. Banks usually take 5–10 business days to show it.' },
      refunded: { title: (n) => `Your refund is complete — ${n}`, body: 'The money has been returned to your original payment method.' },
      partially_refunded: { title: (n) => `Part of your request has been refunded — ${n}`, body: 'Part of the amount you asked for has been returned to your original payment method. The explanation is below.' },
      resolved: { title: (n) => `Your request ${n} is resolved`, body: 'Your replacement or new shipment is on its way.' },
      cancelled: { title: (n) => `Request ${n} is closed`, body: 'The request has been withdrawn or closed. If this is unexpected, reply to this email.' },
      expired: { title: (n) => `Request ${n} has expired`, body: 'We did not hear back in time, so the request was closed. Contact us if you still need help.' },
      message: { title: (n) => `New message about request ${n}`, body: 'Our team has written to you. Read and reply from your account.' },
      appeal_received: { title: (n) => `We will review request ${n} again`, body: 'Your request for a review has been received. A team member will look at it again.' },
      reopened: { title: (n) => `Request ${n} has been reopened`, body: 'Our team is looking at your request again.' },
    },
    caseLabel: 'Request',
    orderLabel: 'Order',
    amountLabel: 'Amount',
    noteLabel: 'From our team',
    deadlineLabel: 'Please respond by',
    cta: 'View request',
  },
  it: {
    events: {
      created: { title: (n) => `Abbiamo ricevuto la richiesta ${n}`, body: 'Un membro del team la esaminerà, di solito entro due giorni lavorativi. Puoi seguirla dal tuo account.' },
      info_requested: { title: (n) => `Ci servono altre informazioni — ${n}`, body: 'Rispondi dal tuo account così possiamo procedere.' },
      return_authorized: { title: (n) => `Rispedisci l’articolo — ${n}`, body: 'Il reso è autorizzato. Le istruzioni sono qui sotto e nel tuo account; aggiungi il numero di tracciamento quando il pacco è partito.' },
      return_received: { title: (n) => `Il reso è arrivato — ${n}`, body: 'Abbiamo ricevuto il pacco e lo stiamo controllando.' },
      approved: { title: (n) => `La richiesta ${n} è approvata`, body: 'La elaboreremo a breve e ti avviseremo quando il rimborso sarà in arrivo.' },
      rejected: { title: (n) => `Non abbiamo potuto accettare la richiesta ${n}`, body: 'Il nostro team l’ha esaminata con attenzione. Il motivo è qui sotto. Puoi chiedere un riesame una volta, dal tuo account.' },
      refund_sent: { title: (n) => `Il rimborso è in corso — ${n}`, body: 'Il rimborso è stato inviato al metodo di pagamento originale. Le banche impiegano di solito 5–10 giorni lavorativi.' },
      refunded: { title: (n) => `Rimborso completato — ${n}`, body: 'L’importo è stato restituito al metodo di pagamento originale.' },
      partially_refunded: { title: (n) => `Parte della richiesta è stata rimborsata — ${n}`, body: 'Una parte dell’importo richiesto è stata restituita al metodo di pagamento originale. La spiegazione è qui sotto.' },
      resolved: { title: (n) => `La richiesta ${n} è risolta`, body: 'La sostituzione o la nuova spedizione è in arrivo.' },
      cancelled: { title: (n) => `La richiesta ${n} è chiusa`, body: 'La richiesta è stata ritirata o chiusa. Se non te lo aspettavi, rispondi a questa email.' },
      expired: { title: (n) => `La richiesta ${n} è scaduta`, body: 'Non abbiamo ricevuto risposta in tempo e la richiesta è stata chiusa. Contattaci se ti serve ancora aiuto.' },
      message: { title: (n) => `Nuovo messaggio sulla richiesta ${n}`, body: 'Il nostro team ti ha scritto. Leggi e rispondi dal tuo account.' },
      appeal_received: { title: (n) => `Riesamineremo la richiesta ${n}`, body: 'Abbiamo ricevuto la tua richiesta di riesame. Un membro del team la esaminerà di nuovo.' },
      reopened: { title: (n) => `La richiesta ${n} è stata riaperta`, body: 'Il nostro team sta riesaminando la tua richiesta.' },
    },
    caseLabel: 'Richiesta',
    orderLabel: 'Ordine',
    amountLabel: 'Importo',
    noteLabel: 'Dal nostro team',
    deadlineLabel: 'Rispondi entro',
    cta: 'Vedi la richiesta',
  },
  fr: {
    events: {
      created: { title: (n) => `Nous avons reçu votre demande ${n}`, body: 'Un membre de l’équipe l’examinera, généralement sous deux jours ouvrés. Vous pouvez la suivre depuis votre compte.' },
      info_requested: { title: (n) => `Il nous faut quelques précisions — ${n}`, body: 'Répondez depuis votre compte pour que nous puissions continuer.' },
      return_authorized: { title: (n) => `Merci de renvoyer l’article — ${n}`, body: 'Votre retour est autorisé. Les instructions figurent ci-dessous et dans votre compte ; ajoutez le numéro de suivi une fois le colis expédié.' },
      return_received: { title: (n) => `Votre retour est arrivé — ${n}`, body: 'Nous avons reçu le colis et le contrôlons.' },
      approved: { title: (n) => `Votre demande ${n} est acceptée`, body: 'Nous la traitons sous peu et vous préviendrons dès que le remboursement sera en route.' },
      rejected: { title: (n) => `Nous n’avons pas pu accepter la demande ${n}`, body: 'Notre équipe l’a examinée attentivement. Le motif figure ci-dessous. Vous pouvez demander un réexamen une fois, depuis votre compte.' },
      refund_sent: { title: (n) => `Votre remboursement est en cours — ${n}`, body: 'Le remboursement a été envoyé sur votre moyen de paiement d’origine. Les banques mettent en général 5 à 10 jours ouvrés à l’afficher.' },
      refunded: { title: (n) => `Remboursement effectué — ${n}`, body: 'Le montant a été restitué sur votre moyen de paiement d’origine.' },
      partially_refunded: { title: (n) => `Une partie de votre demande a été remboursée — ${n}`, body: 'Une partie du montant demandé a été restituée sur votre moyen de paiement d’origine. L’explication figure ci-dessous.' },
      resolved: { title: (n) => `Votre demande ${n} est résolue`, body: 'Votre remplacement ou nouvel envoi est en route.' },
      cancelled: { title: (n) => `La demande ${n} est close`, body: 'La demande a été retirée ou close. Si cela vous surprend, répondez à cet e-mail.' },
      expired: { title: (n) => `La demande ${n} a expiré`, body: 'Faute de réponse à temps, la demande a été close. Contactez-nous si vous avez encore besoin d’aide.' },
      message: { title: (n) => `Nouveau message concernant la demande ${n}`, body: 'Notre équipe vous a écrit. Lisez et répondez depuis votre compte.' },
      appeal_received: { title: (n) => `Nous allons réexaminer la demande ${n}`, body: 'Votre demande de réexamen a bien été reçue. Un membre de l’équipe va la reprendre.' },
      reopened: { title: (n) => `La demande ${n} a été rouverte`, body: 'Notre équipe réexamine votre demande.' },
    },
    caseLabel: 'Demande',
    orderLabel: 'Commande',
    amountLabel: 'Montant',
    noteLabel: 'De notre équipe',
    deadlineLabel: 'Merci de répondre avant le',
    cta: 'Voir la demande',
  },
  de: {
    events: {
      created: { title: (n) => `Wir haben Ihre Anfrage ${n} erhalten`, body: 'Ein Teammitglied prüft sie – in der Regel innerhalb von zwei Werktagen. Sie können sie in Ihrem Konto verfolgen.' },
      info_requested: { title: (n) => `Wir benötigen weitere Angaben – ${n}`, body: 'Bitte antworten Sie in Ihrem Konto, damit wir weitermachen können.' },
      return_authorized: { title: (n) => `Bitte senden Sie den Artikel zurück – ${n}`, body: 'Ihre Rücksendung ist freigegeben. Die Anleitung steht unten und in Ihrem Konto; tragen Sie die Sendungsnummer ein, sobald das Paket unterwegs ist.' },
      return_received: { title: (n) => `Ihre Rücksendung ist angekommen – ${n}`, body: 'Wir haben das Paket erhalten und prüfen es.' },
      approved: { title: (n) => `Ihre Anfrage ${n} ist genehmigt`, body: 'Wir bearbeiten sie in Kürze und melden uns, sobald das Geld unterwegs ist.' },
      rejected: { title: (n) => `Wir konnten Anfrage ${n} nicht annehmen`, body: 'Unser Team hat sie sorgfältig geprüft. Den Grund finden Sie unten. Sie können einmal eine erneute Prüfung in Ihrem Konto verlangen.' },
      refund_sent: { title: (n) => `Ihre Erstattung wird bearbeitet – ${n}`, body: 'Die Erstattung wurde an Ihre ursprüngliche Zahlungsmethode gesendet. Banken brauchen meist 5–10 Werktage, bis sie sichtbar ist.' },
      refunded: { title: (n) => `Erstattung abgeschlossen – ${n}`, body: 'Der Betrag wurde auf Ihre ursprüngliche Zahlungsmethode zurückgezahlt.' },
      partially_refunded: { title: (n) => `Ein Teil Ihrer Anfrage wurde erstattet – ${n}`, body: 'Ein Teil des beantragten Betrags wurde auf Ihre ursprüngliche Zahlungsmethode zurückgezahlt. Die Erklärung steht unten.' },
      resolved: { title: (n) => `Ihre Anfrage ${n} ist erledigt`, body: 'Ihr Ersatz bzw. Ihre neue Sendung ist unterwegs.' },
      cancelled: { title: (n) => `Anfrage ${n} ist geschlossen`, body: 'Die Anfrage wurde zurückgezogen oder geschlossen. Falls das unerwartet ist, antworten Sie auf diese E-Mail.' },
      expired: { title: (n) => `Anfrage ${n} ist abgelaufen`, body: 'Wir haben nicht rechtzeitig von Ihnen gehört, daher wurde die Anfrage geschlossen. Melden Sie sich, wenn Sie noch Hilfe brauchen.' },
      message: { title: (n) => `Neue Nachricht zu Anfrage ${n}`, body: 'Unser Team hat Ihnen geschrieben. Lesen und antworten Sie in Ihrem Konto.' },
      appeal_received: { title: (n) => `Wir prüfen Anfrage ${n} erneut`, body: 'Ihr Antrag auf erneute Prüfung ist eingegangen. Ein Teammitglied sieht sich die Anfrage noch einmal an.' },
      reopened: { title: (n) => `Anfrage ${n} wurde wieder geöffnet`, body: 'Unser Team prüft Ihre Anfrage erneut.' },
    },
    caseLabel: 'Anfrage',
    orderLabel: 'Bestellung',
    amountLabel: 'Betrag',
    noteLabel: 'Von unserem Team',
    deadlineLabel: 'Bitte antworten Sie bis',
    cta: 'Anfrage ansehen',
  },
  ru: {
    events: {
      created: { title: (n) => `Мы получили вашу заявку ${n}`, body: 'Сотрудник рассмотрит её — обычно в течение двух рабочих дней. Следить за заявкой можно в личном кабинете.' },
      info_requested: { title: (n) => `Нужны дополнительные сведения — ${n}`, body: 'Пожалуйста, ответьте в личном кабинете, чтобы мы могли продолжить.' },
      return_authorized: { title: (n) => `Отправьте товар обратно — ${n}`, body: 'Возврат разрешён. Инструкция ниже и в личном кабинете; добавьте трек-номер, когда посылка будет отправлена.' },
      return_received: { title: (n) => `Возврат получен — ${n}`, body: 'Мы получили посылку и проверяем её.' },
      approved: { title: (n) => `Заявка ${n} одобрена`, body: 'Скоро мы её обработаем и сообщим, когда деньги будут отправлены.' },
      rejected: { title: (n) => `Мы не смогли принять заявку ${n}`, body: 'Команда внимательно её рассмотрела. Причина указана ниже. Один раз можно попросить пересмотр в личном кабинете.' },
      refund_sent: { title: (n) => `Возврат средств в обработке — ${n}`, body: 'Деньги отправлены на исходный способ оплаты. Банки обычно зачисляют их за 5–10 рабочих дней.' },
      refunded: { title: (n) => `Возврат выполнен — ${n}`, body: 'Деньги возвращены на исходный способ оплаты.' },
      partially_refunded: { title: (n) => `Часть суммы возвращена — ${n}`, body: 'Часть запрошенной суммы возвращена на исходный способ оплаты. Объяснение ниже.' },
      resolved: { title: (n) => `Заявка ${n} решена`, body: 'Замена или повторная отправка уже в пути.' },
      cancelled: { title: (n) => `Заявка ${n} закрыта`, body: 'Заявка отозвана или закрыта. Если это неожиданно — ответьте на это письмо.' },
      expired: { title: (n) => `Срок заявки ${n} истёк`, body: 'Мы не получили ответа вовремя, и заявка закрыта. Напишите нам, если помощь всё ещё нужна.' },
      message: { title: (n) => `Новое сообщение по заявке ${n}`, body: 'Команда написала вам. Прочитайте и ответьте в личном кабинете.' },
      appeal_received: { title: (n) => `Мы пересмотрим заявку ${n}`, body: 'Запрос на пересмотр получен. Сотрудник рассмотрит заявку ещё раз.' },
      reopened: { title: (n) => `Заявка ${n} снова открыта`, body: 'Команда снова рассматривает вашу заявку.' },
    },
    caseLabel: 'Заявка',
    orderLabel: 'Заказ',
    amountLabel: 'Сумма',
    noteLabel: 'От нашей команды',
    deadlineLabel: 'Ответьте до',
    cta: 'Открыть заявку',
  },
}

export function caseCopy(locale: string | undefined): CaseCopy {
  return CASE_COPY[(locale as Locale) in CASE_COPY ? (locale as Locale) : 'en']
}
