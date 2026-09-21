import type { Metadata } from 'next'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { wishlistMetadata } from '@/lib/page-seo'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { WishlistView } from '@/components/wishlist-view'

export const metadata: Metadata = wishlistMetadata(DEFAULT_LOCALE)

export default function WishlistPage() {
  return (
    <>
      <Header />
      <main id="main">
        <WishlistView />
        <Footer />
      </main>
    </>
  )
}
