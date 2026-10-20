import type { AdviceReason, NonDeliveryAdvice } from '@/lib/refunds/delivery'
import type {
  CaseState,
  ClaimType,
  EvidenceKind,
  InspectionOutcome,
  InvestigationStatus,
  Resolution,
  RiskLevel,
  StaffRole,
  TrackingStatus,
  TransactionStatus,
} from '@/lib/refunds/types'

/** The refund console's words (Russian, like the rest of the admin console). */

export const STATE_RU: Record<CaseState, string> = {
  requested: 'Новая',
  under_review: 'На рассмотрении',
  awaiting_customer_info: 'Ждём ответа покупателя',
  awaiting_return_shipment: 'Ждём отправку возврата',
  return_in_transit: 'Возврат в пути',
  return_delivered: 'Возврат доставлен',
  awaiting_inspection: 'Ждёт проверки',
  approved: 'Одобрена · деньги не отправлены',
  refund_processing: 'Возврат денег в обработке',
  partially_refunded: 'Возвращена часть',
  refunded: 'Деньги возвращены',
  resolved: 'Решена (замена/повтор)',
  rejected: 'Отклонена',
  cancelled: 'Закрыта',
  expired: 'Истёк срок',
  disputed: 'Спор по платежу',
}

export const CLAIM_RU: Record<ClaimType, string> = {
  non_delivery: 'Не доставлен',
  damaged: 'Повреждён при доставке',
  defective: 'Брак',
  wrong_item: 'Не тот товар',
  missing_item: 'Не хватает товара',
  not_as_described: 'Не соответствует описанию',
  wrong_size: 'Не подошёл размер',
  changed_mind: 'Передумал',
  cancel_before_dispatch: 'Отмена до отправки',
  other: 'Другое',
}

export const RESOLUTION_RU: Record<Resolution, string> = {
  refund: 'Возврат денег',
  return_and_refund: 'Возврат товара и денег',
  replacement: 'Замена',
  reshipment: 'Повторная отправка',
}

export const INSPECTION_RU: Record<InspectionOutcome, string> = {
  accepted: 'Принят (можно вернуть на склад)',
  damaged: 'Повреждён',
  incorrect_item: 'Не наш / другой товар',
  missing_components: 'Неполная комплектация',
  used_or_altered: 'Ношен / изменён',
  not_received: 'Не получен',
  further_inspection: 'Нужна доп. проверка',
}

export const INVESTIGATION_RU: Record<InvestigationStatus, string> = {
  none: '—',
  open: 'Открыто',
  waiting_delivery_window: 'Ждём окончания срока доставки',
  carrier_claim_opened: 'Открыта претензия перевозчику',
  delivered_confirmed: 'Доставка подтверждена',
  lost_confirmed: 'Утеря подтверждена',
  inconclusive: 'Не удалось установить',
}

export const RISK_RU: Record<RiskLevel, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий' }

export const ROLE_RU: Record<StaffRole, string> = { owner: 'Владелец', manager: 'Менеджер', agent: 'Сотрудник поддержки', viewer: 'Только просмотр' }

export const TX_STATUS_RU: Record<TransactionStatus, string> = {
  pending_submission: 'Зарезервирован',
  submitted: 'Отправлен в Stripe',
  unknown: 'Результат неизвестен',
  pending: 'В обработке у банка',
  requires_action: 'Нужно действие',
  succeeded: 'Выполнен',
  failed: 'Не прошёл',
  canceled: 'Отменён',
}

export const EVIDENCE_RU: Record<EvidenceKind, string> = {
  tracking_snapshot: 'Снимок отслеживания',
  carrier_correspondence: 'Переписка с перевозчиком',
  proof_of_delivery: 'Подтверждение доставки',
  customer_photo: 'Фото покупателя',
  return_receipt: 'Квитанция возврата',
  inspection_report: 'Акт проверки',
  order_event: 'Запись заказа',
  other: 'Другое',
}

