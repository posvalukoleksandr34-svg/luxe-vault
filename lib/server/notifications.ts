import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { Notification, NotificationType } from '@/lib/types'

/**
 * Notification triggers.
 *
 * Lives in lib/server/ rather than lib/ because every write here uses the
 * service-role key: migration 0010 grants no INSERT policy, so a notification
 * can only be created by trusted server code. If this module were importable
 * from a client component, bundling it would be a build error at best and a
 * leaked key at worst — `server-only` makes that failure loud and immediate.
 *
 * Every function here is FIRE-AND-FORGET by design. A notification is a
 * courtesy attached to something that already happened: the payment really
 * failed, the parcel really shipped. Throwing from here would let a cosmetic
 * insert failure roll back or retry the real operation — in the Stripe webhook
 * that would mean re-running a money-state update because a bell icon did not
 * light up. So failures are logged and swallowed, and the caller is told
 * whether it worked without being forced to care.
 */

type NewNotification = {
  userId: string
  type: NotificationType
  title: string
  body?: string
  /** In-app path, e.g. `/order/LV-ABC123`. Must start with "/". */
  actionUrl?: string
  orderId?: string
}

async function insert(n: NewNotification): Promise<boolean> {
  try {
    const { error } = await createAdminClient().from('notifications').insert({
      user_id: n.userId,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      action_url: n.actionUrl ?? null,
      order_id: n.orderId ?? null,
    })

    if (error) {
      console.warn(`[notifications] insert failed (${n.type}): ${error.message}`)
      return false
    }
    return true
  } catch (error) {
    console.warn('[notifications] insert threw:', error)
    return false
  }
}

/**
 * A payment attempt failed.
 *
 * Called from the Stripe webhook on `payment_intent.payment_failed`. The order
 * survives as unpaid, so the notification points at it — the customer can
 * retry from there with the same method they originally chose.
 */
export async function notifyPaymentFailed(params: {
  userId: string
  orderId: string
  /** Stripe's customer-facing decline message, when it gave one. */
  reason?: string
}): Promise<boolean> {
  return insert({
    userId: params.userId,
    type: 'payment_failed',
    title: `Платёж по заказу ${params.orderId} не прошёл`,
    body:
      params.reason?.trim() ||
      'Списание не состоялось. Заказ сохранён — его можно оплатить повторно из личного кабинета.',
    actionUrl: `/order/${encodeURIComponent(params.orderId)}`,
    orderId: params.orderId,
  })
}

/** Human-readable fulfilment states, matching the storefront's own labels. */
const STATUS_TITLES: Record<string, string> = {
  processing: 'Заказ {id} принят в обработку',
  shipped: 'Заказ {id} отправлен',
  delivered: 'Заказ {id} доставлен',
  cancelled: 'Заказ {id} отменён',
  refunded: 'По заказу {id} оформлен возврат',
}

const STATUS_BODIES: Record<string, string> = {
  processing: 'Позиция заказана у поставщика и проходит проверку качества. Обычно 20–35 дней.',
  shipped: 'Посылка передана Швейцарской почте. Трек-номер доступен на странице заказа.',
  delivered: 'Посылка вручена. С этого момента у вас есть 14 дней на возврат.',
  cancelled: 'Заказ отменён. Если списание было — средства вернутся автоматически.',
  refunded: 'Возврат отправлен в банк. Обычно зачисление занимает 5–10 рабочих дней.',
}

/**
 * An order's fulfilment status changed.
 *
 * Called from the admin order PATCH. `pending` is deliberately not notified:
 * it is the state an order is created in, so a notification would fire on
 * every checkout to tell the customer what they just did.
 */
export async function notifyStatusUpdate(params: {
  userId: string
  orderId: string
  status: string
  trackingNumber?: string | null
}): Promise<boolean> {
  const template = STATUS_TITLES[params.status]
  if (!template) return false

  const body =
    params.status === 'shipped' && params.trackingNumber
      ? `Трек-номер: ${params.trackingNumber}. ${STATUS_BODIES.shipped}`
      : STATUS_BODIES[params.status]

  return insert({
    userId: params.userId,
    type: 'status_update',
    title: template.replace('{id}', params.orderId),
    body,
    actionUrl: `/order/${encodeURIComponent(params.orderId)}`,
    orderId: params.orderId,
  })
}

// ---------------------------------------------------------------------- read

function rowToNotification(row: Record<string, unknown>): Notification {
  return {
    id: row.id as string,
    createdAt: Date.parse(row.created_at as string),
    type: row.type as NotificationType,
    title: row.title as string,
    body: (row.body as string | null) ?? undefined,
    actionUrl: (row.action_url as string | null) ?? undefined,
    orderId: (row.order_id as string | null) ?? undefined,
    isRead: Boolean(row.is_read),
  }
}

/**
 * A user's recent notifications, newest first.
 *
 * Capped rather than paginated: a bell panel is a glance, not an archive, and
 * an unbounded query on a chatty account would ship kilobytes on every page
 * load. The unread count is returned separately so the badge stays correct
 * even when unread items fall outside the window.
 */
export async function listNotifications(
  userId: string,
  limit = 30,
): Promise<{ notifications: Notification[]; unreadCount: number }> {
  const admin = createAdminClient()

  const [listRes, countRes] = await Promise.all([
    admin
      .from('notifications')
      .select('id, created_at, type, title, body, action_url, order_id, is_read')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100)),
    // head:true — the rows are not needed, only the number.
    admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false),
  ])

  if (listRes.error) throw new Error(`Failed to read notifications: ${listRes.error.message}`)

  return {
    notifications: (listRes.data ?? []).map(rowToNotification),
    unreadCount: countRes.count ?? 0,
  }
}

/**
 * Marks notifications read.
 *
 * `ids` omitted means "all of this user's unread". Every query is scoped by
 * user_id even though the caller has already authenticated — an id supplied by
 * a client is not proof of ownership, and without the scope a guessed uuid
 * would let one account mark another's notifications read.
 *
 * read_at is stamped by a database trigger, never sent from here.
 */
export async function markNotificationsRead(
  userId: string,
  ids?: string[],
): Promise<number> {
  const admin = createAdminClient()
  let query = admin
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false)

  if (ids && ids.length > 0) query = query.in('id', ids)

  const { data, error } = await query.select('id')
  if (error) throw new Error(`Failed to mark notifications read: ${error.message}`)
  return data?.length ?? 0
}
