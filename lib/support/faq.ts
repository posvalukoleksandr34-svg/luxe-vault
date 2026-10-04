// Help-center answers. Every figure that can change is a {placeholder} filled
// from the live settings at render time — {span} (the admin's delivery
// timeframe), {price} and {amount} (shipping fee and free-shipping threshold),
// {returnDays}, {refund} and {reply} (lib/fulfilment.ts) — so an answer can
// never quote a number the shop no longer uses.
import type { Locale } from '@/lib/types'
import type { SupportTopic } from './copy'

export type FaqEntry = {
  id: string
  topic: SupportTopic
  q: Record<Locale, string>
  a: Record<Locale, string>
}

export const FAQ: FaqEntry[] = [
  {
    id: 'authentic',
    topic: 'product',
    q: {
      en: 'Are your products authentic branded items?',
      ru: 'Ваши товары — оригинальная брендовая продукция?',
      it: 'I vostri prodotti sono articoli di marca originali?',
      fr: 'Vos produits sont-ils des articles de marque authentiques ?',
      de: 'Sind Ihre Produkte echte Markenartikel?',
    },
    a: {
      en: 'No. We sell replicas and designer-inspired pieces. They are not made, sold or authorised by the brands they reference, and we are not affiliated with any brand owner. Every product page says so.',
      ru: 'Нет. Мы продаём реплики и вещи, вдохновлённые дизайнерскими моделями. Они не произведены, не продаются и не одобрены брендами, на которые ссылаются, и мы не связаны ни с одним правообладателем. Это указано на странице каждого товара.',
      it: 'No. Vendiamo repliche e articoli ispirati a modelli di designer. Non sono prodotti, venduti né autorizzati dai marchi a cui si ispirano, e non siamo affiliati ad alcun titolare di marchio. Ogni pagina prodotto lo indica.',
      fr: 'Non. Nous vendons des répliques et des pièces inspirées de créateurs. Elles ne sont ni fabriquées, ni vendues, ni autorisées par les marques auxquelles elles font référence, et nous ne sommes affiliés à aucun titulaire de marque. Chaque fiche produit l’indique.',
      de: 'Nein. Wir verkaufen Replikate und von Designern inspirierte Stücke. Sie werden von den Marken, auf die sie sich beziehen, weder hergestellt noch verkauft oder autorisiert, und wir sind mit keinem Markeninhaber verbunden. Das steht auf jeder Produktseite.',
    },
  },
  {
    id: 'ship-from',
    topic: 'shipping',
    q: {
      en: 'Where do orders ship from?',
      ru: 'Откуда отправляются заказы?',
      it: 'Da dove partono gli ordini?',
      fr: 'D’où partent les commandes ?',
      de: 'Von wo werden Bestellungen versandt?',
    },
    a: {
      en: 'From Switzerland, with Swiss Post. When your parcel is dispatched, we email you its tracking number.',
      ru: 'Из Швейцарии, Швейцарской почтой. Когда посылка отправлена, мы присылаем трек-номер по email.',
      it: 'Dalla Svizzera, con la Posta Svizzera. Quando il pacco parte, ti inviamo via email il numero di tracciamento.',
      fr: 'De Suisse, avec La Poste suisse. Dès l’expédition, nous vous envoyons le numéro de suivi par e-mail.',
      de: 'Aus der Schweiz, mit der Schweizerischen Post. Sobald Ihr Paket unterwegs ist, senden wir Ihnen die Sendungsnummer per E-Mail.',
    },
  },
  {
    id: 'after-order',
    topic: 'where',
    q: {
      en: 'What happens after I place an order?',
      ru: 'Что происходит после оформления заказа?',
      it: 'Cosa succede dopo aver effettuato un ordine?',
      fr: 'Que se passe-t-il après ma commande ?',
      de: 'Was passiert nach meiner Bestellung?',
    },
    a: {
      en: 'You receive an email confirmation with your order number. We prepare and check your order, ship it with Swiss Post and email you the tracking number. Your order page shows each step as it happens.',
      ru: 'Вы получаете письмо с подтверждением и номером заказа. Мы готовим и проверяем заказ, отправляем его Швейцарской почтой и присылаем трек-номер по email. На странице заказа видно каждый этап.',
      it: 'Ricevi un’email di conferma con il numero d’ordine. Prepariamo e controlliamo l’ordine, lo spediamo con la Posta Svizzera e ti inviamo via email il numero di tracciamento. La pagina dell’ordine mostra ogni passaggio.',
      fr: 'Vous recevez un e-mail de confirmation avec votre numéro de commande. Nous préparons et contrôlons la commande, l’expédions avec La Poste suisse et vous envoyons le numéro de suivi par e-mail. La page de votre commande montre chaque étape.',
      de: 'Sie erhalten eine Bestätigung mit Ihrer Bestellnummer per E-Mail. Wir bereiten Ihre Bestellung vor, prüfen sie, versenden sie mit der Schweizerischen Post und schicken Ihnen die Sendungsnummer per E-Mail. Ihre Bestellseite zeigt jeden Schritt.',
    },
  },
  {
    id: 'lost',
    topic: 'shipping',
    q: {
      en: 'What if my parcel is lost?',
      ru: 'Что делать, если посылка потерялась?',
      it: 'E se il mio pacco si perde?',
      fr: 'Que faire si mon colis est perdu ?',
      de: 'Was, wenn mein Paket verloren geht?',
    },
    a: {
      en: 'If tracking has not moved for a while, write to us with your order number. We open a search request with Swiss Post and keep you informed until it is resolved.',
      ru: 'Если статус отслеживания давно не меняется, напишите нам и укажите номер заказа. Мы откроем розыск в Швейцарской почте и будем держать вас в курсе до решения вопроса.',
      it: 'Se il tracciamento è fermo da tempo, scrivici con il numero d’ordine. Apriamo una richiesta di ricerca presso la Posta Svizzera e ti teniamo aggiornato fino alla soluzione.',
      fr: 'Si le suivi n’évolue plus depuis un moment, écrivez-nous avec votre numéro de commande. Nous ouvrons une demande de recherche auprès de La Poste suisse et vous tenons informé jusqu’à la résolution.',
      de: 'Bewegt sich die Sendungsverfolgung länger nicht, schreiben Sie uns mit Ihrer Bestellnummer. Wir stellen einen Nachforschungsauftrag bei der Schweizerischen Post und halten Sie bis zur Klärung auf dem Laufenden.',
    },
  },
  {
    id: 'contact',
    topic: 'account',
    q: {
      en: 'How do I contact support?',
      ru: 'Как связаться с поддержкой?',
      it: 'Come contatto l’assistenza?',
      fr: 'Comment contacter le service client ?',
      de: 'Wie erreiche ich den Kundenservice?',
    },
    a: {
      en: 'Use the contact form, email support@luxe-vault.store or message @luxevault_orders on Telegram. A person reads every message and replies within {reply}.',
      ru: 'Через форму обратной связи, по email support@luxe-vault.store или в Telegram @luxevault_orders. Каждое сообщение читает человек; ответ — в течение {reply}.',
      it: 'Usa il modulo di contatto, scrivi a support@luxe-vault.store o su Telegram a @luxevault_orders. Ogni messaggio è letto da una persona; rispondiamo entro {reply}.',
      fr: 'Utilisez le formulaire de contact, écrivez à support@luxe-vault.store ou à @luxevault_orders sur Telegram. Chaque message est lu par une personne ; nous répondons sous {reply}.',
      de: 'Über das Kontaktformular, per E-Mail an support@luxe-vault.store oder auf Telegram an @luxevault_orders. Jede Nachricht liest ein Mensch; wir antworten innerhalb von {reply}.',
    },
  },
  {
    id: 'track',
    topic: 'where',
    q: {
      en: 'How do I track my order?',
      ru: 'Как отследить заказ?',
      it: 'Come traccio il mio ordine?',
      fr: 'Comment suivre ma commande ?',
      de: 'Wie verfolge ich meine Bestellung?',
    },
    a: {
      en: 'When your parcel leaves us, we email you its tracking number with a link to the carrier. You can follow it under My Orders below, or on the order page linked from your confirmation email.',
      ru: 'Когда посылка покидает нас, мы присылаем по email трек-номер со ссылкой на сайт перевозчика. Отслеживать её можно в разделе «Мои заказы» ниже или на странице заказа по ссылке из письма-подтверждения.',
      it: 'Quando il pacco parte, ti inviamo via email il numero di tracciamento con il link al corriere. Puoi seguirlo in «I miei ordini» qui sotto o nella pagina dell’ordine indicata nell’email di conferma.',
      fr: 'Dès que votre colis part, nous vous envoyons par e-mail son numéro de suivi avec un lien vers le transporteur. Vous pouvez le suivre dans « Mes commandes » ci-dessous ou sur la page de commande indiquée dans l’e-mail de confirmation.',
      de: 'Sobald Ihr Paket bei uns abgeht, senden wir Ihnen die Sendungsnummer mit einem Link zum Versanddienst per E-Mail. Sie können es unten unter „Meine Bestellungen“ verfolgen oder auf der Bestellseite aus Ihrer Bestätigungs-E-Mail.',
    },
  },
  {
    id: 'not-shipped',
    topic: 'where',
    q: {
      en: 'My order has not shipped yet. Is that normal?',
      ru: 'Заказ ещё не отправлен. Это нормально?',
      it: 'Il mio ordine non è ancora partito. È normale?',
      fr: 'Ma commande n’est pas encore expédiée. Est-ce normal ?',
      de: 'Meine Bestellung wurde noch nicht versandt. Ist das normal?',
    },
    a: {
      en: 'Yes. Each piece is sourced and quality-checked for your order before it is dispatched, so the tracking number can take a while to appear. The estimated delivery time is {span}. If it has been longer, write to us with your order number.',
      ru: 'Да. Каждое изделие мы заказываем и проверяем под ваш заказ перед отправкой, поэтому трек-номер появляется не сразу. Ориентировочный срок доставки — {span}. Если прошло больше, напишите нам и укажите номер заказа.',
      it: 'Sì. Ogni capo viene procurato e controllato per il tuo ordine prima della spedizione, quindi il numero di tracciamento può richiedere un po’ di tempo. Il tempo di consegna stimato è {span}. Se è passato di più, scrivici indicando il numero d’ordine.',
      fr: 'Oui. Chaque pièce est approvisionnée et contrôlée pour votre commande avant l’expédition : le numéro de suivi peut donc mettre un peu de temps à apparaître. Le délai de livraison estimé est de {span}. Au-delà, écrivez-nous avec votre numéro de commande.',
      de: 'Ja. Jedes Stück wird für Ihre Bestellung beschafft und geprüft, bevor es versandt wird – die Sendungsnummer kann daher etwas dauern. Die geschätzte Lieferzeit beträgt {span}. Dauert es länger, schreiben Sie uns mit Ihrer Bestellnummer.',
    },
  },
  {
    id: 'methods',
    topic: 'payment',
    q: {
      en: 'Which payment methods do you accept?',
      ru: 'Какие способы оплаты вы принимаете?',
      it: 'Quali metodi di pagamento accettate?',
      fr: 'Quels moyens de paiement acceptez-vous ?',
      de: 'Welche Zahlungsarten akzeptieren Sie?',
    },
    a: {
      en: 'Bank cards through Stripe — with Apple Pay and Google Pay where your device supports them — and cryptocurrency. Every order is paid in full at checkout.',
      ru: 'Банковские карты через Stripe — а также Apple Pay и Google Pay, если их поддерживает ваше устройство, — и криптовалюту. Каждый заказ оплачивается полностью при оформлении.',
      it: 'Carte bancarie tramite Stripe, con Apple Pay e Google Pay se il tuo dispositivo li supporta, e criptovalute. Ogni ordine si paga per intero al momento dell’acquisto.',
      fr: 'Les cartes bancaires via Stripe — avec Apple Pay et Google Pay si votre appareil les prend en charge — et les cryptomonnaies. Chaque commande est réglée intégralement à la validation.',
      de: 'Bankkarten über Stripe – mit Apple Pay und Google Pay, sofern Ihr Gerät sie unterstützt – sowie Kryptowährungen. Jede Bestellung wird beim Abschluss vollständig bezahlt.',
    },
  },
  {
    id: 'failed',
    topic: 'payment',
    q: {
      en: 'My payment did not go through. What now?',
      ru: 'Оплата не прошла. Что делать?',
      it: 'Il pagamento non è andato a buon fine. E ora?',
      fr: 'Mon paiement n’est pas passé. Que faire ?',
      de: 'Meine Zahlung ist fehlgeschlagen. Was nun?',
    },
    a: {
      en: 'Your order is saved and nothing is charged for a failed attempt. You can pay again from the order page or from My Orders. If your card was charged but the order still shows as unpaid, write to us with the order number.',
      ru: 'Заказ сохранён, за неудачную попытку ничего не списывается. Оплатить повторно можно на странице заказа или в разделе «Мои заказы». Если деньги списались, а заказ по-прежнему не оплачен, напишите нам с номером заказа.',
      it: 'L’ordine è salvato e per un tentativo fallito non viene addebitato nulla. Puoi pagare di nuovo dalla pagina dell’ordine o da «I miei ordini». Se la carta è stata addebitata ma l’ordine risulta ancora non pagato, scrivici con il numero d’ordine.',
      fr: 'Votre commande est enregistrée et une tentative échouée n’est pas débitée. Vous pouvez payer à nouveau depuis la page de commande ou « Mes commandes ». Si votre carte a été débitée mais que la commande apparaît toujours impayée, écrivez-nous avec le numéro de commande.',
      de: 'Ihre Bestellung ist gespeichert, und ein fehlgeschlagener Versuch wird nicht belastet. Sie können auf der Bestellseite oder unter „Meine Bestellungen“ erneut bezahlen. Wurde Ihre Karte belastet, die Bestellung aber weiterhin als unbezahlt angezeigt, schreiben Sie uns mit der Bestellnummer.',
    },
  },
  {
    id: 'currency',
    topic: 'payment',
    q: {
      en: 'In which currency am I charged?',
      ru: 'В какой валюте списывается оплата?',
      it: 'In quale valuta vengo addebitato?',
      fr: 'Dans quelle devise suis-je débité ?',
      de: 'In welcher Währung werde ich belastet?',
    },
    a: {
      en: 'Card payments are charged in the currency you choose on the site; cryptocurrency payments are priced in CHF.',
      ru: 'Оплата картой списывается в валюте, выбранной на сайте; оплата криптовалютой рассчитывается в CHF.',
      it: 'I pagamenti con carta sono addebitati nella valuta scelta sul sito; quelli in criptovaluta sono calcolati in CHF.',
      fr: 'Les paiements par carte sont débités dans la devise choisie sur le site ; les paiements en cryptomonnaie sont calculés en CHF.',
      de: 'Kartenzahlungen werden in der auf der Website gewählten Währung belastet; Krypto-Zahlungen werden in CHF berechnet.',
    },
  },
  {
    id: 'cost',
    topic: 'shipping',
    q: {
      en: 'How much does shipping cost?',
      ru: 'Сколько стоит доставка?',
      it: 'Quanto costa la spedizione?',
      fr: 'Combien coûte la livraison ?',
      de: 'Was kostet der Versand?',
    },
    a: {
      en: 'Standard shipping is {price}, and free on orders from {amount}.',
      ru: 'Стандартная доставка — {price}, бесплатно для заказов от {amount}.',
      it: 'La spedizione standard costa {price} ed è gratuita per ordini da {amount}.',
      fr: 'La livraison standard coûte {price} et est offerte dès {amount} d’achat.',
      de: 'Der Standardversand kostet {price} und ist ab einem Bestellwert von {amount} kostenlos.',
    },
  },
  {
    id: 'time',
    topic: 'shipping',
    q: {
      en: 'How long does delivery take?',
      ru: 'Сколько идёт доставка?',
      it: 'Quanto tempo richiede la consegna?',
      fr: 'Quel est le délai de livraison ?',
      de: 'Wie lange dauert die Lieferung?',
    },
    a: {
      en: 'The estimated delivery time is {span}, depending on the region. Each product page also shows its own estimate.',
      ru: 'Ориентировочный срок — {span} в зависимости от региона. На странице каждого товара указан и его собственный срок.',
      it: 'Il tempo stimato è {span}, a seconda della zona. Ogni pagina prodotto indica anche la propria stima.',
      fr: 'Le délai estimé est de {span}, selon la région. Chaque fiche produit indique aussi sa propre estimation.',
      de: 'Die geschätzte Lieferzeit beträgt {span}, je nach Region. Jede Produktseite nennt zudem ihre eigene Schätzung.',
    },
  },
  {
    id: 'where',
    topic: 'shipping',
    q: {
      en: 'Where do you deliver?',
      ru: 'Куда вы доставляете?',
      it: 'Dove spedite?',
      fr: 'Où livrez-vous ?',
      de: 'Wohin liefern Sie?',
    },
    a: {
      en: 'We ship from Switzerland with Swiss Post to every country you can select at checkout. Swiss Post occasionally suspends service to some destinations, so if you are unsure about yours, write to us before ordering.',
      ru: 'Мы отправляем из Швейцарии Швейцарской почтой во все страны, доступные при оформлении заказа. Иногда почта приостанавливает доставку в отдельные страны — если сомневаетесь, напишите нам до заказа.',
      it: 'Spediamo dalla Svizzera con la Posta Svizzera in tutti i paesi selezionabili al checkout. A volte la Posta sospende il servizio verso alcune destinazioni: se hai dubbi sulla tua, scrivici prima di ordinare.',
      fr: 'Nous expédions depuis la Suisse avec La Poste suisse vers tous les pays proposés lors du paiement. La Poste suspend parfois le service vers certaines destinations : en cas de doute, écrivez-nous avant de commander.',
      de: 'Wir versenden aus der Schweiz mit der Schweizerischen Post in alle Länder, die an der Kasse wählbar sind. Die Post setzt den Dienst in einzelne Länder gelegentlich aus – sind Sie unsicher, schreiben Sie uns vor der Bestellung.',
    },
  },
  {
    id: 'return-window',
    topic: 'returns',
    q: {
      en: 'Can I return an item?',
      ru: 'Можно ли вернуть товар?',
      it: 'Posso restituire un articolo?',
      fr: 'Puis-je retourner un article ?',
      de: 'Kann ich einen Artikel zurückgeben?',
    },
    a: {
      en: 'Yes. You can withdraw within {returnDays} days of receiving your order, without giving a reason. An item that has been worn or comes back without its tags may be refunded at a reduced amount for the loss of value.',
      ru: 'Да. Отказаться от покупки можно в течение {returnDays} дней с момента получения заказа, без объяснения причин. За ношеное изделие или изделие без бирок сумма возврата может быть уменьшена на потерю стоимости.',
      it: 'Sì. Puoi recedere entro {returnDays} giorni dalla ricezione dell’ordine, senza indicare un motivo. Per un articolo indossato o restituito senza etichette il rimborso può essere ridotto per la perdita di valore.',
      fr: 'Oui. Vous pouvez vous rétracter dans les {returnDays} jours suivant la réception, sans donner de motif. Pour un article porté ou renvoyé sans ses étiquettes, le remboursement peut être réduit en raison de la perte de valeur.',
      de: 'Ja. Sie können innerhalb von {returnDays} Tagen nach Erhalt ohne Angabe von Gründen zurücktreten. Bei einem getragenen Artikel oder einem ohne Etiketten kann die Erstattung um den Wertverlust gekürzt werden.',
    },
  },
  {
    id: 'return-how',
    topic: 'returns',
    q: {
      en: 'How do I start a return?',
      ru: 'Как оформить возврат?',
      it: 'Come avvio un reso?',
      fr: 'Comment lancer un retour ?',
      de: 'Wie starte ich eine Rückgabe?',
    },
    a: {
      en: 'Open a request under “Returns”, choose the order and tell us which item it is — photos help. We reply with the return instructions.',
      ru: 'Создайте обращение в теме «Возврат», выберите заказ и укажите, какое изделие хотите вернуть, — фото помогут. Мы ответим с инструкцией по возврату.',
      it: 'Apri una richiesta in «Resi», scegli l’ordine e indicaci l’articolo: le foto aiutano. Ti risponderemo con le istruzioni per il reso.',
      fr: 'Ouvrez une demande dans « Retours », choisissez la commande et indiquez l’article — des photos aident. Nous vous répondrons avec les instructions de retour.',
      de: 'Eröffnen Sie eine Anfrage unter „Rückgabe“, wählen Sie die Bestellung und nennen Sie den Artikel – Fotos helfen. Wir antworten mit der Anleitung zur Rücksendung.',
    },
  },
  {
    id: 'refund',
    topic: 'returns',
    q: {
      en: 'When will I get my refund?',
      ru: 'Когда вернутся деньги?',
      it: 'Quando riceverò il rimborso?',
      fr: 'Quand serai-je remboursé ?',
      de: 'Wann erhalte ich meine Erstattung?',
    },
    a: {
      en: 'We refund to the original payment method once the item has been inspected. Banks usually take {refund} to show it on your statement.',
      ru: 'Мы возвращаем деньги на исходный способ оплаты после проверки изделия. Банку обычно нужно {refund}, чтобы средства отразились на счёте.',
      it: 'Rimborsiamo sul metodo di pagamento originale dopo il controllo dell’articolo. Di solito la banca impiega {refund} per mostrarlo sull’estratto conto.',
      fr: 'Nous remboursons sur le moyen de paiement d’origine après contrôle de l’article. Les banques mettent généralement {refund} à l’afficher sur votre relevé.',
      de: 'Wir erstatten auf die ursprüngliche Zahlungsart, sobald der Artikel geprüft wurde. Banken brauchen meist {refund}, bis der Betrag auf Ihrem Konto erscheint.',
    },
  },
  {
    id: 'size-choose',
    topic: 'sizes',
    q: {
      en: 'How do I choose my size?',
      ru: 'Как выбрать размер?',
      it: 'Come scelgo la taglia?',
      fr: 'Comment choisir ma taille ?',
      de: 'Wie wähle ich meine Größe?',
    },
    a: {
      en: 'Each product page has a size guide with that piece’s own measurements in centimetres. For letter sizes, the fit advisor suggests one from your height and weight.',
      ru: 'На странице товара есть таблица размеров с замерами именно этого изделия в сантиметрах. Для буквенных размеров помощник по посадке подскажет размер по росту и весу.',
      it: 'Ogni pagina prodotto ha una guida alle taglie con le misure di quel capo in centimetri. Per le taglie in lettere, il consulente di vestibilità ne suggerisce una in base ad altezza e peso.',
      fr: 'Chaque fiche produit propose un guide des tailles avec les mesures de la pièce en centimètres. Pour les tailles en lettres, le conseiller de coupe en suggère une selon votre taille et votre poids.',
      de: 'Jede Produktseite hat eine Größentabelle mit den Maßen genau dieses Stücks in Zentimetern. Bei Buchstabengrößen schlägt der Passform-Berater eine Größe nach Körpergröße und Gewicht vor.',
    },
  },
  {
    id: 'size-sold-out',
    topic: 'sizes',
    q: {
      en: 'My size is sold out.',
      ru: 'Моего размера нет в наличии.',
      it: 'La mia taglia è esaurita.',
      fr: 'Ma taille est épuisée.',
      de: 'Meine Größe ist ausverkauft.',
    },
    a: {
      en: 'Stock is kept separately for every size and colour. Select your size and choose “Notify me” — we email you when it is back.',
      ru: 'Остаток ведётся отдельно для каждого размера и цвета. Выберите свой размер и нажмите «Сообщить о поступлении» — мы напишем, когда он появится.',
      it: 'Le scorte sono gestite separatamente per ogni taglia e colore. Seleziona la tua taglia e scegli «Avvisami»: ti scriveremo quando torna disponibile.',
      fr: 'Le stock est suivi séparément pour chaque taille et couleur. Sélectionnez votre taille et choisissez « Me prévenir » : nous vous écrirons à son retour.',
      de: 'Der Bestand wird für jede Größe und Farbe getrennt geführt. Wählen Sie Ihre Größe und „Benachrichtigen“ – wir schreiben Ihnen, sobald sie wieder da ist.',
    },
  },
  {
    id: 'availability',
    topic: 'product',
    q: {
      en: 'How do I know an item is in stock?',
      ru: 'Как понять, есть ли товар в наличии?',
      it: 'Come so se un articolo è disponibile?',
      fr: 'Comment savoir si un article est en stock ?',
      de: 'Woran erkenne ich, ob ein Artikel vorrätig ist?',
    },
    a: {
      en: 'The product page shows availability for the size and colour you select. A struck-through size is sold out, and you cannot add more to your cart than is available.',
      ru: 'На странице товара наличие показано для выбранных размера и цвета. Зачёркнутый размер закончился, а добавить в корзину больше доступного количества нельзя.',
      it: 'La pagina prodotto mostra la disponibilità per taglia e colore selezionati. Una taglia barrata è esaurita e non puoi aggiungere al carrello più di quanto disponibile.',
      fr: 'La fiche produit indique la disponibilité pour la taille et la couleur choisies. Une taille barrée est épuisée, et vous ne pouvez pas ajouter au panier plus que le stock disponible.',
      de: 'Die Produktseite zeigt die Verfügbarkeit für die gewählte Größe und Farbe. Eine durchgestrichene Größe ist ausverkauft, und Sie können nicht mehr in den Warenkorb legen, als vorrätig ist.',
    },
  },
  {
    id: 'defect',
    topic: 'product',
    q: {
      en: 'My item arrived damaged or is not what I ordered.',
      ru: 'Изделие пришло повреждённым или не тем, что я заказывал.',
      it: 'Il mio articolo è arrivato danneggiato o non è quello ordinato.',
      fr: 'Mon article est arrivé endommagé ou ne correspond pas à ma commande.',
      de: 'Mein Artikel kam beschädigt an oder ist nicht der bestellte.',
    },
    a: {
      en: 'Tell us within {returnDays} days of delivery: open a request under “Product” in the help centre or write to us, and attach photos of the item and its label. A damaged, faulty or wrong item is replaced or refunded in full, including postage both ways. We reply within {reply}.',
      ru: 'Сообщите нам в течение {returnDays} дней после получения: создайте обращение в теме «Товар» в центре помощи или напишите нам и приложите фото изделия и бирки. Повреждённое, бракованное или не то изделие мы заменим или вернём полную стоимость вместе с доставкой в обе стороны. Мы ответим в течение {reply}.',
      it: 'Segnalacelo entro {returnDays} giorni dalla consegna: apri una richiesta in «Prodotto» nel centro assistenza o scrivici, allegando foto dell’articolo e dell’etichetta. Un articolo danneggiato, difettoso o sbagliato viene sostituito o rimborsato per intero, spedizione andata e ritorno compresa. Rispondiamo entro {reply}.',
      fr: 'Signalez-le dans les {returnDays} jours suivant la livraison : ouvrez une demande « Produit » dans le centre d’aide ou écrivez-nous, avec des photos de l’article et de son étiquette. Un article endommagé, défectueux ou erroné est remplacé ou remboursé intégralement, port aller et retour compris. Nous répondons sous {reply}.',
      de: 'Melden Sie es innerhalb von {returnDays} Tagen nach der Lieferung: über eine Anfrage unter „Produkt“ im Hilfe-Center oder per E-Mail, mit Fotos des Artikels und seines Etiketts. Ein beschädigter, fehlerhafter oder falscher Artikel wird ersetzt oder voll erstattet, inklusive Porto für Hin- und Rückweg. Wir antworten innerhalb von {reply}.',
    },
  },
  {
    id: 'guest',
    topic: 'account',
    q: {
      en: 'Do I need an account to order?',
      ru: 'Нужен ли аккаунт для заказа?',
      it: 'Serve un account per ordinare?',
      fr: 'Faut-il un compte pour commander ?',
      de: 'Brauche ich ein Konto zum Bestellen?',
    },
    a: {
      en: 'No — you can check out as a guest. An account keeps your orders, addresses and saved cards in one place.',
      ru: 'Нет — можно оформить заказ как гость. Аккаунт хранит заказы, адреса и сохранённые карты в одном месте.',
      it: 'No, puoi acquistare come ospite. Un account raccoglie ordini, indirizzi e carte salvate in un unico posto.',
      fr: 'Non, vous pouvez commander en tant qu’invité. Un compte réunit vos commandes, adresses et cartes enregistrées.',
      de: 'Nein – Sie können als Gast bestellen. Ein Konto bündelt Bestellungen, Adressen und gespeicherte Karten.',
    },
  },
  {
    id: 'password',
    topic: 'account',
    q: {
      en: 'I forgot my password.',
      ru: 'Я забыл пароль.',
      it: 'Ho dimenticato la password.',
      fr: 'J’ai oublié mon mot de passe.',
      de: 'Ich habe mein Passwort vergessen.',
    },
    a: {
      en: 'Choose “Forgot password” when signing in and we email you a code to set a new one. If you signed up with Google, sign in with Google instead.',
      ru: 'Нажмите «Забыли пароль?» при входе — мы пришлём код для нового пароля. Если вы регистрировались через Google, войдите через Google.',
      it: 'Scegli «Password dimenticata» all’accesso: ti inviamo un codice per impostarne una nuova. Se ti sei registrato con Google, accedi con Google.',
      fr: 'Choisissez « Mot de passe oublié » à la connexion : nous vous envoyons un code pour en définir un nouveau. Si vous vous êtes inscrit avec Google, connectez-vous avec Google.',
      de: 'Wählen Sie bei der Anmeldung „Passwort vergessen“ – wir senden Ihnen einen Code für ein neues Passwort. Wenn Sie sich mit Google registriert haben, melden Sie sich mit Google an.',
    },
  },
]

/** Words that should find an answer although the answer does not use them. */
const ALIASES: Record<string, string[]> = {
  track: ['tracking', 'трек', 'отслед', 'tracciam', 'suivi', 'sendungs'],
  refund: ['money', 'деньги', 'rimborso', 'rembours', 'geld'],
  cost: ['price', 'free', 'цена', 'бесплат', 'gratis', 'gratuit', 'kostenlos'],
  password: ['login', 'sign in', 'войти', 'пароль', 'accesso', 'connexion', 'anmeld'],
}

/** Entries whose question, answer (as shown, placeholders filled) or aliases
 *  contain every word typed. */
export function searchFaq(
  entries: FaqEntry[],
  locale: Locale,
  query: string,
  answer: (e: FaqEntry) => string,
): FaqEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1)
  if (words.length === 0) return []
  return entries.filter((e) => {
    const hay = `${e.q[locale]} ${answer(e)} ${(ALIASES[e.id] ?? []).join(' ')}`.toLowerCase()
    return words.every((w) => hay.indexOf(w) !== -1)
  })
}
