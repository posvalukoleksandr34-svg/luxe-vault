import type { LegalDocSet } from './types'

const SUPPORT = 'support@luxe-vault.store'
const TG = '@luxevault_orders'

export const TERMS: LegalDocSet = {
  ru: {
    title: 'Условия использования',
    description: 'Условия использования магазина Luxe Vault.',
    effective: 'Действует с 6 сентября 2026',
    sections: [
      {
        h: '1. Общие положения',
        blocks: [
          { p: 'Настоящие Условия регулируют использование сайта luxe-vault.store и покупку товаров через него. Продавцом выступает частное лицо, проживающее в Цюрихе, Швейцария, действующее под именем Luxe Vault (далее — «Продавец», «я»). Это **частная продажа** (Privatverkauf), а не деятельность компании: продавец не является зарегистрированным предприятием, не имеет склада, магазина или наёмных сотрудников.' },
          { p: `Полное имя и почтовый адрес продавца предоставляются по запросу на [${SUPPORT}](mailto:${SUPPORT}) — они необходимы для оформления возврата и для реализации ваших прав на доступ к персональным данным.` },
          { p: 'Оформляя заказ, вы подтверждаете, что ознакомились с настоящими Условиями и принимаете их.' },
        ],
      },
      {
        h: '2. Характер товара',
        blocks: [
          { p: '**Продаются премиальные реплики, а не оригинальная продукция брендов.** Продавец не аффилирован с правообладателями и не выдаёт изделия за оригинальные. Названия брендов используются исключительно для описания фасона и дизайна.' },
          { p: 'Приобретая товар, вы подтверждаете, что понимаете его характер, и обязуетесь не перепродавать его как оригинальный.' },
        ],
      },
      {
        h: '3. Частный характер продажи',
        blocks: [
          { p: 'Товары продаются из личной коллекции, поштучно и в ограниченном количестве. Обработка заказов, упаковка и отправка выполняются вручную одним человеком, поэтому сроки зависят от режима работы почтовых отделений.' },
          { p: 'При частной продаже по швейцарскому праву (ст. 199 Обязательственного кодекса) гарантия за качество может быть ограничена соглашением сторон. Товар продаётся в состоянии, описанном на странице товара и на фотографиях. Это **не** исключает ответственность за умышленное умолчание о недостатках и не лишает вас права на возврат по разделу 8.' },
        ],
      },
      {
        h: '4. Регистрация и учётная запись',
        blocks: [
          { p: 'Оформление заказа требует создания учётной записи. Вы отвечаете за сохранность своих учётных данных. Сообщите немедленно при подозрении на несанкционированный доступ.' },
          { p: 'Учётная запись может быть заблокирована при нарушении Условий, попытке мошенничества или злоупотреблении возвратами.' },
        ],
      },
      {
        h: '5. Заказы и цены',
        blocks: [
          { ul: [
            'Размещение заказа является офертой. Договор заключается с момента подтверждения заказа продавцом.',
            'Цены указаны в швейцарских франках (CHF). Стоимость доставки рассчитывается отдельно. Импортные пошлины и НДС страны получателя в цену не включены.',
            'В исполнении заказа может быть отказано при явной ошибке в цене, отсутствии товара или обоснованном подозрении в мошенничестве; уплаченные средства возвращаются полностью.',
          ] },
        ],
      },
      {
        h: '6. Оплата',
        blocks: [
          { p: 'Оплата принимается банковскими картами через Stripe и, при доступности, криптовалютой. Данные карты вводятся напрямую в защищённую форму платёжного провайдера; продавец не получает и не хранит номера карт.' },
          { p: 'Заказ считается оплаченным после подтверждения от платёжного провайдера. До этого он сохраняется со статусом «ожидает оплаты» и может быть оплачен позднее из личного кабинета.' },
        ],
      },
      {
        h: '7. Доставка',
        blocks: [
          { p: 'Отправка производится вручную из отделения Швейцарской почты (Die Post / La Poste), обычно в течение 2–4 рабочих дней после поступления оплаты.' },
          { p: 'Сроки доставки ориентировочны и зависят от Швейцарской почты и почтовой службы страны получателя. Задержки по вине почты, таможни или вследствие форс-мажора не являются нарушением со стороны продавца.' },
          { p: 'Риск случайной гибели переходит к вам в момент передачи товара вам или указанному вами лицу. Импортные пошлины и сборы оплачивает получатель.' },
        ],
      },
      {
        h: '8. Возврат и отмена',
        blocks: [
          { p: 'Порядок описан в [Политике возврата](/legal/refunds), которая является неотъемлемой частью настоящих Условий.' },
        ],
      },
      {
        h: '9. Интеллектуальная собственность сайта',
        blocks: [
          { p: 'Дизайн сайта, тексты и фотографии, созданные продавцом, защищены авторским правом; копирование без письменного разрешения не допускается. Это не распространяется на товарные знаки третьих лиц, права на которые принадлежат их владельцам.' },
        ],
      },
      {
        h: '10. Ограничение ответственности',
        blocks: [
          { p: 'В максимально допустимой законом степени совокупная ответственность по любому заказу ограничена уплаченной за него суммой. Продавец не отвечает за косвенные убытки, упущенную выгоду и потерю данных.' },
          { p: 'Ничто в настоящих Условиях не исключает ответственность, которая не может быть исключена по закону, включая права потребителей.' },
        ],
      },
      {
        h: '11. Изменение условий',
        blocks: [
          { p: 'Условия могут изменяться. К размещённому заказу применяется редакция, действовавшая на момент его оформления. Существенные изменения публикуются на этой странице с обновлением даты.' },
        ],
      },
      {
        h: '12. Применимое право и споры',
        blocks: [
          { p: 'Применяется материальное право Швейцарии, за исключением Венской конвенции о договорах международной купли-продажи товаров (CISG). Споры рассматриваются судами города Цюрих, если иное не предусмотрено императивными нормами о защите прав потребителей вашей страны проживания.' },
        ],
      },
      {
        h: '13. Контакты',
        blocks: [
          { p: `Электронная почта: [${SUPPORT}](mailto:${SUPPORT}) · Telegram: ${TG}` },
        ],
      },
    ],
  },

  en: {
    title: 'Terms of Use',
    description: 'Terms of use for the Luxe Vault store.',
    effective: 'In force since 6 September 2026',
    sections: [
      {
        h: '1. General',
        blocks: [
          { p: 'These Terms govern use of luxe-vault.store and purchases made through it. The seller is a private individual resident in Zurich, Switzerland, trading under the name Luxe Vault ("the Seller", "I"). This is a **private sale** (Privatverkauf), not a business: the Seller is not a registered company and has no warehouse, shop or employees.' },
          { p: `The Seller's full name and postal address are provided on request at [${SUPPORT}](mailto:${SUPPORT}) — they are needed to process a return and to exercise your data-access rights.` },
          { p: 'By placing an order you confirm that you have read and accept these Terms.' },
        ],
      },
      {
        h: '2. Nature of the goods',
        blocks: [
          { p: '**These are premium replicas, not authentic branded goods.** The Seller is not affiliated with any rights holder and does not present the items as originals. Brand names are used solely to describe cut and design.' },
          { p: 'By purchasing you confirm that you understand this, and undertake not to resell the item as genuine.' },
        ],
      },
      {
        h: '3. Private character of the sale',
        blocks: [
          { p: 'Items are sold from a personal collection, individually and in limited numbers. Orders are processed, packed and posted by hand by one person, so timings depend on post office opening hours.' },
          { p: 'In a private sale under Swiss law (Art. 199 Code of Obligations) the warranty for quality may be limited by agreement. Items are sold in the condition described on the product page and shown in the photographs. This does **not** exclude liability for defects deliberately concealed, and does not remove your right of return under section 8.' },
        ],
      },
      {
        h: '4. Registration and account',
        blocks: [
          { p: 'Placing an order requires an account. You are responsible for keeping your credentials safe. Tell us immediately if you suspect unauthorised access.' },
          { p: 'An account may be suspended for breach of these Terms, attempted fraud, or abuse of the returns process.' },
        ],
      },
      {
        h: '5. Orders and prices',
        blocks: [
          { ul: [
            'Placing an order is an offer. The contract is formed when the Seller confirms the order.',
            'Prices are in Swiss francs (CHF). Shipping is calculated separately. Import duties and destination-country VAT are not included.',
            'An order may be refused where there is an obvious pricing or description error, the item is unavailable, or fraud is reasonably suspected; any sum paid is refunded in full.',
          ] },
        ],
      },
      {
        h: '6. Payment',
        blocks: [
          { p: 'Payment is accepted by card through Stripe and, where available, in cryptocurrency. Card details are entered directly into the payment provider\'s secure form; the Seller neither receives nor stores card numbers.' },
          { p: 'An order counts as paid once the payment provider confirms it. Until then it is kept as "awaiting payment" and can be paid later from your account.' },
        ],
      },
      {
        h: '7. Shipping',
        blocks: [
          { p: 'Parcels are posted by hand from a Swiss Post (Die Post / La Poste) counter, usually within 2–4 working days of payment clearing.' },
          { p: 'Delivery times are estimates and depend on Swiss Post and the destination postal service. Delays caused by the postal service, customs or force majeure are not a breach by the Seller.' },
          { p: 'Risk passes to you when the item is handed to you or to a person you nominate. Import duties and charges are payable by the recipient.' },
        ],
      },
      {
        h: '8. Returns and cancellation',
        blocks: [
          { p: 'Set out in the [Refund Policy](/legal/refunds), which forms part of these Terms.' },
        ],
      },
      {
        h: '9. Site intellectual property',
        blocks: [
          { p: 'The site design, and text and photographs created by the Seller, are protected by copyright and may not be copied without written permission. This does not apply to third-party trade marks, which remain the property of their owners.' },
        ],
      },
      {
        h: '10. Limitation of liability',
        blocks: [
          { p: 'To the fullest extent permitted by law, total liability for any order is limited to the amount paid for it. The Seller is not liable for indirect loss, lost profit or loss of data.' },
          { p: 'Nothing here excludes liability that cannot be excluded by law, including consumer rights.' },
        ],
      },
      {
        h: '11. Changes to these Terms',
        blocks: [
          { p: 'These Terms may change. The version in force when an order was placed applies to that order. Material changes are published on this page with an updated date.' },
        ],
      },
      {
        h: '12. Governing law and disputes',
        blocks: [
          { p: 'Swiss substantive law applies, excluding the UN Convention on Contracts for the International Sale of Goods (CISG). Disputes are heard by the courts of Zurich, unless mandatory consumer-protection rules of your country of residence provide otherwise.' },
        ],
      },
      {
        h: '13. Contact',
        blocks: [
          { p: `Email: [${SUPPORT}](mailto:${SUPPORT}) · Telegram: ${TG}` },
        ],
      },
    ],
  },

  it: {
    title: 'Condizioni d’uso',
    description: 'Condizioni d’uso del negozio Luxe Vault.',
    effective: 'In vigore dal 6 settembre 2026',
    sections: [
      {
        h: '1. Disposizioni generali',
        blocks: [
          { p: 'Le presenti Condizioni regolano l’uso del sito luxe-vault.store e gli acquisti effettuati tramite esso. Il venditore è una persona fisica residente a Zurigo, Svizzera, che opera con il nome Luxe Vault («il Venditore»). Si tratta di una **vendita tra privati** (Privatverkauf), non di un’attività d’impresa: il Venditore non è una società registrata e non dispone di magazzino, negozio o dipendenti.' },
          { p: `Nome completo e indirizzo postale del Venditore sono forniti su richiesta scrivendo a [${SUPPORT}](mailto:${SUPPORT}) — sono necessari per gestire un reso e per esercitare i diritti di accesso ai dati.` },
          { p: 'Effettuando un ordine dichiari di aver letto e accettato le presenti Condizioni.' },
        ],
      },
      {
        h: '2. Natura della merce',
        blocks: [
          { p: '**Vengono vendute repliche premium, non prodotti di marca originali.** Il Venditore non è affiliato ad alcun titolare di diritti e non presenta gli articoli come originali. I nomi dei marchi sono usati unicamente per descrivere taglio e design.' },
          { p: 'Con l’acquisto dichiari di comprenderne la natura e ti impegni a non rivendere l’articolo come originale.' },
        ],
      },
      {
        h: '3. Carattere privato della vendita',
        blocks: [
          { p: 'Gli articoli provengono da una collezione personale, venduti singolarmente e in numero limitato. Ordini, imballaggio e spedizione sono gestiti manualmente da una sola persona, quindi i tempi dipendono dagli orari degli uffici postali.' },
          { p: 'Nella vendita tra privati secondo il diritto svizzero (art. 199 CO) la garanzia per i difetti può essere limitata per accordo. Gli articoli sono venduti nelle condizioni descritte nella scheda prodotto e mostrate nelle fotografie. Ciò **non** esclude la responsabilità per difetti deliberatamente taciuti e non elimina il diritto di reso di cui alla sezione 8.' },
        ],
      },
      {
        h: '4. Registrazione e account',
        blocks: [
          { p: 'Per ordinare è necessario un account. Sei responsabile della custodia delle tue credenziali. Segnala immediatamente ogni sospetto di accesso non autorizzato.' },
          { p: 'L’account può essere sospeso in caso di violazione delle Condizioni, tentata frode o abuso della procedura di reso.' },
        ],
      },
      {
        h: '5. Ordini e prezzi',
        blocks: [
          { ul: [
            'L’invio di un ordine costituisce una proposta. Il contratto si perfeziona con la conferma da parte del Venditore.',
            'I prezzi sono in franchi svizzeri (CHF). La spedizione è calcolata a parte. Dazi doganali e IVA del paese di destinazione non sono inclusi.',
            'Un ordine può essere rifiutato in caso di errore evidente di prezzo o descrizione, indisponibilità dell’articolo o ragionevole sospetto di frode; quanto pagato è rimborsato integralmente.',
          ] },
        ],
      },
      {
        h: '6. Pagamento',
        blocks: [
          { p: 'Si accettano carte tramite Stripe e, ove disponibile, criptovaluta. I dati della carta sono inseriti direttamente nel modulo sicuro del fornitore di pagamento; il Venditore non riceve né conserva i numeri di carta.' },
          { p: 'Un ordine è considerato pagato dopo la conferma del fornitore di pagamento. Fino ad allora resta «in attesa di pagamento» e può essere saldato in seguito dal tuo account.' },
        ],
      },
      {
        h: '7. Spedizione',
        blocks: [
          { p: 'I pacchi sono spediti manualmente da uno sportello della Posta Svizzera (Die Post / La Poste), di norma entro 2–4 giorni lavorativi dall’accredito del pagamento.' },
          { p: 'I tempi di consegna sono indicativi e dipendono dalla Posta Svizzera e dal servizio postale di destinazione. Ritardi dovuti alla posta, alla dogana o a forza maggiore non costituiscono inadempimento del Venditore.' },
          { p: 'Il rischio passa a te nel momento della consegna a te o a persona da te indicata. Dazi e oneri di importazione sono a carico del destinatario.' },
        ],
      },
      {
        h: '8. Resi e annullamento',
        blocks: [
          { p: 'Disciplinati dalla [Politica di reso](/legal/refunds), che è parte integrante delle presenti Condizioni.' },
        ],
      },
      {
        h: '9. Proprietà intellettuale del sito',
        blocks: [
          { p: 'Il design del sito e i testi e le fotografie realizzati dal Venditore sono protetti da diritto d’autore e non possono essere copiati senza autorizzazione scritta. Ciò non riguarda i marchi di terzi, che restano di proprietà dei rispettivi titolari.' },
        ],
      },
      {
        h: '10. Limitazione di responsabilità',
        blocks: [
          { p: 'Nella misura massima consentita dalla legge, la responsabilità complessiva per un ordine è limitata all’importo pagato per esso. Il Venditore non risponde di danni indiretti, lucro cessante o perdita di dati.' },
          { p: 'Nulla nelle presenti Condizioni esclude responsabilità non escludibili per legge, inclusi i diritti dei consumatori.' },
        ],
      },
      {
        h: '11. Modifiche delle Condizioni',
        blocks: [
          { p: 'Le Condizioni possono essere modificate. All’ordine si applica la versione in vigore al momento dell’acquisto. Le modifiche sostanziali sono pubblicate su questa pagina con data aggiornata.' },
        ],
      },
      {
        h: '12. Legge applicabile e foro',
        blocks: [
          { p: 'Si applica il diritto sostanziale svizzero, con esclusione della Convenzione di Vienna sulla vendita internazionale di beni mobili (CISG). Le controversie sono devolute ai tribunali di Zurigo, salvo diversa disposizione inderogabile a tutela dei consumatori del tuo paese di residenza.' },
        ],
      },
      {
        h: '13. Contatti',
        blocks: [
          { p: `Email: [${SUPPORT}](mailto:${SUPPORT}) · Telegram: ${TG}` },
        ],
      },
    ],
  },
}
