export type Locale = 'ru' | 'en' | 'it' | 'fr' | 'de'

export type LocalizedText = Record<Locale, string>

export type CategoryGroupKey = 'clothing' | 'shoes' | 'accessories'

export type CategoryKey =
  | 'hoodies'
  | 'tshirts'
  | 'jackets'
  | 'sneakers'
  | 'sneakers_low'
  | 'bags'
  | 'caps'

export type StatusKey =
  | 'in_stock'
  | 'out_of_stock'
  | 'mirror_quality'
  | 'limited_edition'
  | 'premium_quality'

export type Color = {
  name: string
  hex: string
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

export type OrderStatus = 'В обработке' | 'Отправлен' | 'Доставлен' | 'Отменён'

/** Payment lifecycle of an order, independent of the fulfillment `status`
 * above. An order that needs paying up front is stored as `pending_payment`
 * the moment it's placed — never discarded — so the customer can settle it
 * later from their account. Only the signature-verified webhook at
 * /api/payments/crypto/webhook may advance it to `paid`; the client never
 * writes a payment status directly. */
export type PaymentStatus =
  | 'pending_payment'
  | 'confirming'
  | 'paid'
  | 'failed'
  | 'expired'

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

  /** Set for every order that requires payment up front (i.e. everything
   * except cash on delivery). */
  paymentStatus?: PaymentStatus
  paymentProvider?: 'nowpayments'
  paymentId?: string
  paymentCurrency?: string
  paymentAddress?: string
  paymentAmount?: number
}

export type Promo = {
  code: string
  percent: number
  active: boolean
}

export type User = {
  email: string
  name: string
  password: string
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
