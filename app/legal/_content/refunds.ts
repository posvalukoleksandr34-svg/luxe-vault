import type { LegalDocSet } from './types'

const SUPPORT = 'support@luxe-vault.store'
const TG = '@luxevault_orders'

export const REFUNDS: LegalDocSet = {
  ru: {
    title: 'Возврат и обмен',
    description: 'Условия отмены заказа, возврата товара и возврата денежных средств Luxe Vault.',
    effective: 'Действует с 6 сентября 2026',
    sections: [
      {
        h: '1. Отмена до отправки',
        blocks: [
          { p: 'Неоплаченный заказ можно отменить самостоятельно в личном кабинете — кнопка «Отменить заказ» рядом с заказом. Отмена происходит мгновенно, платёжное намерение аннулируется, и списание становится невозможным.' },
          { p: `Оплаченный заказ отменяется по запросу на [${SUPPORT}](mailto:${SUPPORT}) с полным возвратом средств — при условии, что посылка ещё не сдана в отделение Швейцарской почты.` },
        ],
      },
      {
        h: '2. Право на отказ в течение 14 дней',
        blocks: [
          { p: 'Вы вправе отказаться от договора в течение **14 дней** с момента получения товара без объяснения причин. Срок считается соблюдённым, если уведомление отправлено до его истечения.' },
          { p: 'Для покупателей из ЕС/ЕЭЗ это право предусмотрено законом. В швейцарском праве обязательного «периода охлаждения» для покупок в интернете не установлено — для покупателей из Швейцарии эти 14 дней предоставляются добровольно, как договорное условие настоящей Политики.' },
          { p: 'После уведомления у вас есть ещё 14 дней на отправку товара обратно. Средства возвращаются не позднее 14 дней с момента получения товара продавцом либо получения доказательства отправки — в зависимости от того, что произойдёт раньше.' },
        ],
      },
      {
        h: '3. Требования к возвращаемому товару',
        blocks: [
          { ul: [
            'товар не был в носке, не стирался и не подвергался изменениям;',
            'сохранены оригинальные бирки, упаковка и комплектующие;',
            'отсутствуют следы использования, запахи, повреждения.',
          ] },
          { p: 'Сумма возврата может быть уменьшена соразмерно снижению стоимости товара, если оно вызвано обращением, выходящим за рамки проверки свойств и характеристик.' },
        ],
      },
      {
        h: '4. Товары, не подлежащие возврату',
        blocks: [
          { ul: [
            'изделия, изготовленные по индивидуальным меркам;',
            'товары с нарушенной гигиенической упаковкой;',
            'подарочные сертификаты.',
          ] },
        ],
      },
      {
        h: '5. Как оформить возврат',
        blocks: [
          { ol: [
            `Откройте личный кабинет и нажмите **«Запросить возврат»** рядом с оплаченным заказом, либо напишите на [${SUPPORT}](mailto:${SUPPORT}), указав номер заказа.`,
            'Ответ приходит в течение 1–2 рабочих дней с почтовым адресом для возврата. Заранее адрес не публикуется: это частный домашний адрес.',
            'Отправьте товар Швейцарской почтой с трек-номером и сохраните квитанцию — без неё утерянную посылку невозможно разыскать.',
            'После получения и осмотра посылки оформляется возврат средств с уведомлением по электронной почте.',
          ] },
          { p: 'Запрос на возврат рассматривается человеком — автоматического возврата средств по нажатию кнопки не происходит.' },
        ],
      },
      {
        h: '6. Возврат денежных средств',
        blocks: [
          { p: 'Средства возвращаются **тем же способом**, которым была произведена оплата: на карту — через Stripe, обычно в течение 5–10 рабочих дней в зависимости от банка. Возврат оформляется вручную, как правило в течение 1–2 рабочих дней после осмотра товара.' },
          { p: 'Возможен **частичный возврат** — например, при возврате части позиций заказа или при уменьшении суммы согласно разделу 3.' },
          { p: 'Стоимость первичной доставки возвращается при отказе от всего заказа в течение 14 дней. Расходы на обратную пересылку несёт покупатель, за исключением случаев брака или ошибки продавца.' },
        ],
      },
      {
        h: '7. Брак и несоответствие заказу',
        blocks: [
          { p: 'Если товар пришёл повреждённым, бракованным или не соответствует заказу, сообщите в течение 14 дней с приложением фотографий. Товар будет бесплатно заменён либо возвращена полная стоимость, включая доставку в обе стороны, по вашему выбору.' },
          { p: 'Этот пункт не ограничивает ваши законные права как потребителя в отношении товаров ненадлежащего качества.' },
        ],
      },
      {
        h: '8. Обмен',
        blocks: [
          { p: 'Прямого обмена нет: товары продаются поштучно из личной коллекции, и второго экземпляра нужного размера обычно просто не существует. Оформите возврат и, при наличии подходящей позиции, новый заказ.' },
        ],
      },
      {
        h: '9. Контакты',
        blocks: [
          { p: `[${SUPPORT}](mailto:${SUPPORT}) · Telegram ${TG}` },
        ],
      },
    ],
  },

  en: {
    title: 'Refunds and Returns',
    description: 'Cancellation, return and refund terms for Luxe Vault.',
    effective: 'In force since 6 September 2026',
    sections: [
      {
        h: '1. Cancelling before dispatch',
        blocks: [
          { p: 'An unpaid order can be cancelled yourself from your account — the "Cancel order" button beside the order. Cancellation is immediate: the payment intent is voided, so no charge can be taken.' },
          { p: `A paid order is cancelled on request at [${SUPPORT}](mailto:${SUPPORT}) with a full refund, provided the parcel has not yet been handed in at a Swiss Post counter.` },
        ],
      },
      {
        h: '2. 14-day right of withdrawal',
        blocks: [
          { p: 'You may withdraw from the contract within **14 days** of receiving the item, without giving a reason. The deadline is met if notice is sent before it expires.' },
          { p: 'For buyers in the EU/EEA this right is granted by law. Swiss law provides no mandatory cooling-off period for online purchases — for buyers in Switzerland these 14 days are granted voluntarily, as a contractual term of this Policy.' },
          { p: 'After giving notice you have a further 14 days to send the item back. Refunds are issued no later than 14 days after the item is received, or after proof of dispatch is provided, whichever is earlier.' },
        ],
      },
      {
        h: '3. Condition of returned items',
        blocks: [
          { ul: [
            'unworn, unwashed and unaltered;',
            'original tags, packaging and accessories intact;',
            'no signs of use, odours or damage.',
          ] },
          { p: 'The refund may be reduced in proportion to any loss of value caused by handling beyond what is needed to check the item\'s nature and characteristics.' },
        ],
      },
      {
        h: '4. Items that cannot be returned',
        blocks: [
          { ul: [
            'items made to individual measurements;',
            'items whose hygiene seal has been broken;',
            'gift vouchers.',
          ] },
        ],
      },
      {
        h: '5. How to return',
        blocks: [
          { ol: [
            `Open your account and press **"Request a refund"** beside the paid order, or write to [${SUPPORT}](mailto:${SUPPORT}) quoting the order number.`,
            'A reply follows within 1–2 working days with the return address. It is not published in advance: it is a private home address.',
            'Send the item by Swiss Post with a tracking number and keep the receipt — without it a lost parcel cannot be traced.',
            'Once the parcel arrives and has been inspected, the refund is issued and you are notified by email.',
          ] },
          { p: 'Refund requests are reviewed by a person — no refund is issued automatically at the press of a button.' },
        ],
      },
      {
        h: '6. Refunds',
        blocks: [
          { p: 'Money is returned **by the same method** used to pay: to a card via Stripe, typically within 5–10 working days depending on your bank. Refunds are issued by hand, usually within 1–2 working days of inspection.' },
          { p: '**Partial refunds** are possible — for example when only some items are returned, or where the amount is reduced under section 3.' },
          { p: 'The original shipping cost is refunded when the whole order is withdrawn within 14 days. Return postage is paid by the buyer, except where the item is faulty or the Seller made an error.' },
        ],
      },
      {
        h: '7. Faulty or incorrect items',
        blocks: [
          { p: 'If an item arrives damaged, faulty or not as ordered, tell us within 14 days and attach photographs. The item will be replaced free of charge, or refunded in full including postage both ways — your choice.' },
          { p: 'This does not limit your statutory consumer rights in respect of faulty goods.' },
        ],
      },
      {
        h: '8. Exchanges',
        blocks: [
          { p: 'There are no direct exchanges: items are sold individually from a personal collection, and a second copy in another size usually does not exist. Request a refund and, if a suitable item is available, place a new order.' },
        ],
      },
      {
        h: '9. Contact',
        blocks: [
          { p: `[${SUPPORT}](mailto:${SUPPORT}) · Telegram ${TG}` },
        ],
      },
    ],
  },

  it: {
    title: 'Rimborsi e resi',
    description: 'Condizioni di annullamento, reso e rimborso di Luxe Vault.',
    effective: 'In vigore dal 6 settembre 2026',
    sections: [
      {
        h: '1. Annullamento prima della spedizione',
        blocks: [
          { p: 'Un ordine non pagato può essere annullato autonomamente dal tuo account, con il pulsante «Annulla ordine» accanto all’ordine. L’annullamento è immediato: l’intento di pagamento viene annullato e nessun addebito è più possibile.' },
          { p: `Un ordine già pagato viene annullato su richiesta a [${SUPPORT}](mailto:${SUPPORT}) con rimborso integrale, a condizione che il pacco non sia ancora stato consegnato a uno sportello della Posta Svizzera.` },
        ],
      },
      {
        h: '2. Diritto di recesso di 14 giorni',
        blocks: [
          { p: 'Puoi recedere dal contratto entro **14 giorni** dal ricevimento dell’articolo, senza doverne indicare il motivo. Il termine si considera rispettato se la comunicazione è inviata prima della scadenza.' },
          { p: 'Per gli acquirenti nell’UE/SEE questo diritto è previsto dalla legge. Il diritto svizzero non prevede un periodo di ripensamento obbligatorio per gli acquisti online: per gli acquirenti in Svizzera questi 14 giorni sono concessi volontariamente, come condizione contrattuale della presente Politica.' },
          { p: 'Dopo la comunicazione hai altri 14 giorni per rispedire l’articolo. Il rimborso avviene entro 14 giorni dal ricevimento dell’articolo o dalla prova di spedizione, a seconda di quale evento si verifichi per primo.' },
        ],
      },
      {
        h: '3. Condizioni dell’articolo reso',
        blocks: [
          { ul: [
            'non indossato, non lavato e non modificato;',
            'etichette originali, imballaggio e accessori intatti;',
            'nessun segno d’uso, odore o danno.',
          ] },
          { p: 'Il rimborso può essere ridotto in proporzione alla diminuzione di valore dovuta a una manipolazione eccedente quella necessaria a verificare natura e caratteristiche dell’articolo.' },
        ],
      },
      {
        h: '4. Articoli non restituibili',
        blocks: [
          { ul: [
            'articoli realizzati su misura;',
            'articoli con sigillo igienico rotto;',
            'buoni regalo.',
          ] },
        ],
      },
      {
        h: '5. Come effettuare un reso',
        blocks: [
          { ol: [
            `Apri il tuo account e premi **«Richiedi un rimborso»** accanto all’ordine pagato, oppure scrivi a [${SUPPORT}](mailto:${SUPPORT}) indicando il numero dell’ordine.`,
            'La risposta arriva entro 1–2 giorni lavorativi con l’indirizzo per il reso. Non viene pubblicato in anticipo: è un indirizzo privato di abitazione.',
            'Spedisci l’articolo con la Posta Svizzera con numero di tracciamento e conserva la ricevuta — senza di essa un pacco smarrito non è rintracciabile.',
            'Ricevuto e verificato il pacco, il rimborso viene emesso e riceverai una notifica via email.',
          ] },
          { p: 'Le richieste di rimborso sono esaminate da una persona: nessun rimborso viene emesso automaticamente premendo un pulsante.' },
        ],
      },
      {
        h: '6. Rimborsi',
        blocks: [
          { p: 'Il denaro è restituito **con lo stesso metodo** usato per pagare: su carta tramite Stripe, di norma entro 5–10 giorni lavorativi a seconda della banca. I rimborsi sono emessi manualmente, di solito entro 1–2 giorni lavorativi dalla verifica.' },
          { p: 'Sono possibili **rimborsi parziali** — ad esempio quando si restituiscono solo alcuni articoli, o quando l’importo è ridotto ai sensi della sezione 3.' },
          { p: 'Il costo della spedizione iniziale è rimborsato se si recede dall’intero ordine entro 14 giorni. Le spese di rispedizione sono a carico dell’acquirente, salvo articolo difettoso o errore del Venditore.' },
        ],
      },
      {
        h: '7. Articoli difettosi o errati',
        blocks: [
          { p: 'Se un articolo arriva danneggiato, difettoso o diverso da quello ordinato, segnalalo entro 14 giorni allegando fotografie. L’articolo sarà sostituito gratuitamente oppure rimborsato per intero, comprese le spese di spedizione in entrambe le direzioni, a tua scelta.' },
          { p: 'Ciò non limita i tuoi diritti legali di consumatore in relazione a prodotti difettosi.' },
        ],
      },
      {
        h: '8. Cambi',
        blocks: [
          { p: 'Non sono previsti cambi diretti: gli articoli sono venduti singolarmente da una collezione personale e di norma non esiste un secondo esemplare in un’altra taglia. Richiedi un rimborso e, se disponibile un articolo adatto, effettua un nuovo ordine.' },
        ],
      },
      {
        h: '9. Contatti',
        blocks: [
          { p: `[${SUPPORT}](mailto:${SUPPORT}) · Telegram ${TG}` },
        ],
      },
    ],
  },
}
