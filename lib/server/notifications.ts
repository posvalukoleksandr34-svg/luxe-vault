import 'server-only'

import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import type { DeliveryTimeframe } from '@/config/shipping'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { getShippingSettings } from '@/lib/server/store-settings'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Notification, NotificationType, StorefrontLocale } from '@/lib/types'

/**
 * Notification triggers, and the feed that shows them.
 *
 * Lives in lib/server/ rather than lib/ because every write here uses the
 * service-role key: migration 0010 grants no INSERT policy, so a notification
 * can only be created by trusted server code. If this module were importable
 * from a client component, bundling it would be a build error at best and a
 * leaked key at worst — `server-only` makes that failure loud and immediate.
 *
 * Every trigger is FIRE-AND-FORGET by design. A notification is a courtesy
 * attached to something that already happened: the payment really failed, the
 * parcel really shipped. Throwing from here would let a cosmetic insert
 * failure roll back or retry the real operation — in the Stripe webhook that
 * would mean re-running a money-state update because a bell icon did not
 * light up. So failures are logged and swallowed, and the caller is told
 * whether it worked without being forced to care.
 *
 * LANGUAGE. A notification is stored as WHAT happened — a template and its
 * parameters (migration 0046) — and put into words when it is READ, in the
 * language the reader has the storefront in. It used to be the other way
 * round: the text was written once, in the language of the order it was
 * about, so one account's bell mixed Italian (an order placed on /it), English
 * and — for rows from before the storefront dropped it — Russian, under a
 * header in whatever the page was in. Rows from before 0046 carry no template;
 * they are recognised from their text (recognise(), below) and re-rendered the
 * same way.
 *
 * `title` and `body` are still written, in the default language: they are
 * what a row reads as if it can be neither rendered nor recognised.
 */

/** What a notification says, before it is put into any language. */
type Template =
  | { key: 'payment_failed'; orderId: string; reason?: string }
  | { key: 'status'; orderId: string; status: string; tracking?: string; timeframe?: DeliveryTimeframe }
  | { key: 'return_refunded'; orderId: string }
  | { key: 'return_rejected'; orderId: string; note: string }

type NewNotification = {
  userId: string
  type: NotificationType
  template: Template
  /** In-app path, e.g. `/order/LV-ABC123`. Must start with "/". */
  actionUrl?: string
  orderId?: string
}

/** Set once the template columns turn out not to exist (0046 not applied). */
let templateColumnsMissing = false

function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    (/template|params/i.test(error.message ?? '') && /column/i.test(error.message ?? ''))
  )
}

