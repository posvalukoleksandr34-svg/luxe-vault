'use client'

import dynamic from 'next/dynamic'
import { CartPanel } from '@/components/cart-panel'
import { PasswordRecoveryModal } from '@/components/password-recovery-modal'
import { UserPanel } from '@/components/user-panel'

/**
 * The slide-over panels that any page can open.
 *
 * Mounted ONCE in the root layout rather than per page, because these are
 * driven by a single piece of store state (`panel`) that the header can set
 * from anywhere. A page that renders the trigger but not the panel produces a
 * silent dead end: the state flips, the previous panel unmounts, and nothing
 * takes its place.
 *
 * That is not hypothetical — it is the bug this component exists to prevent.
 * The product page mounted CartPanel and UserPanel but not CheckoutPanel, so
 * "Checkout" from a PDP closed the cart and rendered nothing, leaving the
 * customer on the product page with no way forward. Mounting them centrally
 * means a new route cannot reintroduce it by forgetting one.
 *
 * Each panel self-guards on `panel !== '<its own>'` and returns null, so this
 * costs nothing on pages where none is open.
 */

// Checkout carries the international phone metadata, the address autocomplete
// and Stripe Elements — tens of kilobytes nobody needs until they open it, so
// it stays a deferred chunk even though it is now mounted everywhere.
const CheckoutPanel = dynamic(
  () => import('@/components/checkout-panel').then((m) => m.CheckoutPanel),
  { ssr: false },
)

export function GlobalPanels() {
  return (
    <>
      <CartPanel />
      <CheckoutPanel />
      <UserPanel />
      {/* Listens for Supabase's PASSWORD_RECOVERY event, which can fire on any
          route when someone follows a recovery link. */}
      <PasswordRecoveryModal />
    </>
  )
}
