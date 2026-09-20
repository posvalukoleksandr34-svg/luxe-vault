'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { PasswordRecoveryModal } from '@/components/password-recovery-modal'
import { SupportUnreadWatcher } from '@/components/support/support-unread'
import { useStore } from '@/lib/store'

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
 * Both drawers are loaded on demand. They are the heaviest UI in the root
 * layout — the account drawer carries sign-in, sign-up, orders and password
 * forms — and every page used to ship them in its first-load JS although most
 * visits open neither. The code is fetched in the background once the page is
 * idle, so the first open still feels instant.
 */

const CartPanel = dynamic(() => import('@/components/cart-panel').then((m) => m.CartPanel), {
  ssr: false,
})
const UserPanel = dynamic(() => import('@/components/user-panel').then((m) => m.UserPanel), {
  ssr: false,
})
const SupportDrawer = dynamic(
  () => import('@/components/support/support-drawer').then((m) => m.SupportDrawer),
  { ssr: false },
)
const ChatBot = dynamic(() => import('@/components/support/chat-bot').then((m) => m.ChatBot), {
  ssr: false,
})

/** Fetches the drawer chunks without mounting anything. */
function warmDrawers() {
  void import('@/components/cart-panel')
  void import('@/components/user-panel')
  void import('@/components/support/support-drawer')
  void import('@/components/support/chat-bot')
}

export function GlobalPanels() {
  const { panel } = useStore()

  // Mounted on first open, then KEPT mounted — each renders nothing while
  // closed. The cart holds "sign in, then continue to checkout" in its own
  // state while the account drawer is open (pendingCheckout in
  // cart-panel.tsx); unmounting it on close would drop that step.
  const [cartMounted, setCartMounted] = useState(false)
  const [userMounted, setUserMounted] = useState(false)
  const [supportMounted, setSupportMounted] = useState(false)
  const [chatMounted, setChatMounted] = useState(false)
  if (panel === 'cart' && !cartMounted) setCartMounted(true)
  if (panel === 'user' && !userMounted) setUserMounted(true)
  if (panel === 'support' && !supportMounted) setSupportMounted(true)
  if (panel === 'chat' && !chatMounted) setChatMounted(true)

  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(warmDrawers, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    // Safari has no requestIdleCallback.
    const id = setTimeout(warmDrawers, 2500)
    return () => clearTimeout(id)
  }, [])

  return (
    <>
      {cartMounted && <CartPanel />}
      {userMounted && <UserPanel />}
      {supportMounted && <SupportDrawer />}
      {/* The quick-answers bot, opened by the floating button bottom left.
          One `panel` value means it and the support drawer can never be open
          at once. */}
      {chatMounted && <ChatBot />}
      {/* Tiny and not lazy: it keeps the unread count on the support buttons. */}
      <SupportUnreadWatcher />
      {/* Listens for Supabase's PASSWORD_RECOVERY event, which can fire on any
          route when someone follows a recovery link. Deliberately NOT lazy:
          the event fires while the client parses the URL on load, and a
          listener that arrives late would miss it. */}
      <PasswordRecoveryModal />
    </>
  )
}
