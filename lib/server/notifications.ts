import 'server-only'

import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { toStorefrontLocale } from '@/lib/i18n'
import { getOrderLocale } from '@/lib/server/order-locale'
import { getShippingSettings } from '@/lib/server/store-settings'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Notification, NotificationType, StorefrontLocale } from '@/lib/types'

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
 * Notification copy, in the four languages the storefront can be read in.
 *
 * These were Russian literals, which put Cyrillic in the bell panel of a shop
 * that shows Russian nowhere else. They are written into the database as text,
 * so there is no re-rendering them later in another language — the language is
 * chosen once, here, from the order the notification is about.
 *
 * Russian is absent deliberately, including for an order placed back when the
 * storefront still offered it: `localeOf` clamps that away. The admin console
 * reads orders, not notifications, so nothing here needs the console's Russian.
 */
type NotificationCopy = {
  paymentFailedTitle: (id: string) => string
  paymentFailedBody: string
  trackingPrefix: (tracking: string) => string
  statusTitles: Record<string, (id: string) => string>
  /** `{span}` is the admin's delivery timeframe, filled in at send time. */
  statusBodies: Record<string, string>
}

const COPY: Record<StorefrontLocale, NotificationCopy> = {
  en: {
    paymentFailedTitle: (id) => `Payment for order ${id} did not go through`,
    paymentFailedBody:
      'The charge did not complete. Your order is saved — you can pay for it again from your account.',
    trackingPrefix: (tracking) => `Tracking number: ${tracking}. `,
    statusTitles: {
      processing: (id) => `Order ${id} is being prepared`,
      shipped: (id) => `Order ${id} has shipped`,
      delivered: (id) => `Order ${id} was delivered`,
      cancelled: (id) => `Order ${id} was cancelled`,
      refunded: (id) => `Order ${id} has been refunded`,
    },
    statusBodies: {
      processing:
        'Your piece has been ordered from the supplier and is going through quality control. Delivery usually takes {span}.',
      shipped: 'The parcel is with Swiss Post. The tracking number is on the order page.',
      delivered: `The parcel has been handed over. You have ${FULFILMENT.returnWindowDays} days from now to return it.`,
      cancelled: 'The order was cancelled. If you were charged, the money comes back automatically.',
      refunded: `The refund is on its way to your bank. It usually takes ${FULFILMENT.refund.min}–${FULFILMENT.refund.max} business days to appear.`,
    },
  },
  it: {
    paymentFailedTitle: (id) => `Il pagamento dell’ordine ${id} non è andato a buon fine`,
    paymentFailedBody:
      'L’addebito non è riuscito. Il tuo ordine è salvato: puoi pagarlo di nuovo dal tuo account.',
    trackingPrefix: (tracking) => `Numero di tracciamento: ${tracking}. `,
    statusTitles: {
      processing: (id) => `L’ordine ${id} è in preparazione`,
      shipped: (id) => `L’ordine ${id} è stato spedito`,
      delivered: (id) => `L’ordine ${id} è stato consegnato`,
      cancelled: (id) => `L’ordine ${id} è stato annullato`,
      refunded: (id) => `L’ordine ${id} è stato rimborsato`,
    },
    statusBodies: {
      processing:
        'Il capo è stato ordinato al fornitore ed è in controllo qualità. La consegna richiede di solito {span}.',
      shipped: 'Il pacco è stato affidato a Swiss Post. Il numero di tracciamento è nella pagina dell’ordine.',
      delivered: `Il pacco è stato consegnato. Da questo momento hai ${FULFILMENT.returnWindowDays} giorni per il reso.`,
      cancelled: 'L’ordine è stato annullato. Se c’è stato un addebito, l’importo torna automaticamente.',
      refunded: `Il rimborso è stato inviato alla banca. Di solito servono ${FULFILMENT.refund.min}–${FULFILMENT.refund.max} giorni lavorativi.`,
    },
  },
  fr: {
    paymentFailedTitle: (id) => `Le paiement de la commande ${id} n’a pas abouti`,
    paymentFailedBody:
      'Le débit n’a pas abouti. Votre commande est conservée : vous pouvez la régler à nouveau depuis votre compte.',
    trackingPrefix: (tracking) => `Numéro de suivi : ${tracking}. `,
    statusTitles: {
      processing: (id) => `La commande ${id} est en préparation`,
      shipped: (id) => `La commande ${id} a été expédiée`,
      delivered: (id) => `La commande ${id} a été livrée`,
      cancelled: (id) => `La commande ${id} a été annulée`,
      refunded: (id) => `La commande ${id} a été remboursée`,
    },
    statusBodies: {
      processing:
        'La pièce a été commandée auprès du fournisseur et passe le contrôle qualité. La livraison prend généralement {span}.',
      shipped: 'Le colis a été remis à la Poste suisse. Le numéro de suivi figure sur la page de la commande.',
      delivered: `Le colis a été remis. Vous avez ${FULFILMENT.returnWindowDays} jours à partir de maintenant pour le retourner.`,
      cancelled: 'La commande a été annulée. Si un débit a eu lieu, le montant est restitué automatiquement.',
      refunded: `Le remboursement a été envoyé à votre banque. Il faut généralement ${FULFILMENT.refund.min} à ${FULFILMENT.refund.max} jours ouvrables.`,
    },
  },
  de: {
    paymentFailedTitle: (id) => `Die Zahlung für Bestellung ${id} ist fehlgeschlagen`,
    paymentFailedBody:
      'Die Abbuchung kam nicht zustande. Ihre Bestellung bleibt bestehen — Sie können sie aus Ihrem Konto erneut bezahlen.',
    trackingPrefix: (tracking) => `Sendungsnummer: ${tracking}. `,
    statusTitles: {
      processing: (id) => `Bestellung ${id} wird vorbereitet`,
      shipped: (id) => `Bestellung ${id} wurde versandt`,
      delivered: (id) => `Bestellung ${id} wurde zugestellt`,
      cancelled: (id) => `Bestellung ${id} wurde storniert`,
      refunded: (id) => `Bestellung ${id} wurde erstattet`,
    },
    statusBodies: {
      processing:
        'Das Stück ist beim Lieferanten bestellt und wird geprüft. Die Lieferung dauert üblicherweise {span}.',
      shipped: 'Das Paket ist bei der Schweizerischen Post. Die Sendungsnummer steht auf der Bestellseite.',
      delivered: `Das Paket wurde übergeben. Ab jetzt haben Sie ${FULFILMENT.returnWindowDays} Tage für eine Rückgabe.`,
      cancelled: 'Die Bestellung wurde storniert. Falls abgebucht wurde, kommt der Betrag automatisch zurück.',
      refunded: `Die Erstattung ist auf dem Weg zu Ihrer Bank. Üblicherweise dauert die Gutschrift ${FULFILMENT.refund.min}–${FULFILMENT.refund.max} Werktage.`,
    },
  },
}

