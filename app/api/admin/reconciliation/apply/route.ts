import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/server/admin-guard'
import { findOrderByPaymentId, getOrderById } from '@/lib/server/orders-store'
import { getStripe, isStripeConfigured } from '@/lib/server/stripe'
import { applyPaymentIntent, chargeMismatch } from '@/lib/server/stripe-payment-apply'
import type { PaymentStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const MONEY_IN: PaymentStatus[] = ['paid', 'partially_refunded', 'refunded']

/**
 * POST /api/admin/reconciliation/apply { paymentId, orderId } — the owner's
 * decision on a "paid in Stripe, not recorded" discrepancy: record the order
 * as paid, because Stripe says so.
 *
 * For a payment whose webhook never arrived (a missing event subscription, a
 * rotated signing secret). Nothing in the request is trusted beyond the two
 * ids: the PaymentIntent is fetched from Stripe here, with the shop's own key,
 * and it is applied only if
 *
 *   - Stripe says `succeeded` (a processing, failed or cancelled payment is
 *     never recorded as paid from here);
 *   - it belongs to the order the owner named — by the order's payment id,
 *     or by the intent's metadata when the order has none yet — and the
 *     order is not bound to another payment;
 *   - it paid that order's amount in its currency.
 *
 * Then it runs the webhook's own code (lib/server/stripe-payment-apply.ts):
 * the same state machine, stock check, Telegram slip and receipt, each with
 * its once-only guard. Applying twice changes nothing.
 *
 * Only this direction. The other discrepancies — recorded as paid while
 * Stripe has no money, amounts that differ, refunds on one side only — are
 * for the owner to settle in Stripe and the orders page; un-paying an order
 * from a button would be the more dangerous mistake.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  if (!isStripeConfigured()) return NextResponse.json({ error: 'Stripe не настроен' }, { status: 503 })

  const body = (await request.json().catch(() => null)) as { paymentId?: unknown; orderId?: unknown } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : ''
  if (!/^pi_[A-Za-z0-9_]{1,250}$/.test(paymentId) || !/^LV-[A-Z0-9]{4,12}$/.test(orderId)) {
    return NextResponse.json({ error: 'Нужны номер заказа и идентификатор платежа Stripe' }, { status: 400 })
  }

  let intent
  try {
    intent = await getStripe().paymentIntents.retrieve(paymentId)
  } catch (e) {
    console.error('[reconciliation] retrieve failed:', (e as Error).message)
    return NextResponse.json({ error: 'Stripe не ответил — ничего не изменено' }, { status: 502 })
  }

  if (intent.status !== 'succeeded') {
    return NextResponse.json(
      { error: `В Stripe платёж в статусе «${intent.status}», не «succeeded» — заказ не отмечен оплаченным` },
      { status: 409 },
    )
  }

  const metadataOrderId = typeof intent.metadata?.orderId === 'string' ? intent.metadata.orderId.trim() : ''
  const target = (await findOrderByPaymentId(intent.id)) ?? (metadataOrderId ? await getOrderById(metadataOrderId) : null)
  if (!target || target.id !== orderId) {
    return NextResponse.json({ error: 'Этот платёж в Stripe не относится к указанному заказу' }, { status: 409 })
  }
  if (target.paymentId && target.paymentId !== intent.id) {
    return NextResponse.json({ error: 'Заказ привязан к другому платежу — решите вручную в Stripe' }, { status: 409 })
  }
  if (MONEY_IN.indexOf(target.paymentStatus as PaymentStatus) !== -1) {
    return NextResponse.json({ ok: true, order: target.id, paymentStatus: target.paymentStatus, unchanged: true })
  }
  const mismatch = chargeMismatch(target, intent)
  if (mismatch) {
    return NextResponse.json({ error: `Сумма или валюта не совпадают с заказом: ${mismatch}` }, { status: 409 })
  }

  try {
    const outcome = await applyPaymentIntent(intent, 'paid', 'admin reconciliation')
    if (!('paymentStatus' in outcome)) {
      return NextResponse.json({ error: 'Статус не записан — заказ изменился, обновите сверку' }, { status: 409 })
    }
    // The record of who decided what: the console has one owner login, so the
    // line says which action, on which order and payment, and when.
    console.warn(
      JSON.stringify({ admin_action: 'reconciliation_apply_paid', order: outcome.order, payment: intent.id, at: new Date().toISOString() }),
    )
    return NextResponse.json({ ok: true, order: outcome.order, paymentStatus: outcome.paymentStatus, receiptSent: outcome.receiptSent })
  } catch (e) {
    console.error('[reconciliation] apply failed:', e)
    return NextResponse.json({ error: 'Не удалось записать статус — ничего не изменено' }, { status: 500 })
  }
}
