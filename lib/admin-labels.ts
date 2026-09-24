import type { OrderStatus, PaymentStatus } from '@/lib/types'

// Russian labels for order and payment states, shared by the admin console's
// pages (the console is Russian-only — see lib/admin-i18n.ts).

export const ORDER_STATUS_LABELS_RU: Record<OrderStatus, string> = {
  pending: 'Ожидает',
  processing: 'В обработке',
  shipped: 'Отправлен',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
  refunded: 'Возврат',
}

export const PAYMENT_STATUS_LABELS_RU: Record<PaymentStatus, string> = {
  pending_payment: 'Ожидает оплаты',
  confirming: 'Подтверждается',
  paid: 'Оплачено',
  failed: 'Платёж не прошёл',
  expired: 'Истёк',
  refunded: 'Возвращено',
  partially_refunded: 'Частичный возврат',
}
