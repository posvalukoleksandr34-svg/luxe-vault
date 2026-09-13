'use client'

import { PackageX, SearchX, ShoppingBag } from 'lucide-react'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { EmptyState } from '@/components/state-view'
import { useStore } from '@/lib/store'

/**
 * The shop's 404, in the visitor's language and the shop's frame.
 *
 * Two flavours: a page that does not exist, and a product that used to — a
 * product link shared last month should say the piece has been retired, not
 * that the URL is wrong. Both lead back to the catalogue; with something in
 * the cart, "Open cart" is offered too, because that is often where the
 * visitor was going.
 */
export function NotFoundView({ kind = 'page' }: { kind?: 'page' | 'product' }) {
  const { t, cartCount, setPanel } = useStore()
  const product = kind === 'product'

  return (
    <>
      <Header />
      <main id="main" className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center justify-center px-6 py-16">
        <EmptyState
          icon={product ? PackageX : SearchX}
          title={product ? t('state.discontinuedTitle') : t('state.notFoundTitle')}
          hint={product ? t('state.discontinuedHint') : t('state.notFoundHint')}
          action={{ label: t('state.goToCatalog'), href: '/#shop' }}
          secondary={
            cartCount > 0
              ? { label: t('state.openCart'), onClick: () => setPanel('cart'), icon: ShoppingBag }
              : undefined
          }
        />
      </main>
      <Footer />
    </>
  )
}
