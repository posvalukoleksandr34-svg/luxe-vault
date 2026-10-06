import type { LegalDocSet } from './types'

const SUPPORT = 'support@luxe-vault.store'

/**
 * The Privacy Policy. Written from what the code actually does — every
 * processor, data category and period below is traced to the code in
 * docs/compliance/audit-2026-10-04.md. Change the code, change this.
 *
 * The seller's identity is not repeated here: section 1 points to the
 * Imprint, which renders it from config/business.ts. Nothing in this text is
 * a placeholder; facts only the operator can supply are configured there.
 */
export const PRIVACY: LegalDocSet = {
  ru: {
    title: 'Политика конфиденциальности',
    description: 'Какие персональные данные собирает Luxe Vault, зачем, кому передаёт, как долго хранит и как их удалить.',
    effective: 'Действует с 6 октября 2026 года',
    sections: [
      {
        h: '1. Кто отвечает за ваши данные',
        blocks: [
          { p: 'Ответственное лицо (контролёр) — частное лицо, проживающее в Цюрихе (Швейцария) и продающее вещи под названием Luxe Vault. Имя и контактные данные указаны в [Импрессуме](/legal/imprint).' },
          { p: `Контакт по вопросам данных: [${SUPPORT}](mailto:${SUPPORT}).` },
          { p: 'Применяется швейцарский Федеральный закон о защите данных (nFADP). Поскольку товары предлагаются покупателям в ЕС/ЕЭЗ, к их данным дополнительно применяется GDPR. Представитель в ЕС по ст. 27 GDPR не назначен: по любым вопросам о данных обращайтесь напрямую к продавцу.' },
        ],
      },
      {
        h: '2. Какие данные собираются и откуда',
        blocks: [
          { ul: [
            '**Аккаунт:** имя, email, пароль (хранится только в виде необратимого хэша у провайдера входа), язык. При входе через Google — имя и email из аккаунта Google.',
            '**Заказ и доставка:** имя и фамилия, email, телефон, адрес доставки, состав и сумма заказа, способ оплаты, статусы оплаты и доставки, трек-номер.',
            '**Оплата картой:** вводится напрямую в защищённую форму Stripe — номер карты, срок и CVC мы **никогда** не получаем. Мы видим только тип карты и последние четыре цифры. Сохранение карты — только по вашему выбору.',
            '**Оплата криптовалютой:** NOWPayments получает номер заказа и сумму. Адрес кошелька и транзакция видны в публичном блокчейне.',
            '**Подсказки адреса:** набранный текст адреса отправляется сервису подсказок (Photon, при настройке — Google Places), чтобы предложить варианты.',
            '**Обращения в поддержку:** тема, текст, приложенные файлы, имя и email, номер заказа, если вы его укажете.',
            '**Чат-ассистент:** ваши сообщения. Если вы спрашиваете о заказе — номер, статус, позиции и даты заказа (без адреса и контактов).',
            '**Поиск:** поисковый запрос; при включённом «умном поиске» он передаётся ИИ Google Gemini.',
            '**Отзывы:** имя, оценка и текст — публикуются после проверки.',
            '**Рассылка:** email, язык, время согласия и подтверждения. Подписка начинается только после подтверждения по ссылке из письма.',
            '**Напоминание о корзине:** email и состав корзины — только если вы отметили «Напомнить мне» при оформлении.',
            '**Уведомления о поступлении и лист ожидания:** email, товар, размер и цвет.',
            '**Реферальная программа (завершена в октябре 2026 года):** если вы в ней участвовали — ваш код, количество переходов по ссылке (без данных о посетителях), приглашённые заказы и начисленные бонусы. Новые данные не собираются; записи хранятся для бухгалтерского учёта выплат и удаляются вместе с аккаунтом.',
            '**Технические данные:** IP-адрес (для ограничения числа запросов — хранится не дольше суток), журналы сервера, отчёты об ошибках и нарушениях политики безопасности (адреса страниц в них очищаются от ключей доступа).',
            '**На вашем устройстве:** корзина, избранное, настройки, по вашему выбору — данные для оформления заказа. Подробно — в [Политике cookie](/legal/cookies).',
          ] },
          { p: 'Мы **не** собираем дату рождения, документы, удостоверяющие личность, и данные о местоположении устройства. Мерки из помощника по размеру (рост, вес) остаются только на вашем устройстве.' },
        ],
      },
      {
        h: '3. Цели и правовые основания',
        blocks: [
          { ul: [
            '**Исполнение договора** (ст. 6(1)(b) GDPR): аккаунт, заказ, оплата, доставка, возвраты, поддержка, ответы ассистента о заказе.',
            '**Согласие** (ст. 6(1)(a)): рассылка, напоминание о корзине, аналитика и маркетинговые cookie, сохранение карты и данных для оформления. Отзывается в любой момент, без влияния на законность прежней обработки.',
            '**Законный интерес** (ст. 6(1)(f)): защита от мошенничества и злоупотреблений (ограничение запросов, CAPTCHA, журналы), публикация проверенных отзывов.',
            '**Юридическая обязанность** (ст. 6(1)(c)): хранение записей о продажах.',
          ] },
          { p: 'Автоматизированных решений, влекущих для вас правовые последствия, не принимается. Ответы чат-ассистента — справка, а не решение по вашему заказу.' },
        ],
      },
      {
        h: '4. Кому передаются данные',
        blocks: [
          { p: 'Данные не продаются. Их получают только перечисленные ниже исполнители — в объёме, нужном для их задачи:' },
          { ul: [
            '**Vercel Inc.** (США) — хостинг сайта; серверы приложения в Дублине (ЕС). Все запросы, IP-адрес, журналы.',
            '**Cloudflare Inc.** (США) — доставка контента, защита от атак, CAPTCHA Turnstile в формах. Все запросы и IP-адрес.',
            '**Supabase Inc.** (США) — база данных, вход в аккаунт, хранение файлов.',
            '**Stripe** (Stripe Payments Europe Ltd., Ирландия) — оплата картой и хранение сохранённых карт: сумма, email для чека, при сохранении карты — имя и email.',
            '**NOWPayments** — оплата криптовалютой: номер заказа и сумма.',
            '**Resend Inc.** (США) — отправка писем: адрес и содержание письма.',
            '**Google** (Google Ireland Ltd. / Google LLC) — ИИ Gemini (сообщения чата, поисковые запросы), подсказки адреса Google Places (если настроены), вход через Google (если вы его выбрали), Google Analytics (только с согласием).',
            '**komoot GmbH** (Германия), сервис Photon — подсказки адреса: набранный текст адреса.',
            '**Meta Platforms Ireland Ltd.** — пиксель Meta, только с согласием на маркетинговые cookie.',
            '**Telegram** — служебные уведомления продавцу: при оплаченном заказе — имя, email, телефон, адрес и состав заказа; при смене статуса — номер заказа и имя; о возврате — номер заказа, причина и комментарий.',
            '**Швейцарская почта и почтовая служба страны назначения** — имя и адрес получателя для доставки.',
            '**Облачное хранилище резервных копий** (S3-совместимое) — копии базы данных, зашифрованные до отправки, так что провайдер не может их прочитать.',
          ] },
          { p: 'Передача в США и другие страны без решения об адекватности основана на рамке EU–US / Swiss–US Data Privacy Framework (если провайдер сертифицирован), а иначе — на стандартных договорных условиях Европейской комиссии.' },
        ],
      },
      {
        h: '5. Сроки хранения',
        blocks: [
          { ul: [
            'Заказы, их позиции и запросы на возврат — 5 лет с даты продажи (общий срок исковой давности, ст. 128 Обязательственного права), затем удаляются автоматически.',
            'Аккаунт — пока вы его не удалите. Удаление — сразу (см. раздел 6).',
            'Обращения в поддержку и вложения — 24 месяца после закрытия, затем удаляются автоматически.',
            'Рассылка — до отписки; неподтверждённая подписка удаляется через 30 дней. После отписки хранится только отметка об отказе, чтобы больше не писать.',
            'Напоминание о корзине — не более 7 дней ожидания; запись удаляется через 30 дней после завершения. Отказ от напоминаний сохраняется, чтобы больше не писать.',
            'Записи ограничения запросов (IP-адреса) — до 1 суток. Платёжные события Stripe — 90 дней. Защита от мошенничества с картами: после нескольких неудачных попыток оплаты или отказа банка по признакам мошенничества email и IP-адрес (в зашифрованном виде, HMAC) не могут платить картой 24 часа или 30 дней соответственно; затем запись удаляется. Stripe также проверяет каждый платёж своей системой Radar.',
            'Выбор по cookie — 12 месяцев, затем мы спрашиваем снова.',
            'Резервные копии — до 90 дней; удалённые данные исчезают из них по истечении этого срока.',
            'Сообщения в служебном Telegram-чате хранятся, пока продавец их не удалит; автоматически они не удаляются.',
          ] },
        ],
      },
      {
        h: '6. Ваши права',
        blocks: [
          { p: 'Вы можете запросить доступ к своим данным и их копию, исправление, удаление, ограничение обработки, возражение против неё и перенос данных в машиночитаемом виде, а также отозвать согласие.' },
          { ul: [
            '**Удаление аккаунта** — сами, в аккаунте: «Настройки» → «Удалить мой аккаунт». Удаляются аккаунт, профиль, адреса, сохранённые карты (у Stripe), избранное, образы, уведомления, отзывы, реферальный код и баланс, подписка и уведомления о поступлении. Заказы, возвраты и обращения остаются без привязки к аккаунту на сроки из раздела 5; их удаления раньше срока можно попросить письмом — мы ответим, что можем удалить, а что обязаны хранить.',
            '**Отписка от рассылки** — по ссылке в каждом письме, без входа в аккаунт.',
            '**Cookie** — «Настройки cookie» внизу любой страницы.',
            `**Всё остальное** — письмом на [${SUPPORT}](mailto:${SUPPORT}). Ответ — в течение 30 дней.`,
          ] },
          { p: 'Вы вправе подать жалобу в Федеральную службу по защите данных и информации Швейцарии (EDÖB/PFPDT) или в надзорный орган по защите данных вашей страны в ЕС/ЕЭЗ.' },
        ],
      },
      {
        h: '7. Cookie и хранилище браузера',
        blocks: [
          { p: 'Необходимые cookie (вход, оплата, защита) работают всегда. Аналитика (Google Analytics) и маркетинг (пиксель Meta) загружаются только после вашего согласия и не получают адреса страниц, содержащих ключи доступа. Полный список — в [Политике cookie](/legal/cookies).' },
        ],
      },
      {
        h: '8. Безопасность',
        blocks: [
          { p: 'Данные передаются только по HTTPS. Доступ к базе ограничен правилами на уровне строк, служебные таблицы доступны только серверу. Данные карт обрабатывает Stripe (PCI DSS) — к нам они не попадают. Вход в панель продавца защищён паролем и вторым фактором. Резервные копии шифруются до отправки. Никакая защита не абсолютна; о серьёзной утечке, затрагивающей вас, мы сообщим.' },
        ],
      },
      {
        h: '9. Дети',
        blocks: [
          { p: 'Сайт не предназначен для лиц младше 16 лет, и мы сознательно не собираем их данные. Если такие данные были переданы, напишите нам — мы их удалим.' },
        ],
      },
      {
        h: '10. Изменения',
        blocks: [
          { p: 'Действующая версия всегда на этой странице, с датой вступления в силу. О существенных изменениях сообщим по email или баннером на сайте.' },
        ],
      },
    ],
  },

  en: {
    title: 'Privacy Policy',
    description: 'What personal data Luxe Vault collects, why, who receives it, how long it is kept and how to delete it.',
    effective: 'In force since 6 October 2026',
    sections: [
      {
        h: '1. Who is responsible for your data',
        blocks: [
          { p: 'The controller is a private individual resident in Zurich, Switzerland, selling under the name Luxe Vault. Their name and contact details are given in the [Imprint](/legal/imprint).' },
          { p: `Contact for data questions: [${SUPPORT}](mailto:${SUPPORT}).` },
          { p: 'The Swiss Federal Act on Data Protection (nFADP) applies. Because goods are offered to buyers in the EU/EEA, the GDPR also applies to their data. No EU representative under Art. 27 GDPR has been appointed: please contact the seller directly about anything concerning your data.' },
        ],
      },
      {
        h: '2. What data is collected, and where from',
        blocks: [
          { ul: [
            '**Account:** name, email address, password (held only as an irreversible hash by the sign-in provider), language. With Google sign-in: the name and email of your Google account.',
            '**Orders and delivery:** first and last name, email, phone, delivery address, items and total, payment method, payment and delivery status, tracking number.',
            '**Card payments:** entered directly into Stripe\'s secure form — we **never** receive the card number, expiry or CVC. We see only the card brand and last four digits. A card is saved only if you choose to save it.',
            '**Crypto payments:** NOWPayments receives the order number and amount. Wallet addresses and transactions are visible on the public blockchain.',
            '**Address suggestions:** the address text you type is sent to a suggestion service (Photon, or Google Places where configured) to offer matches.',
            '**Support requests:** subject, message, attachments, name and email, and an order number if you give one.',
            '**Chat assistant:** your messages. If you ask about an order — its number, status, items and dates (not your address or contact details).',
            '**Search:** your search terms; with "smart search" enabled they are sent to Google\'s Gemini AI.',
            '**Reviews:** name, rating and text — published after moderation.',
            '**Newsletter:** email, language, when you consented and confirmed. The subscription starts only once you confirm it with the link we email you.',
            '**Cart reminder:** your email and the cart\'s contents — only if you ticked "Email me one reminder" at checkout.',
            '**Stock alerts and waitlist:** email, product, size and colour.',
            '**Referral programme (ended October 2026):** if you took part — your code, how many visits came through your link (nothing about the visitors), referred orders and the bonus earned. Nothing new is collected; the records are kept to account for rewards paid and are deleted with your account.',
            '**Technical data:** IP address (for rate limiting — kept no longer than one day), server logs, error and security-policy reports (page addresses in them are stripped of access keys).',
            '**On your device:** cart, wishlist, preferences and, if you choose, your checkout details. Details in the [Cookie Policy](/legal/cookies).',
          ] },
          { p: 'We do **not** collect dates of birth, identity documents or device location. Measurements entered in the size advisor (height, weight) stay on your device.' },
        ],
      },
      {
        h: '3. Purposes and legal bases',
        blocks: [
          { ul: [
            '**Performance of a contract** (Art. 6(1)(b) GDPR): your account, orders, payment, delivery, returns, support, the assistant\'s answers about your order.',
            '**Consent** (Art. 6(1)(a)): newsletter, cart reminder, analytics and marketing cookies, saving a card or checkout details. You can withdraw it at any time; earlier processing stays lawful.',
            '**Legitimate interest** (Art. 6(1)(f)): preventing fraud and abuse (rate limits, CAPTCHA, logs), publishing moderated reviews.',
            '**Legal obligation** (Art. 6(1)(c)): keeping records of sales.',
          ] },
          { p: 'No decision with legal effect on you is made by automated means. The chat assistant\'s answers are information, not decisions about your order.' },
        ],
      },
      {
        h: '4. Who receives data',
        blocks: [
          { p: 'Personal data is never sold. Only the providers below receive it, each only what its task needs:' },
          { ul: [
            '**Vercel Inc.** (USA) — hosting; application servers in Dublin (EU). All requests, IP address, logs.',
            '**Cloudflare Inc.** (USA) — content delivery, attack protection, the Turnstile CAPTCHA on forms. All requests and IP address.',
            '**Supabase Inc.** (USA) — database, sign-in, file storage.',
            '**Stripe** (Stripe Payments Europe Ltd., Ireland) — card payments and saved cards: amount, email for the receipt, and name and email when a card is saved.',
            '**NOWPayments** — crypto payments: order number and amount.',
            '**Resend Inc.** (USA) — sending email: the address and the message.',
            '**Google** (Google Ireland Ltd. / Google LLC) — Gemini AI (chat messages, search terms), Google Places address suggestions (where configured), Google sign-in (if you use it), Google Analytics (only with consent).',
            '**komoot GmbH** (Germany), Photon service — address suggestions: the address text you type.',
            '**Meta Platforms Ireland Ltd.** — the Meta Pixel, only with consent to marketing cookies.',
            '**Telegram** — internal notifications to the seller: for a paid order, name, email, phone, address and items; for a status change, the order number and first name; for a return, the order number, reason and comment.',
            '**Swiss Post and the destination country\'s postal service** — recipient name and address, for delivery.',
            '**Cloud backup storage** (S3-compatible) — copies of the database, encrypted before upload so the provider cannot read them.',
          ] },
          { p: 'Transfers to the USA and other countries without an adequacy decision rely on the EU–US / Swiss–US Data Privacy Framework where the provider is certified, and otherwise on the European Commission\'s standard contractual clauses.' },
        ],
      },
      {
        h: '5. How long data is kept',
        blocks: [
          { ul: [
            'Orders, their items and return requests — 5 years from the sale (the general limitation period, Art. 128 Swiss Code of Obligations), then deleted automatically.',
            'Account — until you delete it. Deletion is immediate (see section 6).',
            'Support requests and attachments — 24 months after they are closed, then deleted automatically.',
            'Newsletter — until you unsubscribe; an unconfirmed sign-up is deleted after 30 days. After unsubscribing, only a record of the opt-out is kept, so that we do not write again.',
            'Cart reminder — waits no more than 7 days; the record is deleted 30 days after it ends. An opt-out from reminders is kept, so that we do not write again.',
            'Rate-limit records (IP addresses) — up to 1 day. Stripe payment events — 90 days. Card-fraud protection: after several failed card attempts, or a decline the bank marks as fraud, the email address and IP address (pseudonymised with an HMAC) are refused card payments for 24 hours or 30 days respectively; the record is then deleted. Stripe also screens every payment with its Radar system.',
            'Your cookie choice — 12 months, then we ask again.',
            'Backups — up to 90 days; deleted data leaves them when that period ends.',
            'Messages in the seller\'s internal Telegram chat stay until the seller deletes them; they are not deleted automatically.',
          ] },
        ],
      },
      {
        h: '6. Your rights',
        blocks: [
          { p: 'You can ask for access to your data and a copy of it, correction, erasure, restriction of processing, objection to it, and portability in a machine-readable format, and you can withdraw consent.' },
          { ul: [
            '**Delete your account** yourself: Account → Settings → "Delete my account". This deletes the account, profile, addresses, saved cards (at Stripe), wishlist, saved looks, notifications, reviews, referral code and credit, newsletter subscription and stock alerts. Orders, returns and support requests are kept, no longer linked to an account, for the periods in section 5; you can ask by email for them to be erased sooner, and we will tell you what we can delete and what we must keep.',
            '**Unsubscribe** from the newsletter with the link in every email — no account needed.',
            '**Cookies** — "Cookie settings" at the foot of every page.',
            `**Anything else** — email [${SUPPORT}](mailto:${SUPPORT}). You will get an answer within 30 days.`,
          ] },
          { p: 'You may complain to the Swiss Federal Data Protection and Information Commissioner (FDPIC) or to the data protection authority of your country in the EU/EEA.' },
        ],
      },
      {
        h: '7. Cookies and browser storage',
        blocks: [
          { p: 'Strictly necessary cookies (sign-in, payment, security) are always on. Analytics (Google Analytics) and marketing (the Meta Pixel) load only after you consent, and never receive the address of a page that carries an access key. The full list is in the [Cookie Policy](/legal/cookies).' },
        ],
      },
      {
        h: '8. Security',
        blocks: [
          { p: 'Data travels only over HTTPS. Database access is restricted by row-level rules, and internal tables are reachable by the server alone. Card data is handled by Stripe (PCI DSS) and never reaches us. The seller\'s console requires a password and a second factor. Backups are encrypted before upload. No protection is absolute; if a serious breach affects you, you will be told.' },
        ],
      },
      {
        h: '9. Children',
        blocks: [
          { p: 'The site is not intended for anyone under 16, and we do not knowingly collect their data. If such data has been provided, write to us and it will be deleted.' },
        ],
      },
      {
        h: '10. Changes',
        blocks: [
          { p: 'The current version is always on this page, with its date. You will be told of material changes by email or by a notice on the site.' },
        ],
      },
    ],
  },

  it: {
    title: 'Informativa sulla privacy',
    description: 'Quali dati personali raccoglie Luxe Vault, perché, chi li riceve, per quanto tempo li conserva e come cancellarli.',
    effective: 'In vigore dal 6 ottobre 2026',
    sections: [
      {
        h: '1. Chi è responsabile dei tuoi dati',
        blocks: [
          { p: 'Il titolare del trattamento è una persona privata residente a Zurigo (Svizzera) che vende con il nome Luxe Vault. Nome e recapiti sono indicati nelle [Note legali](/legal/imprint).' },
          { p: `Contatto per le questioni sui dati: [${SUPPORT}](mailto:${SUPPORT}).` },
          { p: 'Si applica la Legge federale svizzera sulla protezione dei dati (nLPD). Poiché i prodotti sono offerti ad acquirenti nell\'UE/SEE, ai loro dati si applica anche il GDPR. Non è stato nominato un rappresentante nell\'UE ai sensi dell\'art. 27 GDPR: per qualsiasi questione sui tuoi dati contatta direttamente il venditore.' },
        ],
      },
      {
        h: '2. Quali dati vengono raccolti e da dove',
        blocks: [
          { ul: [
            '**Account:** nome, indirizzo email, password (conservata solo come hash irreversibile dal fornitore di accesso), lingua. Con l\'accesso Google: nome ed email del tuo account Google.',
            '**Ordini e consegna:** nome e cognome, email, telefono, indirizzo di consegna, articoli e totale, metodo di pagamento, stato di pagamento e consegna, numero di tracciamento.',
            '**Pagamento con carta:** inserito direttamente nel modulo sicuro di Stripe — **non** riceviamo mai numero, scadenza o CVC. Vediamo solo il circuito e le ultime quattro cifre. Una carta viene salvata solo se scegli di salvarla.',
            '**Pagamento in criptovaluta:** NOWPayments riceve numero d\'ordine e importo. Indirizzi del wallet e transazioni sono visibili sulla blockchain pubblica.',
            '**Suggerimenti di indirizzo:** il testo dell\'indirizzo che digiti viene inviato a un servizio di suggerimenti (Photon o, se configurato, Google Places).',
            '**Richieste di assistenza:** oggetto, messaggio, allegati, nome ed email, e il numero d\'ordine se lo indichi.',
            '**Assistente in chat:** i tuoi messaggi. Se chiedi di un ordine — numero, stato, articoli e date (non indirizzo né contatti).',
            '**Ricerca:** i termini cercati; con la «ricerca intelligente» attiva vengono inviati all\'IA Gemini di Google.',
            '**Recensioni:** nome, valutazione e testo — pubblicati dopo la moderazione.',
            '**Newsletter:** email, lingua, data del consenso e della conferma. L\'iscrizione parte solo dopo la conferma tramite il link che ti inviamo.',
            '**Promemoria del carrello:** email e contenuto del carrello — solo se hai spuntato «Inviami un solo promemoria» al checkout.',
            '**Avvisi di disponibilità e lista d\'attesa:** email, prodotto, taglia e colore.',
            '**Programma referral (concluso a ottobre 2026):** se vi hai partecipato — il tuo codice, quante visite sono arrivate dal tuo link (nulla sui visitatori), gli ordini segnalati e il bonus maturato. Non raccogliamo nuovi dati; i record sono conservati per la contabilità dei premi pagati e vengono cancellati insieme all’account.',
            '**Dati tecnici:** indirizzo IP (per limitare le richieste — conservato al massimo un giorno), log del server, segnalazioni di errori e di violazioni della politica di sicurezza (gli indirizzi delle pagine vengono ripuliti dalle chiavi di accesso).',
            '**Sul tuo dispositivo:** carrello, preferiti, impostazioni e, se lo scegli, i dati per il checkout. Dettagli nella [Cookie Policy](/legal/cookies).',
          ] },
          { p: '**Non** raccogliamo date di nascita, documenti d\'identità né la posizione del dispositivo. Le misure inserite nel consulente taglie (altezza, peso) restano sul tuo dispositivo.' },
        ],
      },
      {
        h: '3. Finalità e basi giuridiche',
        blocks: [
          { ul: [
            '**Esecuzione del contratto** (art. 6(1)(b) GDPR): account, ordini, pagamento, consegna, resi, assistenza, risposte dell\'assistente sul tuo ordine.',
            '**Consenso** (art. 6(1)(a)): newsletter, promemoria del carrello, cookie di analisi e di marketing, salvataggio della carta o dei dati di checkout. Revocabile in qualsiasi momento; il trattamento precedente resta lecito.',
            '**Legittimo interesse** (art. 6(1)(f)): prevenzione di frodi e abusi (limiti di richieste, CAPTCHA, log), pubblicazione di recensioni moderate.',
            '**Obbligo legale** (art. 6(1)(c)): conservazione delle registrazioni delle vendite.',
          ] },
          { p: 'Nessuna decisione con effetti giuridici nei tuoi confronti viene presa in modo automatizzato. Le risposte dell\'assistente sono informazioni, non decisioni sul tuo ordine.' },
        ],
      },
      {
        h: '4. Chi riceve i dati',
        blocks: [
          { p: 'I dati personali non vengono mai venduti. Li ricevono solo i fornitori elencati, ciascuno solo per quanto serve al suo compito:' },
          { ul: [
            '**Vercel Inc.** (USA) — hosting; server applicativi a Dublino (UE). Tutte le richieste, indirizzo IP, log.',
            '**Cloudflare Inc.** (USA) — distribuzione dei contenuti, protezione dagli attacchi, CAPTCHA Turnstile nei moduli. Tutte le richieste e indirizzo IP.',
            '**Supabase Inc.** (USA) — database, accesso, archiviazione dei file.',
            '**Stripe** (Stripe Payments Europe Ltd., Irlanda) — pagamenti con carta e carte salvate: importo, email per la ricevuta e, se salvi una carta, nome ed email.',
            '**NOWPayments** — pagamenti in criptovaluta: numero d\'ordine e importo.',
            '**Resend Inc.** (USA) — invio delle email: indirizzo e messaggio.',
            '**Google** (Google Ireland Ltd. / Google LLC) — IA Gemini (messaggi della chat, termini di ricerca), suggerimenti di indirizzo Google Places (se configurati), accesso con Google (se lo usi), Google Analytics (solo con consenso).',
            '**komoot GmbH** (Germania), servizio Photon — suggerimenti di indirizzo: il testo che digiti.',
            '**Meta Platforms Ireland Ltd.** — il pixel di Meta, solo con consenso ai cookie di marketing.',
            '**Telegram** — notifiche interne al venditore: per un ordine pagato, nome, email, telefono, indirizzo e articoli; per un cambio di stato, numero d\'ordine e nome; per un reso, numero d\'ordine, motivo e commento.',
            '**La Posta Svizzera e il servizio postale del paese di destinazione** — nome e indirizzo del destinatario, per la consegna.',
            '**Archiviazione cloud dei backup** (compatibile S3) — copie del database, cifrate prima dell\'invio, così che il fornitore non possa leggerle.',
          ] },
          { p: 'I trasferimenti verso gli USA e altri paesi senza decisione di adeguatezza si basano sull\'EU–US / Swiss–US Data Privacy Framework se il fornitore è certificato, altrimenti sulle clausole contrattuali tipo della Commissione europea.' },
        ],
      },
      {
        h: '5. Per quanto tempo conserviamo i dati',
        blocks: [
          { ul: [
            'Ordini, relativi articoli e richieste di reso — 5 anni dalla vendita (termine generale di prescrizione, art. 128 CO), poi cancellati automaticamente.',
            'Account — finché non lo elimini. L\'eliminazione è immediata (vedi sezione 6).',
            'Richieste di assistenza e allegati — 24 mesi dalla chiusura, poi cancellati automaticamente.',
            'Newsletter — fino alla disiscrizione; un\'iscrizione non confermata viene cancellata dopo 30 giorni. Dopo la disiscrizione resta solo la registrazione del rifiuto, per non scriverti più.',
            'Promemoria del carrello — attende al massimo 7 giorni; il record viene cancellato 30 giorni dopo la fine. Il rifiuto dei promemoria viene conservato, per non scriverti più.',
            'Record dei limiti di richieste (indirizzi IP) — fino a 1 giorno. Eventi di pagamento Stripe — 90 giorni. Protezione dalle frodi con carta: dopo diversi tentativi di pagamento falliti, o un rifiuto che la banca segnala come frode, l\'indirizzo email e l\'indirizzo IP (pseudonimizzato con HMAC) non possono pagare con carta per 24 ore o 30 giorni rispettivamente; poi il record viene cancellato. Stripe controlla inoltre ogni pagamento con il suo sistema Radar.',
            'La tua scelta sui cookie — 12 mesi, poi te la chiediamo di nuovo.',
            'Backup — fino a 90 giorni; i dati cancellati ne escono alla scadenza.',
            'I messaggi nella chat Telegram interna del venditore restano finché il venditore non li cancella; non vengono cancellati automaticamente.',
          ] },
        ],
      },
      {
        h: '6. I tuoi diritti',
        blocks: [
          { p: 'Puoi chiedere l\'accesso ai tuoi dati e una copia, la rettifica, la cancellazione, la limitazione del trattamento, l\'opposizione e la portabilità in formato leggibile da macchina, e puoi revocare il consenso.' },
          { ul: [
            '**Elimina l\'account** da solo: Account → Impostazioni → «Elimina il mio account». Vengono cancellati account, profilo, indirizzi, carte salvate (presso Stripe), preferiti, look salvati, notifiche, recensioni, codice e credito referral, iscrizione alla newsletter e avvisi di disponibilità. Ordini, resi e richieste di assistenza restano, non più collegati a un account, per i periodi della sezione 5; puoi chiederne per email la cancellazione anticipata e ti diremo cosa possiamo cancellare e cosa dobbiamo conservare.',
            '**Disiscriviti** dalla newsletter con il link presente in ogni email — senza account.',
            '**Cookie** — «Impostazioni cookie» in fondo a ogni pagina.',
            `**Tutto il resto** — scrivi a [${SUPPORT}](mailto:${SUPPORT}). Riceverai risposta entro 30 giorni.`,
          ] },
          { p: 'Puoi presentare reclamo all\'Incaricato federale della protezione dei dati e della trasparenza (IFPDT) o all\'autorità di protezione dei dati del tuo paese nell\'UE/SEE (in Italia, il Garante per la protezione dei dati personali).' },
        ],
      },
      {
        h: '7. Cookie e memoria del browser',
        blocks: [
          { p: 'I cookie strettamente necessari (accesso, pagamento, sicurezza) sono sempre attivi. Analisi (Google Analytics) e marketing (pixel di Meta) si caricano solo dopo il tuo consenso e non ricevono mai l\'indirizzo di una pagina che contiene una chiave di accesso. L\'elenco completo è nella [Cookie Policy](/legal/cookies).' },
        ],
      },
      {
        h: '8. Sicurezza',
        blocks: [
          { p: 'I dati viaggiano solo su HTTPS. L\'accesso al database è limitato da regole a livello di riga e le tabelle interne sono raggiungibili solo dal server. I dati delle carte sono trattati da Stripe (PCI DSS) e non ci arrivano mai. La console del venditore richiede password e secondo fattore. I backup sono cifrati prima dell\'invio. Nessuna protezione è assoluta; se una violazione grave ti riguarda, sarai informato.' },
        ],
      },
      {
        h: '9. Minori',
        blocks: [
          { p: 'Il sito non è destinato a minori di 16 anni e non ne raccogliamo consapevolmente i dati. Se ci sono stati forniti, scrivici e verranno cancellati.' },
        ],
      },
      {
        h: '10. Modifiche',
        blocks: [
          { p: 'La versione in vigore è sempre su questa pagina, con la sua data. Le modifiche sostanziali ti saranno comunicate via email o con un avviso sul sito.' },
        ],
      },
    ],
  },
}
