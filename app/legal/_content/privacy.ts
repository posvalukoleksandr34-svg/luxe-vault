import type { LegalDocSet } from './types'

const SUPPORT = 'support@luxe-vault.store'

export const PRIVACY: LegalDocSet = {
  ru: {
    title: 'Политика конфиденциальности',
    description: 'Как Luxe Vault собирает, использует и защищает персональные данные.',
    effective: 'Действует с 6 сентября 2026',
    sections: [
      {
        h: '1. Кто обрабатывает ваши данные',
        blocks: [
          { p: `Контролёром персональных данных является частное лицо, проживающее в Цюрихе, Швейцария, и продающее товары под именем Luxe Vault. Это частная продажа, а не компания. По вопросам обработки данных пишите на [${SUPPORT}](mailto:${SUPPORT}); полное имя и почтовый адрес контролёра предоставляются по запросу.` },
          { p: 'Продавец находится в Швейцарии, поэтому применяется швейцарский Федеральный закон о защите данных (nFADP, в редакции с 1 сентября 2023 года). Поскольку товары предлагаются покупателям в ЕС/ЕЭЗ, к обработке их данных дополнительно применяется GDPR. Швейцария признана Европейской комиссией страной с адекватным уровнем защиты, поэтому передача данных из ЕЭЗ в Швейцарию не требует дополнительных гарантий.' },
        ],
      },
      {
        h: '2. Какие данные собираются',
        blocks: [
          { ul: [
            '**Учётная запись:** имя, адрес электронной почты, выбранный язык. Пароль хранится только в виде необратимого хеша у провайдера аутентификации.',
            '**Заказы:** имя получателя, телефон, адрес доставки, состав и сумма заказа, статус оплаты и доставки.',
            '**Платежи:** идентификатор транзакции, тип карты и последние четыре цифры. **Полный номер карты, срок действия и CVC не собираются и не хранятся** — они вводятся напрямую в защищённую форму платёжного провайдера.',
            '**Обращения в поддержку:** текст сообщения и указанные вами контактные данные.',
            '**Технические данные:** IP-адрес, тип браузера и журналы сервера — в объёме, необходимом для безопасности и диагностики.',
          ] },
        ],
      },
      {
        h: '3. Правовые основания и цели',
        blocks: [
          { ul: [
            '**Исполнение договора** (ст. 6(1)(b) GDPR) — обработка заказа, оплата, доставка, возвраты, поддержка.',
            '**Законный интерес** (ст. 6(1)(f)) — предотвращение мошенничества и безопасность сайта.',
            '**Согласие** (ст. 6(1)(a)) — аналитические и маркетинговые файлы cookie. Отзывается в любой момент через «Настройки cookie» в подвале сайта.',
            '**Правовая обязанность** (ст. 6(1)(c)) — хранение сведений о сделках в объёме, предусмотренном применимым правом.',
          ] },
        ],
      },
      {
        h: '4. Кому передаются данные',
        blocks: [
          { p: 'Персональные данные не продаются. Они передаются обработчикам, действующим по инструкциям продавца:' },
          { ul: [
            '**Stripe** — обработка платежей и хранение сохранённых карт.',
            '**Supabase** — база данных и аутентификация.',
            '**Resend** — доставка транзакционных писем.',
            '**Netlify** — хостинг и доставка контента.',
            '**Швейцарская почта (Die Post / La Poste)** — доставка заказов; получает имя и адрес получателя.',
          ] },
          { p: 'При передаче за пределы ЕЭЗ применяются стандартные договорные положения Европейской комиссии либо решение об адекватности.' },
        ],
      },
      {
        h: '5. Сроки хранения',
        blocks: [
          { ul: [
            'Данные заказов — 5 лет с момента продажи (общий срок исковой давности, ст. 128 Обязательственного кодекса). Десятилетняя обязанность по ведению бухгалтерии (ст. 958f) к частной продаже не применяется.',
            'Учётная запись — до её удаления вами и 30 дней после.',
            'Обращения в поддержку — 24 месяца с момента закрытия обращения.',
            'Записи о согласии на cookie — 12 месяцев, затем запрос повторяется.',
          ] },
        ],
      },
      {
        h: '6. Ваши права',
        blocks: [
          { p: 'При применимости GDPR вы вправе требовать:' },
          { ul: [
            'доступа к своим данным и их копии;',
            'исправления неточных данных;',
            'удаления данных («право быть забытым»);',
            'ограничения обработки и возражения против неё;',
            'переносимости данных в машиночитаемом формате;',
            'отзыва согласия в любой момент — без влияния на законность прошлой обработки.',
          ] },
          { p: `Запрос направляйте на [${SUPPORT}](mailto:${SUPPORT}). Ответ предоставляется в течение одного месяца. Вы также вправе подать жалобу в надзорный орган по месту жительства.` },
        ],
      },
      {
        h: '7. Файлы cookie',
        blocks: [
          { p: '**Строго необходимые** — сессия, корзина, безопасность; работают всегда. **Аналитические** — статистика посещений, только с согласия. **Маркетинговые** — измерение эффективности рекламы, только с согласия.' },
          { p: 'Нестрого необходимые файлы cookie не устанавливаются до получения согласия. Изменить или отозвать выбор можно в любой момент по ссылке «Настройки cookie» в подвале сайта.' },
        ],
      },
      {
        h: '8. Безопасность',
        blocks: [
          { p: 'Данные передаются по HTTPS, доступ к базе ограничен политиками построчной безопасности, платёжные реквизиты обрабатываются сертифицированным по PCI DSS провайдером и не попадают на серверы продавца.' },
        ],
      },
      {
        h: '9. Дети',
        blocks: [
          { p: 'Сайт не предназначен для лиц младше 16 лет, и их данные сознательно не собираются. Если такие данные были переданы, сообщите — они будут удалены.' },
        ],
      },
      {
        h: '10. Изменения',
        blocks: [
          { p: 'Актуальная редакция всегда доступна на этой странице. При существенных изменениях уведомление направляется по электронной почте или показывается баннером на сайте.' },
        ],
      },
    ],
  },

  en: {
    title: 'Privacy Policy',
    description: 'How Luxe Vault collects, uses and protects personal data.',
    effective: 'In force since 6 September 2026',
    sections: [
      {
        h: '1. Who processes your data',
        blocks: [
          { p: `The data controller is a private individual resident in Zurich, Switzerland, selling under the name Luxe Vault. This is a private sale, not a company. For data questions write to [${SUPPORT}](mailto:${SUPPORT}); the controller's full name and postal address are provided on request.` },
          { p: 'The Seller is based in Switzerland, so the Swiss Federal Act on Data Protection (nFADP, in force since 1 September 2023) applies. Because goods are offered to buyers in the EU/EEA, the GDPR additionally applies to their data. Switzerland holds an EU adequacy decision, so transfers from the EEA to Switzerland need no further safeguards.' },
        ],
      },
      {
        h: '2. What data is collected',
        blocks: [
          { ul: [
            '**Account:** name, email address, chosen language. The password is stored only as an irreversible hash by the authentication provider.',
            '**Orders:** recipient name, phone, delivery address, order contents and total, payment and delivery status.',
            '**Payments:** transaction id, card brand and last four digits. **The full card number, expiry and CVC are never collected or stored** — they are entered directly into the payment provider\'s secure form.',
            '**Support enquiries:** the message text and the contact details you supply.',
            '**Technical data:** IP address, browser type and server logs, to the extent needed for security and diagnostics.',
          ] },
        ],
      },
      {
        h: '3. Legal bases and purposes',
        blocks: [
          { ul: [
            '**Performance of a contract** (Art. 6(1)(b) GDPR) — order processing, payment, delivery, returns, support.',
            '**Legitimate interest** (Art. 6(1)(f)) — fraud prevention and site security.',
            '**Consent** (Art. 6(1)(a)) — analytics and marketing cookies. Withdrawable at any time via "Cookie settings" in the footer.',
            '**Legal obligation** (Art. 6(1)(c)) — retaining transaction records as required by applicable law.',
          ] },
        ],
      },
      {
        h: '4. Who data is shared with',
        blocks: [
          { p: 'Personal data is never sold. It is shared with processors acting on the Seller\'s instructions:' },
          { ul: [
            '**Stripe** — payment processing and storage of saved cards.',
            '**Supabase** — database and authentication.',
            '**Resend** — delivery of transactional email.',
            '**Netlify** — hosting and content delivery.',
            '**Swiss Post (Die Post / La Poste)** — delivery; receives the recipient\'s name and address.',
          ] },
          { p: 'Transfers outside the EEA rely on the European Commission\'s standard contractual clauses or on an adequacy decision.' },
        ],
      },
      {
        h: '5. Retention',
        blocks: [
          { ul: [
            'Order data — 5 years from the sale (the general limitation period, Art. 128 Code of Obligations). The ten-year bookkeeping duty (Art. 958f) does not apply to a private sale.',
            'Account — until you delete it, plus 30 days.',
            'Support enquiries — 24 months after the enquiry is closed.',
            'Cookie consent records — 12 months, after which you are asked again.',
          ] },
        ],
      },
      {
        h: '6. Your rights',
        blocks: [
          { p: 'Where the GDPR applies you may request:' },
          { ul: [
            'access to your data and a copy of it;',
            'correction of inaccurate data;',
            'erasure ("right to be forgotten");',
            'restriction of, and objection to, processing;',
            'portability in a machine-readable format;',
            'withdrawal of consent at any time, without affecting the lawfulness of earlier processing.',
          ] },
          { p: `Send requests to [${SUPPORT}](mailto:${SUPPORT}). A reply follows within one month. You may also lodge a complaint with the supervisory authority where you live.` },
        ],
      },
      {
        h: '7. Cookies',
        blocks: [
          { p: '**Strictly necessary** — session, cart, security; always active. **Analytics** — visit statistics, only with consent. **Marketing** — advertising performance, only with consent.' },
          { p: 'Non-essential cookies are not set before consent is given. You can change or withdraw your choice at any time via "Cookie settings" in the footer.' },
        ],
      },
      {
        h: '8. Security',
        blocks: [
          { p: 'Data travels over HTTPS, database access is restricted by row-level security policies, and payment details are handled by a PCI-DSS certified provider and never reach the Seller\'s servers.' },
        ],
      },
      {
        h: '9. Children',
        blocks: [
          { p: 'The site is not intended for anyone under 16 and their data is not knowingly collected. If such data has been supplied, tell us and it will be deleted.' },
        ],
      },
      {
        h: '10. Changes',
        blocks: [
          { p: 'The current version is always on this page. For material changes you will be notified by email or by a banner on the site.' },
        ],
      },
    ],
  },

  it: {
    title: 'Informativa sulla privacy',
    description: 'Come Luxe Vault raccoglie, utilizza e protegge i dati personali.',
    effective: 'In vigore dal 6 settembre 2026',
    sections: [
      {
        h: '1. Chi tratta i tuoi dati',
        blocks: [
          { p: `Il titolare del trattamento è una persona fisica residente a Zurigo, Svizzera, che vende con il nome Luxe Vault. Si tratta di una vendita tra privati, non di una società. Per questioni sui dati scrivi a [${SUPPORT}](mailto:${SUPPORT}); nome completo e indirizzo postale del titolare sono forniti su richiesta.` },
          { p: 'Il Venditore ha sede in Svizzera, quindi si applica la legge federale svizzera sulla protezione dei dati (nFADP, in vigore dal 1° settembre 2023). Poiché i beni sono offerti anche ad acquirenti nell’UE/SEE, ai loro dati si applica inoltre il GDPR. La Svizzera beneficia di una decisione di adeguatezza dell’UE, quindi i trasferimenti dal SEE verso la Svizzera non richiedono ulteriori garanzie.' },
        ],
      },
      {
        h: '2. Quali dati vengono raccolti',
        blocks: [
          { ul: [
            '**Account:** nome, indirizzo email, lingua scelta. La password è conservata solo come hash irreversibile presso il fornitore di autenticazione.',
            '**Ordini:** nome del destinatario, telefono, indirizzo di consegna, contenuto e totale dell’ordine, stato di pagamento e spedizione.',
            '**Pagamenti:** identificativo della transazione, circuito della carta e ultime quattro cifre. **Numero completo della carta, scadenza e CVC non vengono mai raccolti né conservati** — sono inseriti direttamente nel modulo sicuro del fornitore di pagamento.',
            '**Richieste di assistenza:** il testo del messaggio e i recapiti che fornisci.',
            '**Dati tecnici:** indirizzo IP, tipo di browser e log del server, nella misura necessaria per sicurezza e diagnostica.',
          ] },
        ],
      },
      {
        h: '3. Basi giuridiche e finalità',
        blocks: [
          { ul: [
            '**Esecuzione del contratto** (art. 6(1)(b) GDPR) — gestione dell’ordine, pagamento, spedizione, resi, assistenza.',
            '**Legittimo interesse** (art. 6(1)(f)) — prevenzione delle frodi e sicurezza del sito.',
            '**Consenso** (art. 6(1)(a)) — cookie analitici e di marketing. Revocabile in qualsiasi momento tramite «Impostazioni cookie» nel piè di pagina.',
            '**Obbligo legale** (art. 6(1)(c)) — conservazione dei dati delle transazioni nella misura prevista dalla legge applicabile.',
          ] },
        ],
      },
      {
        h: '4. A chi vengono comunicati i dati',
        blocks: [
          { p: 'I dati personali non vengono venduti. Sono comunicati a responsabili che agiscono su istruzione del Venditore:' },
          { ul: [
            '**Stripe** — gestione dei pagamenti e conservazione delle carte salvate.',
            '**Supabase** — database e autenticazione.',
            '**Resend** — invio delle email transazionali.',
            '**Netlify** — hosting e distribuzione dei contenuti.',
            '**Posta Svizzera (Die Post / La Poste)** — consegna; riceve nome e indirizzo del destinatario.',
          ] },
          { p: 'I trasferimenti fuori dal SEE si basano sulle clausole contrattuali standard della Commissione europea o su una decisione di adeguatezza.' },
        ],
      },
      {
        h: '5. Tempi di conservazione',
        blocks: [
          { ul: [
            'Dati degli ordini — 5 anni dalla vendita (termine ordinario di prescrizione, art. 128 CO). L’obbligo decennale di tenuta della contabilità (art. 958f) non si applica alla vendita tra privati.',
            'Account — fino alla cancellazione da parte tua, più 30 giorni.',
            'Richieste di assistenza — 24 mesi dalla chiusura della richiesta.',
            'Registrazioni del consenso ai cookie — 12 mesi, poi la richiesta viene ripetuta.',
          ] },
        ],
      },
      {
        h: '6. I tuoi diritti',
        blocks: [
          { p: 'Ove si applichi il GDPR, puoi chiedere:' },
          { ul: [
            'l’accesso ai tuoi dati e una copia;',
            'la rettifica dei dati inesatti;',
            'la cancellazione («diritto all’oblio»);',
            'la limitazione del trattamento e l’opposizione ad esso;',
            'la portabilità in formato leggibile da dispositivo automatico;',
            'la revoca del consenso in qualsiasi momento, senza pregiudicare la liceità del trattamento precedente.',
          ] },
          { p: `Invia le richieste a [${SUPPORT}](mailto:${SUPPORT}). La risposta arriva entro un mese. Puoi inoltre presentare reclamo all’autorità di controllo del tuo paese di residenza.` },
        ],
      },
      {
        h: '7. Cookie',
        blocks: [
          { p: '**Strettamente necessari** — sessione, carrello, sicurezza; sempre attivi. **Analitici** — statistiche di visita, solo con consenso. **Marketing** — misurazione dell’efficacia pubblicitaria, solo con consenso.' },
          { p: 'I cookie non essenziali non vengono impostati prima del consenso. Puoi modificare o revocare la scelta in qualsiasi momento tramite «Impostazioni cookie» nel piè di pagina.' },
        ],
      },
      {
        h: '8. Sicurezza',
        blocks: [
          { p: 'I dati viaggiano su HTTPS, l’accesso al database è limitato da politiche di sicurezza a livello di riga e i dati di pagamento sono gestiti da un fornitore certificato PCI DSS senza mai raggiungere i server del Venditore.' },
        ],
      },
      {
        h: '9. Minori',
        blocks: [
          { p: 'Il sito non è destinato a persone di età inferiore a 16 anni e i loro dati non sono raccolti consapevolmente. Se tali dati sono stati forniti, segnalalo e saranno cancellati.' },
        ],
      },
      {
        h: '10. Modifiche',
        blocks: [
          { p: 'La versione aggiornata è sempre disponibile su questa pagina. In caso di modifiche sostanziali riceverai una notifica via email o tramite un banner sul sito.' },
        ],
      },
    ],
  },
}
