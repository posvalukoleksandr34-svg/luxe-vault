import { createAdminClient } from '@/lib/supabase/admin'
import { ensureStripeCustomer } from '@/lib/server/stripe'

/**
 * Resolves the Stripe Customer id for an authenticated user, creating and
 * persisting one on first use.
 *
 * The write goes through the service-role client on purpose: the
 * `profiles_protect_stripe_customer_id` trigger (migration 0007) rejects any
 * attempt by a normal authenticated session to change this column. Without
 * that, a user could point their own profile at somebody else's Stripe
 * customer id and read that person's saved cards.
 */
export async function resolveStripeCustomerId(user: {
  id: string
  email?: string
  name?: string
}): Promise<string> {
  const admin = createAdminClient()

  const { data } = await admin
    .from('profiles')
    .select('stripe_customer_id, name, email')
    .eq('id', user.id)
    .maybeSingle()

  const existingId = (data?.stripe_customer_id as string | null) ?? null

  const customerId = await ensureStripeCustomer({
    existingId,
    email: user.email ?? (data?.email as string | undefined),
    name: user.name ?? (data?.name as string | undefined),
    userId: user.id,
  })

  if (customerId !== existingId) {
    await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id)
  }

  return customerId
}

/**
 * The customer id already on the profile, or null. Used by read-only paths
 * (listing saved cards) which must not create a Stripe customer as a side
 * effect of someone merely opening their account page.
 */
export async function getStripeCustomerId(userId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle()
  return (data?.stripe_customer_id as string | null) ?? null
}