async function insert(n: NewNotification): Promise<boolean> {
  const { title, body } = render(n.template, DEFAULT_LOCALE)
  const { key, ...params } = n.template
  const row = {
    user_id: n.userId,
    type: n.type,
    title: title.slice(0, 200),
    body: body ? body.slice(0, 500) : null,
    action_url: n.actionUrl ?? null,
    order_id: n.orderId ?? null,
  }
  try {
    const admin = createAdminClient()
    let { error } = templateColumnsMissing
      ? await admin.from('notifications').insert(row)
      : await admin.from('notifications').insert({ ...row, template: key, params })
    // Before 0046 the row is written without its template. It still renders
    // in the reader's language: recognise() reads it back from the text.
    if (error && !templateColumnsMissing && isMissingColumn(error)) {
      templateColumnsMissing = true
      console.warn('[notifications] notifications.template is missing — apply migration 0046.')
      ;({ error } = await admin.from('notifications').insert(row))
    }
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
 * Russian is absent deliberately: the storefront never shows it, and the
 * admin console reads orders, not notifications.
 */
type NotificationCopy = {
  paymentFailedTitle: (id: string) => string
  paymentFailedBody: string
  trackingPrefix: (tracking: string) => string
  statusTitles: Record<string, (id: string) => string>
  /** `{span}` is the admin's delivery timeframe, filled in at render time. */
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

/** For a row about an order that can be neither rendered nor recognised. */
const GENERIC_COPY: Record<StorefrontLocale, { title: (id: string) => string; body: string }> = {
  en: { title: (id) => `Update on order ${id}`, body: 'Open the order for the details.' },
  it: { title: (id) => `Aggiornamento sull’ordine ${id}`, body: 'Apri l’ordine per i dettagli.' },
  fr: { title: (id) => `Du nouveau pour la commande ${id}`, body: 'Ouvrez la commande pour les détails.' },
  de: { title: (id) => `Neuigkeiten zu Bestellung ${id}`, body: 'Öffnen Sie die Bestellung für die Details.' },
}

/**
 * The Russian copy notifications were written in until 3b507a3. Only READ now:
 * recognise() uses it to identify those rows, so they render in the reader's
 * language like any other.
 */
const LEGACY_RU = {
  paymentFailedTitle: (id: string) => `Платёж по заказу ${id} не прошёл`,
  paymentFailedBody: 'Списание не состоялось. Заказ сохранён — его можно оплатить повторно из личного кабинета.',
  trackingPrefix: (tracking: string) => `Трек-номер: ${tracking}. `,
  statusTitles: {
    processing: (id: string) => `Заказ ${id} принят в обработку`,
    shipped: (id: string) => `Заказ ${id} отправлен`,
    delivered: (id: string) => `Заказ ${id} доставлен`,
    cancelled: (id: string) => `Заказ ${id} отменён`,
    refunded: (id: string) => `По заказу ${id} оформлен возврат`,
  } as Record<string, (id: string) => string>,
}

// ------------------------------------------------------------------ render

/** The notification in words, in `locale`. `timeframe` stands in for a
 *  processing row that did not record its own (rows from before 0046). */
function render(
  t: Template,
  locale: StorefrontLocale,
  timeframe?: DeliveryTimeframe,
): { title: string; body?: string } {
  switch (t.key) {
    case 'payment_failed': {
      const copy = COPY[locale]
      // Stripe's own decline message when it gave one: more specific than
      // anything written here.
      return { title: copy.paymentFailedTitle(t.orderId), body: t.reason?.trim() || copy.paymentFailedBody }
    }
    case 'status': {
      const copy = COPY[locale]
      const title = copy.statusTitles[t.status]
      if (!title) return genericRender(t.orderId, locale)
      let body =
        t.status === 'shipped' && t.tracking
          ? `${copy.trackingPrefix(t.tracking)}${copy.statusBodies.shipped}`
          : copy.statusBodies[t.status]
      const range = t.timeframe ?? timeframe
      if (body.includes('{span}') && range) body = body.replace('{span}', describeBusinessDays(range, locale))
      return { title: title(t.orderId), body }
    }
    case 'return_refunded': {
      const copy = RETURN_COPY[locale]
      return { title: copy.refundedTitle(t.orderId), body: copy.refundedBody }
    }
    case 'return_rejected': {
      const copy = RETURN_COPY[locale]
      return {
        title: copy.rejectedTitle(t.orderId),
        body: `${copy.rejectedBody} ${t.note.trim().slice(0, 600)}`.trim(),
      }
    }
  }
}

function genericRender(orderId: string, locale: StorefrontLocale) {
  return { title: GENERIC_COPY[locale].title(orderId), body: GENERIC_COPY[locale].body }
}

// ------------------------------------------------------------------ recognise

const ID = '\u0000'

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A template function turned into an anchored pattern capturing its argument. */
function pattern(fn: (arg: string) => string, anchorEnd = true): RegExp {
  const [before, after] = fn(ID).split(ID)
  return new RegExp(`^${escape(before)}(.+?)${escape(after)}${anchorEnd ? '$' : ''}`, 's')
}

/** Every language a row may have been written in: the four, and old Russian. */
const WRITTEN_IN = [...Object.values(COPY), LEGACY_RU]

const TITLE_PATTERNS: { re: RegExp; kind: 'payment_failed' | 'return_refunded' | 'return_rejected' | string }[] = [
  ...WRITTEN_IN.map((c) => ({ re: pattern(c.paymentFailedTitle), kind: 'payment_failed' })),
  ...WRITTEN_IN.flatMap((c) =>
    Object.entries(c.statusTitles).map(([status, fn]) => ({ re: pattern(fn), kind: `status:${status}` })),
  ),
  ...Object.values(RETURN_COPY).flatMap((c) => [
    { re: pattern(c.refundedTitle), kind: 'return_refunded' },
    { re: pattern(c.rejectedTitle), kind: 'return_rejected' },
  ]),
]
const TRACKING_PATTERNS = WRITTEN_IN.map((c) => pattern(c.trackingPrefix, false))
const DEFAULT_PAYMENT_BODIES = new Set(WRITTEN_IN.map((c) => c.paymentFailedBody))
const REJECTED_PREFIXES = Object.values(RETURN_COPY).map((c) => c.rejectedBody)

/**
 * The template a row was written from, read back from its text: for rows
 * written before migration 0046, which stored only the words. Every such row
 * came from one of the copy tables above (or the Russian they replaced), so
 * its title identifies it exactly, and the parts that vary — order number,
 * tracking number, a decline or rejection reason — are recovered verbatim.
 */
export function recognise(title: string, body: string | undefined, orderId?: string): Template | null {
  for (const { re, kind } of TITLE_PATTERNS) {
    const match = re.exec(title)
    if (!match) continue
    const id = orderId || match[1]
    if (kind === 'payment_failed') {
      const reason = body && !DEFAULT_PAYMENT_BODIES.has(body) ? body : undefined
      return { key: 'payment_failed', orderId: id, reason }
    }
    if (kind === 'return_refunded') return { key: 'return_refunded', orderId: id }
    if (kind === 'return_rejected') {
      const prefix = REJECTED_PREFIXES.find((p) => body?.startsWith(p))
      return { key: 'return_rejected', orderId: id, note: prefix ? body!.slice(prefix.length).trim() : body ?? '' }
    }
    const status = kind.slice('status:'.length)
    const tracking = body ? TRACKING_PATTERNS.map((re) => re.exec(body)?.[1]).find(Boolean) : undefined
    return { key: 'status', orderId: id, status, tracking }
  }
  return null
}

function isTemplate(key: unknown, params: unknown): boolean {
  return (
    typeof key === 'string' &&
    ['payment_failed', 'status', 'return_refunded', 'return_rejected'].includes(key) &&
    typeof params === 'object' &&
    params !== null &&
    typeof (params as { orderId?: unknown }).orderId === 'string'
  )
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
    template: { key: 'payment_failed', orderId: params.orderId, reason: params.reason?.trim() || undefined },
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
  if (!COPY[DEFAULT_LOCALE].statusTitles[params.status]) return false
  // The timeframe as it stands NOW, kept with the row: "usually 10–14 days"
  // is a promise made at this moment, not whatever the setting says later.
  const timeframe =
    params.status === 'processing' ? (await getShippingSettings()).deliveryTimeframe : undefined
  return insert({
    userId: params.userId,
    type: 'status_update',
    template: {
      key: 'status',
      orderId: params.orderId,
      status: params.status,
      tracking: params.trackingNumber?.trim() || undefined,
      timeframe,
    },
    actionUrl: `/order/${encodeURIComponent(params.orderId)}`,
    orderId: params.orderId,
  })
}


export async function notifyReturnDecision(params: {
  userId: string
  orderId: string
  outcome: 'refunded' | 'rejected'
  /** Required in practice for a rejection; the schema enforces it upstream. */
  note?: string
}): Promise<boolean> {
  return insert({
    userId: params.userId,
    type: 'status_update',
    template:
      params.outcome === 'refunded'
        ? { key: 'return_refunded', orderId: params.orderId }
        : { key: 'return_rejected', orderId: params.orderId, note: (params.note ?? '').trim().slice(0, 600) },
    actionUrl: `/order/${encodeURIComponent(params.orderId)}`,
    orderId: params.orderId,
  })
}

// ---------------------------------------------------------------------- read

/**
 * A row in the reader's language: from its template, else from the template
 * its text is recognised as, else — a row about an order that matches
 * neither — a generic line pointing at the order, rather than words in
 * another language. A row with no order at all keeps its own text.
 */
export function rowToNotification(
  row: Record<string, unknown>,
  locale: StorefrontLocale,
  timeframe: DeliveryTimeframe | undefined,
): Notification {
  const orderId = (row.order_id as string | null) ?? undefined
  const storedTitle = row.title as string
  const storedBody = (row.body as string | null) ?? undefined
  const template = templateOf(row)
  const text = template
    ? render(template, locale, timeframe)
    : orderId
      ? genericRender(orderId, locale)
      : { title: storedTitle, body: storedBody }
  return {
    id: row.id as string,
    createdAt: Date.parse(row.created_at as string),
    type: row.type as NotificationType,
    title: text.title,
    body: text.body,
    actionUrl: (row.action_url as string | null) ?? undefined,
    orderId,
    isRead: Boolean(row.is_read),
  }
}

function templateOf(row: Record<string, unknown>): Template | null {
  if (isTemplate(row.template, row.params)) {
    return { key: row.template, ...(row.params as object) } as Template
  }
  return recognise(
    row.title as string,
    (row.body as string | null) ?? undefined,
    (row.order_id as string | null) ?? undefined,
  )
}

/**
 * A user's recent notifications, newest first, in `locale`.
 *
 * Capped rather than paginated: a bell panel is a glance, not an archive, and
 * an unbounded query on a chatty account would ship kilobytes on every page
 * load. The unread count is returned separately so the badge stays correct
 * even when unread items fall outside the window.
 */
export async function listNotifications(
  userId: string,
  limit = 30,
  locale: StorefrontLocale = DEFAULT_LOCALE,
): Promise<{ notifications: Notification[]; unreadCount: number }> {
  const admin = createAdminClient()

  const [listRes, countRes] = await Promise.all([
    // `*`, not a column list: the template columns exist only once migration
    // 0046 is applied, and naming them would fail the read before then.
    admin
      .from('notifications')
      .select('*')
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

  const rows = (listRes.data ?? []) as Record<string, unknown>[]
  // A processing row from before 0046 did not keep its timeframe; the current
  // one stands in. Read only when such a row is on screen.
  const needsTimeframe = rows.some((row) => {
    const t = templateOf(row)
    return t?.key === 'status' && t.status === 'processing' && !t.timeframe
  })
  const timeframe = needsTimeframe ? (await getShippingSettings()).deliveryTimeframe : undefined

  return {
    notifications: rows.map((row) => rowToNotification(row, locale, timeframe)),
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