/** The language to write a notification about this order in: the one the order
 *  was placed in, clamped to what the storefront can still show. */
async function localeOf(orderId: string): Promise<StorefrontLocale> {
  return toStorefrontLocale(await getOrderLocale(orderId))
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
  const copy = COPY[await localeOf(params.orderId)]
  return insert({
    userId: params.userId,
    type: 'payment_failed',
    // Stripe's own decline message when it gave one: already in the
    // customer's language, and more specific than anything written here.
    title: copy.paymentFailedTitle(params.orderId),
    body: params.reason?.trim() || copy.paymentFailedBody,
    actionUrl: `/order/${encodeURIComponent(params.orderId)}`,
    orderId: params.orderId,
  })
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
  const locale = await localeOf(params.orderId)
  const copy = COPY[locale]
  const title = copy.statusTitles[params.status]
  if (!title) return false

  let body =
    params.status === 'shipped' && params.trackingNumber
      ? `${copy.trackingPrefix(params.trackingNumber)}${copy.statusBodies.shipped}`
      : copy.statusBodies[params.status]
  if (body.includes('{span}')) {
    const { deliveryTimeframe } = await getShippingSettings()
    body = body.replace('{span}', describeBusinessDays(deliveryTimeframe, locale))
  }

  return insert({
    userId: params.userId,
    type: 'status_update',
    title: title(params.orderId),
    body,
    actionUrl: `/order/${encodeURIComponent(params.orderId)}`,
    orderId: params.orderId,
  })
}

/**
 * The outcome of a return request, told to the customer who filed it.
 *
 * A REJECTION CARRIES ITS REASON, verbatim from the manager. "Your return was
 * declined" with nothing after it is precisely the message that turns into a
 * support ticket — or a chargeback, which is the customer asking their bank
 * the question we did not answer. The schema already refuses a rejection
 * without a note; this is where that note reaches the person it is for.
 *
 * `refunded` is sent when the money has actually gone back — on a Stripe
 * approval immediately, on a hand-refunded one when the manager marks it done
 * — never on approval alone. "Approved" followed by no money is worse than
 * silence.
 */
const RETURN_COPY: Record<
  StorefrontLocale,
  { refundedTitle: (id: string) => string; refundedBody: string; rejectedTitle: (id: string) => string; rejectedBody: string }
> = {
  en: {
    refundedTitle: (id) => `Your return for ${id} is approved`,
    refundedBody: 'The refund is on its way to your original payment method.',
    rejectedTitle: (id) => `Your return for ${id} was declined`,
    rejectedBody: 'Our team reviewed it and could not accept it:',
  },
  it: {
    refundedTitle: (id) => `Il reso dell’ordine ${id} è stato approvato`,
    refundedBody: 'Il rimborso è in arrivo sul metodo di pagamento originale.',
    rejectedTitle: (id) => `Il reso dell’ordine ${id} non è stato accettato`,
    rejectedBody: 'Il nostro team l’ha esaminato e non ha potuto accettarlo:',
  },
  fr: {
    refundedTitle: (id) => `Votre retour pour ${id} est approuvé`,
    refundedBody: 'Le remboursement est en route vers votre moyen de paiement d’origine.',
    rejectedTitle: (id) => `Votre retour pour ${id} a été refusé`,
    rejectedBody: 'Notre équipe l’a examiné et n’a pas pu l’accepter :',
  },
  de: {
    refundedTitle: (id) => `Ihre Rückgabe für ${id} ist genehmigt`,
    refundedBody: 'Die Erstattung ist auf dem Weg zu Ihrer ursprünglichen Zahlungsmethode.',
    rejectedTitle: (id) => `Ihre Rückgabe für ${id} wurde abgelehnt`,
    rejectedBody: 'Unser Team hat sie geprüft und konnte sie nicht annehmen:',
  },
}

export async function notifyReturnDecision(params: {
  userId: string
  orderId: string
  outcome: 'refunded' | 'rejected'
  /** Required in practice for a rejection; the schema enforces it upstream. */
  note?: string
}): Promise<boolean> {
  const copy = RETURN_COPY[await localeOf(params.orderId)]
  const refunded = params.outcome === 'refunded'
  return insert({
    userId: params.userId,
    type: 'status_update',
    title: refunded ? copy.refundedTitle(params.orderId) : copy.rejectedTitle(params.orderId),
    body: refunded
      ? copy.refundedBody
      : `${copy.rejectedBody} ${(params.note ?? '').trim().slice(0, 600)}`.trim(),
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
