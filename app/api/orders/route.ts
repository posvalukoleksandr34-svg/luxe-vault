import { NextResponse, type NextRequest } from 'next/server'
import { addOrder } from '@/lib/server/orders-store'
import { buildOrder, validateOrderDraft, type OrderDraftBody } from '@/lib/server/order-drafts'
import { isMailConfigured, sendOrderConfirmation } from '@/lib/server/mailer'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Public endpoint used by checkout to place an order. The server — not the
 * browser — mints the id, the lookup token and the payment status, and
 * re-runs every checkout validation rule before writing anything.
 *
 * Orders that still need paying are stored as `pending_payment` rather than
 * being thrown away, so the customer can pay them later from their account.
 */
export async function POST(request: NextRequest) {
  let body: OrderDraftBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const result = validateOrderDraft(body)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  // Every order must belong to an account.
  //
  // Read from the verified cookie via getUser(), never from a user id in the
  // request body — a client-supplied id would let anyone file orders against
  // another account.
  //
  // This used to fall back to a guest order when the lookup failed, which is
  // how LV-JX59CL ended up unattached: a real, paid order that never appeared
  // in its owner's dashboard and that support had no way to link back. A
  // transient Supabase blip must not silently orphan an order, so a failure
  // here is now a hard 503 the customer can retry, not a quiet downgrade.
  let userId: string | undefined
  try {
    userId = (await getCurrentUser())?.id
  } catch {
    return NextResponse.json(
      { error: 'Не удалось подтвердить сессию. Повторите попытку.' },
      { status: 503 },
    )
  }

  if (!userId) {
    // Mirrors the sign-in gate in the checkout drawer. Enforced here too
    // because the UI gate is not a security boundary — anyone can POST here.
    return NextResponse.json(
      { error: 'Для оформления заказа необходимо войти в аккаунт.' },
      { status: 401 },
    )
  }

  const order = buildOrder(result.draft, userId)
  await addOrder(order)

  // Confirmation is sent only after the order is committed, and its failure is
  // never allowed to fail the request. The purchase is already real at this
  // point — reporting an error here would make the customer think checkout
  // failed and order again.
  let emailed = false
  if (isMailConfigured) {
    emailed = await sendOrderConfirmation(order)
    if (!emailed) {
      console.warn(
        `[orders] ${order.id} created but confirmation email was not sent ` +
          `(recipient=${order.customer.email ? 'present' : 'missing'})`,
      )
    }
  }

  return NextResponse.json({ order, emailed }, { status: 201 })
}