export const TRACKING_RU: Record<TrackingStatus, string> = {
  label_created: 'Создана этикетка',
  accepted_by_carrier: 'Принят перевозчиком',
  in_transit: 'В пути',
  delayed: 'Задержка',
  delivery_attempted: 'Попытка доставки',
  available_for_collection: 'Ждёт в пункте выдачи',
  delivered: 'Доставлен',
  returned_to_sender: 'Возвращён отправителю',
  lost: 'Утерян',
  unknown: 'Неизвестно',
}

export const ADVICE_RU: Record<NonDeliveryAdvice, string> = {
  wait_for_delivery_window: 'Подождать: срок доставки ещё не вышел',
  ask_customer_to_check: 'Попросить покупателя проверить (соседи, почтовый ящик, пункт выдачи)',
  open_carrier_investigation: 'Открыть расследование у перевозчика',
  resolve_in_customer_favour: 'Решить в пользу покупателя',
  manual_review: 'Нужна ручная оценка',
}

export const ADVICE_REASON_RU: Record<AdviceReason, string> = {
  inside_delivery_window: 'посылка ещё в пределах срока доставки',
  no_tracking: 'у магазина нет трек-номера — проверить нечем (пробел магазина)',
  label_only: 'есть только этикетка — посылку могли не передать перевозчику',
  tracking_conflicts: 'события отслеживания противоречат друг другу',
  carrier_reports_delivered: 'перевозчик пишет «доставлен» — это не доказательство получения',
  delivered_with_signature: 'доставлен с подписью',
  carrier_exception: 'у перевозчика исключение/задержка',
  returned_to_sender: 'посылка вернулась отправителю',
  carrier_confirms_lost: 'перевозчик подтвердил утерю',
  overdue_without_update: 'срок прошёл, новых событий нет',
  carrier_claim_open: 'претензия перевозчику уже открыта',
  awaiting_collection: 'посылка ждёт в пункте выдачи / была попытка доставки',
  in_transit_within_grace: 'в пути, в пределах запаса',
}

/** Commands as buttons. */
export const COMMAND_RU: Record<string, string> = {
  start_review: 'Взять в работу',
  request_info: 'Запросить информацию',
  authorize_return: 'Разрешить возврат товара',
  record_return_shipped: 'Отметить: возврат отправлен',
  mark_return_delivered: 'Отметить: возврат доставлен',
  receive_return: 'Принять возврат на склад',
  record_inspection: 'Записать результат проверки',
  restock: 'Вернуть на склад',
  approve: 'Одобрить',
  second_approve: 'Второе согласование',
  withdraw_approval: 'Отозвать одобрение',
  reject: 'Отклонить',
  initiate_refund: 'Вернуть деньги',
  check_refund: 'Проверить статус возврата',
  record_manual_refund: 'Записать ручную выплату',
  mark_resolved: 'Отметить: замена/повтор отправлены',
  cancel: 'Закрыть заявку',
  reopen: 'Открыть снова',
  resolve_dispute: 'Спор завершён',
  mark_disputed: 'Отметить спор по платежу',
  assign: 'Назначить',
  escalate: 'Эскалировать',
  de_escalate: 'Снять эскалацию',
  add_note: 'Внутренняя заметка',
  send_message: 'Сообщение покупателю',
  record_evidence: 'Записать отслеживание',
  update_investigation: 'Статус расследования',
  wait_for_delivery: 'Ждать до конца срока доставки',
  record_finding: 'Записать вывод',
  reassess_risk: 'Пересчитать риск',
}

export const FINDING_RU: Record<string, string> = {
  legitimate: 'Заявка обоснована',
  not_substantiated: 'Не подтвердилось',
  abuse_confirmed: 'Злоупотребление подтверждено',
}

export function chf(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '—'
  return `${(minor / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CHF`
}

export function dateRu(ms: number | null | undefined, withTime = true): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}
