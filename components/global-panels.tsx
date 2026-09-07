'use client'

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
 * "Checkout" from a PDP closed the cart and rendered nothing. Checkout has
 * since moved to its own route (/checkout) and left this set, but the same
 * trap remains for anything that stays a panel.
 *
 * Each panel self-guards on `panel !== '<its own>'` and returns null, so this
 * costs nothing on pages where none is open.
 */

export function GlobalPanels() {
  return (
    <>
      <CartPanel />
      <UserPanel />
      {/* Listens for Supabase's PASSWORD_RECOVERY event, which can fire on any
          route when someone follows a recovery link. */}
      <PasswordRecoveryModal />
    </>
  )
}
