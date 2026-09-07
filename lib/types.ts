export type Locale = 'ru' | 'en' | 'it' | 'fr' | 'de'

export type LocalizedText = Record<Locale, string>

/**
 * Collection and category slugs.
 *
 * These were compile-time unions ('clothing' | 'shoes' | ...) back when the
 * catalogue lived in lib/data.ts. They are plain strings now because
 * collections are rows in public.collections that the admin can create at
 * runtime — a fixed union would make "add a new collection" impossible
 * without a redeploy. Validity is enforced by the foreign keys in Postgres.
 */
export type CategoryGroupKey = string
export type CategoryKey = string

/** A top-level collection (clothing / shoes / ...) as stored in Postgres. */
export type Collection = {
  id: string
  slug: string
  name: LocalizedText
  image?: string
  sortOrder: number
}

/** A category nested under a collection. */
export type Category = {
  id: string
  collectionId: string
  collectionSlug: string
  slug: string
  name: LocalizedText
  sortOrder: number
}

export type StatusKey =
  | 'in_stock'
  | 'out_of_stock'
  | 'mirror_quality'
  | 'limited_edition'
  | 'premium_quality'

/**
 * A colour variant.
 *
 * `name` and `hex` were the whole model; `image` and `stock` are additive and
 * optional, so every product already in the catalogue stays valid — the column
 * is jsonb, which is why widening the shape needs no migration.
 *
 * `stock` is deliberately `undefined` rather than `0` when untracked: zero
 * means "sold out", absent means "we do not count this one", and collapsing
 * the two would hide every legacy variant from the storefront.
 */
export type Color = {
  name: string
  hex: string
  /** Swatch or variant photo shown when this colour is selected. */
  image?: string
  /** Units on hand. Undefined = not tracked; 0 = sold out. */
  stock?: number
}

export type SizeMeasurement = {
  size: string
  length: number
  chest: number
  shoulder: number
  sleeve: number
}

export type Product = {
  id: string
  name: LocalizedText
  group: CategoryGroupKey
  category: CategoryKey
  price: number
  oldPrice?: number
  sizes: string[]
  colors: Color[]
  image: string
  images?: string[]
  description: LocalizedText
  statuses: StatusKey[]
  isNew?: boolean
  limited?: boolean
  sizeChart?: SizeMeasurement[]
}

export type CartItem = {
  key: string
  productId: string
  name: string
  image: string
  price: number
  size: string
  color: string
  qty: number
}

/** Fulfilment lifecycle. Matches the `public.order_status` enum in Postgres —
 *  changing one without the other will fail at the database boundary. */
export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'

export const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
]

/** Payment lifecycle of an order, independent of the fulfillment `status`
 * above. An order that needs paying up front is stored as `pending_payment`
 * the moment it's placed — never discarded — so the customer can settle it
 * later from their account. Only a signature-verified webhook
 * (/api/payments/crypto/webhook for NOWPayments, /api/payments/stripe/webhook
 * for Stripe) may advance it to `paid`; the client never writes a payment
 * status directly, and a return from the provider's hosted page is treated as
 * a navigation hint, never as proof of payment. */
export type PaymentStatus =
  | 'pending_payment'
  | 'confirming'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'refunded'
  /** Money partially returned. Deliberately distinct from 'refunded': the
   *  order still holds funds and must remain distinguishable in reporting. */
  | 'partially_refunded'

/** Mirrors the public.return_status enum. */
export type ReturnStatus = 'none' | 'requested' | 'approved' | 'refunded'

export type CustomerAddress = {
  /** Full single-line address, composed from the structured parts below.
   * Kept for admin display and for orders placed before structured input. */
  address: string
  street?: string
  postalCode?: string
  city?: string
  country?: string
}

export type Order = {
  id: string
  createdAt: number
  customer: {
    name: string
    phone: string
    address: string
    email?: string
    street?: string
    postalCode?: string
    city?: string
    country?: string
  }
  items: CartItem[]
  subtotal: number
  discount: number
  total: number
  promo?: string
  payment: string
  status: OrderStatus

  /** Random per-order secret. The browser that placed the order keeps it in
   * local storage; /api/orders/lookup and the "pay later" endpoint require
   * it, so an order can never be read or re-paid by guessing its id. */
  lookupToken?: string

  /** auth.users.id when the buyer was signed in; undefined for guest checkout. */
  userId?: string

  /** Carrier reference, set by the admin when the order is marked `shipped`. */
  trackingNumber?: string
  /** Carrier handling the parcel, e.g. "Swiss Post". Drives the deep-link. */
  courierName?: string

  /** Shipping tier chosen at checkout. */
  shippingType?: 'standard' | 'express'
  /** Delivery window QUOTED AT PURCHASE, in absolute dates. Stamped once and
   *  never recomputed, so a later config change cannot silently re-date an
   *  order the customer was already given a promise for. */
  deliveryEstimateMin?: number
  deliveryEstimateMax?: number

  /** Status timeline, stamped in Postgres by the orders_stamp_status trigger.
   *  Drives the customer-facing progress bar. */
  processingAt?: number
  shippedAt?: number
  deliveredAt?: number
  cancelledAt?: number

  /** Set for every order: since SBP and cash on delivery were removed, every
   * remaining method is paid up front. */
  paymentStatus?: PaymentStatus
  paymentProvider?: 'nowpayments' | 'stripe'
  paymentId?: string
  paymentCurrency?: string
  paymentAddress?: string
  paymentAmount?: number

  /** Refund lifecycle. A customer may only move 'none' -> 'requested';
   *  approving and actually refunding are admin/service-role actions. */
  returnStatus?: ReturnStatus
  returnReason?: string
  returnRequestedAt?: number

  /** Why the order was cancelled, when a reason was supplied. */
  cancelledReason?: string
  /** Cumulative amount refunded, in the same units as `total`. */
  refundedAmount?: number
  refundedAt?: number
  /** Most recent Stripe refund id, for reconciliation. */
  stripeRefundId?: string

  /** When the payment receipt was sent. Claimed before sending, so a Stripe
   *  webhook retry cannot produce a second copy. */
  receiptSentAt?: number
}

export type Promo = {
  code: string
  percent: number
  active: boolean
}

/**
 * The signed-in customer, as the app sees them.
 *
 * Identity now lives in Supabase Auth (`auth.users`) and the display name in
 * `public.profiles`. There is deliberately no `password` field: credentials
 * are never held in application state or local storage — Supabase issues an
 * httpOnly cookie session instead.
 */
export type User = {
  /** auth.users.id — the uuid that orders, reviews and returns hang off. */
  id: string
  email: string
  name: string
}

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export type Review = {
  id: string
  name: string
  rating: number
  message: string
  createdAt: number
  status: ReviewStatus
}

export type SupportTicketStatus = 'open' | 'resolved'

export type SupportTicket = {
  id: string
  name: string
  email: string
  message: string
  createdAt: number
  status: SupportTicketStatus
}


/** Mirrors the public.notification_type enum. */
export type NotificationType = 'payment_failed' | 'status_update'

/**
 * An in-app notification, as the bell and its panel consume it.
 *
 * Distinct from the transactional emails in lib/server/mailer.ts: email is
 * push (it reaches someone who is away), this is pull (it waits for them to
 * come back). A payment failure warrants both.
 */
export type Notification = {
  id: string
  createdAt: number
  type: NotificationType
  title: string
  body?: string
  /** In-app path, e.g. `/order/LV-ABC123`. Always relative. */
  actionUrl?: string
  orderId?: string
  isRead: boolean
}
