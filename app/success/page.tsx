import { redirect } from 'next/navigation'
import { PaymentOutcome, type PaymentOutcomeState } from '@/components/payment-outcome'

export const dynamic = 'force-dynamic'

/**
 * Landing page for payments that had to leave the site.
 *
 * Most card payments never reach here: `redirect: 'if_required'` keeps them on
 * /checkout, and that page routes straight to /checkout/success. This page is
 * where a 3-D Secure step-up or a redirect-based method returns to.
 *
 * A successful return is forwarded to /checkout/success so a customer who was
 * bounced through their bank sees the same thank-you page as everyone else,
 * rather than a second, thinner confirmation screen. Only the outcomes that
 * page cannot express — still processing, declined, interrupted — are
 * rendered here, in the visitor's language (see PaymentOutcome).
 *
 * IMPORTANT: `redirect_status` in this URL is a display hint, nothing more.
 * Anyone can type `?redirect_status=succeeded`, so neither this page nor the
 * one it forwards to marks anything paid or trusts the value: /checkout/success
 * re-reads the order as the signed-in customer, and the order's real state is
 * set only by the signed webhook at /api/payments/stripe/webhook.
 */
export default function SuccessPage({
  searchParams,
}: {
  searchParams: { order?: string; redirect_status?: string }
}) {
  const orderId = searchParams.order
  const status = searchParams.redirect_status

  // Stripe returns `requires_payment_method` when the bank declined or the
  // 3-D Secure check failed; `failed` is the older spelling of the same thing.
  const state: PaymentOutcomeState =
    status === 'failed' || status === 'requires_payment_method'
      ? 'declined'
      : status === 'processing'
        ? 'processing'
        : status === 'canceled'
          ? 'incomplete'
          : 'succeeded'

  if (state === 'succeeded' && orderId) {
    redirect(`/checkout/success?order=${encodeURIComponent(orderId)}`)
  }

  return <PaymentOutcome state={state} orderId={orderId} />
}
