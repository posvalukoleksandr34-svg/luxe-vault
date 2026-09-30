import type { Metadata } from 'next'
import { CartRestore } from '@/components/cart-restore'
import { findCartByToken } from '@/lib/server/abandoned-carts'

// A private link from one customer's email: never cached, never indexed.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function RestoreCartPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const cart = await findCartByToken(params.token)
  // An expired cart (idle for a week) still restores — the store drops
  // anything no longer sold. An ordered one does not: it was bought.
  const state = !cart || !cart.cart_items?.length ? 'missing' : cart.status === 'recovered' ? 'ordered' : 'restore'
  return <CartRestore state={state} items={state === 'restore' ? cart!.cart_items : []} />
}
