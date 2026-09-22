import { NextResponse, type NextRequest } from 'next/server'
import { enforceLimit } from '@/lib/server/rate-limit'
import { addOrder, InsufficientStockError } from '@/lib/server/orders-store'
import {
  buildOrder,
  repriceItems,
  validateOrderDraft,
  type OrderDraftBody,
} from '@/lib/server/order-drafts'
import { emailLang } from '@/lib/server/emails/copy'
import { isMailConfigured, sendOrderConfirmation } from '@/lib/server/mailer'
import { setOrderLocale } from '@/lib/server/order-locale'
import { markCartRecovered } from '@/lib/server/abandoned-carts'
import { attachReferralOrder } from '@/lib/server/referrals'
import { getCurrentUser } from '@/lib/supabase/server'
import { reportServerError } from '@/lib/monitoring/alert'
import { readJsonObject } from '@/lib/server/http'
import { notifyNewOrder } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

/**
 * Public endpoint used by checkout to place an order. The server — not the
 * browser — mints the id, the lookup token and the payment status, and
 * re-runs every checkout validation rule before writing anything.
 *
 * Orders that still need paying are stored as `pending_payment` rather than
 * being thrown away, so the customer can pay them later.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('order.create', request)
  if (limited) return limited

  const body = await readJsonObject<OrderDraftBody>(request)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const result = validateOrderDraft(body)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  /**
   * Account or guest — and guest only when the customer SAID so.
   *
   * Guest checkout is supported end to end by the schema (orders.user_id is
   * nullable by design, 0002) and by every step after this one: the order's
   * lookup_token, which the browser keeps, is what the Stripe intent route,
   * /api/orders/lookup, the success page and /order/[id] all authorise with.
   *
   * What must never come back is the silent downgrade behind LV-JX59CL: a
   * session lookup blipped, the order quietly became a guest order, and a
   * real, paid order never appeared in its owner's account. So the guest
   * path is opt-in, never inferred:
   *
   *  - `guest: true` — chosen at "Продолжить без регистрации". If the
   *    customer turns out to be signed in after all (another tab), the order
   *    goes to their account; that is theirs, not a downgrade.
   *  - anything else — the browser expected an account. No session, or a
   *    session that cannot be checked, is a hard error the customer can act
   *    on, exactly as before.
   *
   * Read from the verified cookie via getUser(), never from a user id in the
   * body — a client-supplied id would let anyone file orders against another
   * account.
   */
  const declaredGuest = (body as { guest?: unknown }).guest === true

  let userId: string | undefined
  try {
    userId = (await getCurrentUser())?.id
  } catch {
    if (!declaredGuest) {
      return NextResponse.json(
        { error: 'We could not confirm your session. Please try again.' },
        { status: 503 },
      )
    }
    // A declared guest has no session to lose, so an auth hiccup must not
    // cost the sale: the order proceeds as the guest order they asked for.
    userId = undefined
  }

  if (!userId && !declaredGuest) {
    // The browser believed it was signed in and the server sees no session —
    // typically one that expired mid-checkout. Say so; never file it as a
    // guest order behind the customer's back.
    return NextResponse.json(
      { error: 'Your session has expired. Sign in again, or order without an account.' },
      { status: 401 },
    )
  }

  // Reprice from the catalogue before anything is persisted. The body's
  // prices and totals are advisory only — see repriceItems().
  // userId scopes coupons issued to one customer; the draft carries it so
  // repriceItems can validate a personal code. A guest simply has none.
  const priced = await repriceItems({ ...result.draft, userId })
  if (!priced.ok) {
    return NextResponse.json({ error: priced.error }, { status: 400 })
  }

  const order = buildOrder(priced.draft, userId)

  try {
    await addOrder(order)
  } catch (e) {
    // Running out between adding to the cart and paying is an ordinary race,
    // not a server fault. 409 with the item named lets the cart say which line
    // to change instead of showing a generic failure.
    if (e instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: 'OUT_OF_STOCK', item: e.message },
        { status: 409 },
      )
    }
    // Anything else is a customer who tried to buy and could not. Reported
    // before rethrowing, because by the time this surfaces as a 500 the
    // basket is gone and nobody knows it happened.
    void reportServerError('Checkout · order not created', e, request.url)
    throw e
  }

  // The storefront language at checkout, stored with the order so every
  // email about it — this confirmation, the receipt, the shipping notice —
  // arrives in that language. Tolerant of migration 0027 not being applied.
  const locale = (body as { locale?: unknown }).locale
  await setOrderLocale(order.id, locale)

  // Their cart became an order: no abandoned-cart reminder for it. Never
  // throws, and tolerant of migration 0029 not being applied.
  await markCartRecovered(order.customer.email)

  // Bought with a friend's referral code: the referral moves to "order
  // placed". The referrer is credited when this order is paid (see
  // setPaymentStatus). Never throws.
  if (priced.draft.referrerId && order.customer.email) {
    await attachReferralOrder({
      referrerId: priced.draft.referrerId,
      userId,
      email: order.customer.email,
      orderNumber: order.id,
    })
  }

  // Confirmation is sent only after the order is committed, and its failure is
  // never allowed to fail the request. The purchase is already real at this
  // point — reporting an error here would make the customer think checkout
  // failed and order again. For a guest this email is their record of the
  // order, which is why checkout requires the address.
  let emailed = false
  if (isMailConfigured) {
    emailed = await sendOrderConfirmation(order, emailLang(locale))
    if (!emailed) {
      console.warn(
        `[orders] ${order.id} created but confirmation email was not sent ` +
          `(recipient=${order.customer.email ? 'present' : 'missing'})`,
      )
    }
  }

  // Operations chat. Never throws, and gives up within seconds.
  await notifyNewOrder(order)

  // `orderId` at the top level is what the checkout handler redirects with;
  // the full order is kept for the existing callers.
  return NextResponse.json({ orderId: order.id, order, emailed }, { status: 201 })
}
